import { underAppRoot } from '../../fsLayout';
import { fetchManifest, fetchModule } from '../module-registry/module-cdn';
import { createBundlerHarness, COMPILE_FIXTURE, type BundlerHarness } from './bundlerHarness';

jest.mock('../module-registry/module-cdn', () => ({
  ...jest.requireActual('../module-registry/module-cdn'), fetchManifest: jest.fn(), fetchModule: jest.fn(),
}));
const manifest = fetchManifest as jest.MockedFunction<typeof fetchManifest>;
const moduleFetch = fetchModule as jest.MockedFunction<typeof fetchModule>;
const pkg = (name: string, deps: string[] = []) => ({
  f: {
    'package.json': { c: JSON.stringify({ name, version: '1.0.0', main: 'index.js' }), d: [], t: true },
    'index.js': {
      c: deps.length ? `module.exports=[${deps.map(dep => `require(${JSON.stringify(dep)})`).join(',')}];` : 'module.exports=42;',
      d: deps, t: true,
    },
  }, m: deps,
});
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};
let h: BundlerHarness;
beforeEach(async () => {
  manifest.mockReset(); moduleFetch.mockReset();
  manifest.mockImplementation(async deps => Object.keys(deps).map(n => ({ n, v: '1.0.0', d: 0 })));
  h = await createBundlerHarness(COMPILE_FIXTURE);
  await h.bundler.moduleRegistry.fetchManifest({ widget: '^1.0.0', dep: '^1.0.0' }, {});
});
afterEach(async () => { await h.teardown(); });

it('a concurrent importer waits for the package dependency closure, including cached misses', async () => {
  let release!: () => void, pending!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const started = new Promise<void>(r => { pending = r; });
  moduleFetch.mockImplementation(async name => {
    if (name === 'dep') { pending(); await gate; }
    return pkg(name, name === 'widget' ? ['dep'] : []);
  });
  const first = h.bundler.resolveAsync('widget', underAppRoot('/first.ts'));
  await started;
  let settled = false;
  const second = h.bundler.resolveAsync('widget', underAppRoot('/second.ts')).then(
    value => { settled = true; return { value }; }, error => { settled = true; return { error: String(error) }; },
  );
  await new Promise(r => setTimeout(r, 40));
  const settledBeforeInstallFinished = settled;
  release();
  await first;
  const outcome = await second;
  expect(outcome).toEqual({ value: '/node_modules/widget/index.js' });
  expect(settledBeforeInstallFinished).toBe(false);
});

it('correcting a failed dependency range actually retries the new release', async () => {
  moduleFetch.mockRejectedValueOnce(new Error('temporary download failure'));
  await expect(h.bundler.resolveAsync('widget', underAppRoot('/first.ts'))).rejects.toThrow('download failure');
  h.bundler.moduleRegistry.setDeclared({ widget: '^2.0.0', dep: '^1.0.0' });
  await Promise.resolve();
  manifest.mockImplementation(async deps => Object.keys(deps).map(n => ({ n, v: '2.0.0', d: 0 })));
  moduleFetch.mockImplementation(async name => pkg(name));
  await h.bundler.resolveAsync('widget', underAppRoot('/second.ts'));
  expect(moduleFetch).toHaveBeenLastCalledWith('widget', '2.0.0', ['.']);
});

it('does not resurrect a rolled-back package when a sibling download completes late', async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  moduleFetch.mockImplementation(async name => {
    if (name === 'widget') { await gate; return pkg(name); }
    throw new Error('sibling download failed');
  });
  const batch = h.bundler.moduleRegistry.ensurePackages(['widget', 'dep']);
  await expect(batch).rejects.toThrow('sibling download failed');
  const pendingDownload = h.bundler.moduleRegistry.moduleDownloadPromises.get('widget::widget::1.0.0');
  expect(pendingDownload).toBeDefined();
  release();
  await pendingDownload;
  const resurrected = h.bundler.moduleRegistry.modules.has('widget');
  h.bundler.moduleRegistry.setDeclared({ widget: '^2.0.0', dep: '^1.0.0' });
  await Promise.resolve();
  manifest.mockImplementation(async deps => Object.keys(deps).map(n => ({ n, v: '2.0.0', d: 0 })));
  moduleFetch.mockImplementation(async name => pkg(name));
  await h.bundler.resolveAsync('widget', underAppRoot('/retry.ts'));
  expect({ resurrected, version: h.bundler.moduleRegistry.modules.get('widget')?.version }).toEqual({
    resurrected: false, version: '2.0.0',
  });
});

it.each([
  ['1.0.0', 'before'],
  ['1.0.0', 'after'],
  ['2.0.0', 'before'],
  ['2.0.0', 'after'],
])('keeps retry %s when the cancelled download finishes %s the replacement', async (version, completion) => {
  const oldDownloadGate = gate();
  const replacementGate = gate();
  const replacementStarted = gate();
  const replacement = pkg('widget');
  replacement.f['index.js'].c = 'module.exports="replacement";';
  let widgetDownloads = 0;
  moduleFetch.mockImplementation(async name => {
    if (name !== 'widget') throw new Error('sibling download failed');
    if (++widgetDownloads === 1) {
      await oldDownloadGate.promise;
      return pkg(name);
    }
    replacementStarted.release();
    await replacementGate.promise;
    return replacement;
  });

  const registry = h.bundler.moduleRegistry;
  await expect(registry.ensurePackages(['widget', 'dep'])).rejects.toThrow('sibling download failed');
  const oldDownload = registry.moduleDownloadPromises.get('widget::widget::1.0.0');
  expect(oldDownload).toBeDefined();

  registry.setDeclared({ widget: `^${version}`, dep: '^1.0.0' });
  await Promise.resolve();
  manifest.mockImplementation(async deps => Object.keys(deps).map(n => ({ n, v: version, d: 0 })));
  const retry = h.bundler.resolveAsync('widget', underAppRoot('/retry.ts'));
  await replacementStarted.promise;
  const replacementKey = `widget::widget::${version}`;
  const replacementDownload = registry.moduleDownloadPromises.get(replacementKey);
  expect(replacementDownload).toBeDefined();
  expect(replacementDownload).not.toBe(oldDownload);

  if (completion === 'before') {
    oldDownloadGate.release();
    await oldDownload;
    expect(registry.modules.has('widget')).toBe(false);
    // Finishing an obsolete download must not delete the replacement's cache
    // entry, even when both attempts target exactly the same package version.
    expect(registry.moduleDownloadPromises.get(replacementKey)).toBe(replacementDownload);
  }
  replacementGate.release();
  const resolved = await retry;
  if (completion === 'after') {
    oldDownloadGate.release();
    await oldDownload;
  }

  expect(registry.modules.get('widget')?.version).toBe(version);
  expect(await h.bundler.fs.readFileAsync(resolved)).toBe(replacement.f['index.js'].c);
  expect(widgetDownloads).toBe(2);
  expect(registry.moduleDownloadPromises.size).toBe(0);
});

it('also cancels late downloads from the dependency closure without removing earlier installs', async () => {
  const registry = h.bundler.moduleRegistry;
  registry.setDeclared({ stable: '^1.0.0', root: '^1.0.0', widget: '^1.0.0', dep: '^1.0.0' });
  moduleFetch.mockImplementation(async name => pkg(name));
  await registry.ensurePackages(['stable']);
  const stable = registry.modules.get('stable');

  const oldDownloadGate = gate();
  moduleFetch.mockImplementation(async name => {
    if (name === 'root') return pkg(name, ['widget', 'dep']);
    if (name === 'widget') { await oldDownloadGate.promise; return pkg(name); }
    throw new Error('closure download failed');
  });
  // Only root is requested initially; widget and dep are discovered in its
  // downloaded metadata and fetched in a separate wave.
  await expect(registry.ensurePackages(['root'])).rejects.toThrow('closure download failed');
  const oldDownload = registry.moduleDownloadPromises.get('widget::widget::1.0.0');
  expect(oldDownload).toBeDefined();
  expect(registry.modules.get('stable')).toBe(stable);
  expect(registry.modules.has('root')).toBe(false);
  expect(registry.manifest.map(dep => dep.n)).toEqual(['stable']);

  registry.setDeclared({ stable: '^1.0.0', root: '^2.0.0', widget: '^2.0.0', dep: '^1.0.0' });
  await Promise.resolve();
  manifest.mockImplementation(async deps => Object.keys(deps).map(n => ({ n, v: '2.0.0', d: 0 })));
  moduleFetch.mockImplementation(async name => pkg(name, name === 'root' ? ['widget'] : []));
  await h.bundler.resolveAsync('root', underAppRoot('/retry.ts'));
  oldDownloadGate.release();
  await oldDownload;
  expect(registry.modules.get('stable')).toBe(stable);
  expect(registry.modules.get('root')?.version).toBe('2.0.0');
  expect(registry.modules.get('widget')?.version).toBe('2.0.0');
  expect(registry.moduleDownloadPromises.size).toBe(0);
});

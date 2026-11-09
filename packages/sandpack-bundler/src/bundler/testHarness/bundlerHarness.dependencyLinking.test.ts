import { fetchManifest, fetchModule, fetchModuleEntries } from '../module-registry/module-cdn';
import { createBundlerHarness, installEvalGlobals, type BundlerHarness } from './bundlerHarness';

jest.mock('../module-registry/module-cdn', () => ({
  ...jest.requireActual('../module-registry/module-cdn'),
  fetchManifest: jest.fn(),
  fetchModule: jest.fn(),
  fetchModuleEntries: jest.fn(),
}));

const manifest = fetchManifest as jest.MockedFunction<typeof fetchManifest>;
const download = fetchModule as jest.MockedFunction<typeof fetchModule>;
const fixture = {
  'package.json': JSON.stringify({ main: 'src/main', dependencies: { state: '1.0.0', renderer: '1.0.0' } }),
  'index.html': '<!doctype html><div id="root"></div>',
  'src/main.ts': "import state from 'state'; import render from 'renderer'; globalThis.__linkedResult = state + render();",
};

describe('newly installed packages link against the current filesystem', () => {
  let h: BundlerHarness;
  let restore: () => void;

  beforeEach(async () => {
    restore = installEvalGlobals();
    manifest.mockImplementation(async (deps, _pins, entries) => Object.keys(deps).map(n => ({ n, v: '1.0.0', d: 0, e: entries?.[n] })));
    download.mockImplementation(async name => ({
      f: {
        'package.json': { c: JSON.stringify({ name, main: 'index.js' }), d: [], t: true },
        'index.js': {
          c: name === 'renderer' ? 'module.exports = () => require("state") + 1;' : 'module.exports = 41;',
          d: name === 'renderer' ? ['state'] : [], t: true,
        },
      },
      m: name === 'renderer' ? ['state'] : [],
    }));
    (fetchModuleEntries as jest.MockedFunction<typeof fetchModuleEntries>).mockImplementation(
      (name, version, entries) => download(name, version, entries),
    );
    h = await createBundlerHarness(fixture, { forCompile: true });
  });

  afterEach(async () => {
    await h.teardown();
    restore();
    delete (globalThis as Record<string, unknown>).__linkedResult;
  });

  it('evaluates a package dependency that the boot import scan previously found missing', async () => {
    const evaluate = await h.bundler.compile();
    expect(evaluate).not.toBeNull();
    evaluate!();
    expect((globalThis as Record<string, unknown>).__linkedResult).toBe(83);
    const updates = h.sentMessages.filter(m => m.type === 'build-progress').map(m => m.data as any);
    expect(updates).toContainEqual(expect.objectContaining({ phase: 'scanning', item: '/src/main.ts', done: true }));
    expect(updates).toContainEqual(expect.objectContaining({ phase: 'dependencies', completed: 0, total: 2 }));
    expect(updates.filter(p => p.phase === 'dependencies' && p.done).map(p => p.item).sort()).toEqual(['renderer@1.0.0', 'state@1.0.0']);
    expect(updates).toContainEqual(expect.objectContaining({ phase: 'dependencies', completed: 2, total: 2, done: true }));
    expect(updates).toContainEqual(expect.objectContaining({ phase: 'compiling', item: '/src/main.ts', done: true }));
  });

  it('links an on-demand install after an earlier filesystem lookup missed its peer', async () => {
    await h.bundler.moduleRegistry.fetchManifest({ state: '1.0.0', renderer: '1.0.0' }, {});
    expect(await h.bundler.fs.isFileAsync('/node_modules/state/package.json')).toBe(false);
    await h.bundler.moduleRegistry.ensurePackages(['renderer', 'state']);
    const renderer = h.bundler.getModule('/node_modules/renderer/index.js');
    expect(renderer).toBeDefined();
    expect(renderer!.evaluate().context.exports()).toBe(42);
  });

});

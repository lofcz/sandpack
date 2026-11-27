import { fs } from '@zenfs/core';

import { underAppRoot } from '../../fsLayout';
import { createBundlerHarness, installEvalGlobals, type BundlerHarness } from '../testHarness/bundlerHarness';
import { Module } from './Module';

// What the react-refresh boundary does, without React: a module accepts its own
// updates while its export "shape" stays the same, and invalidates itself when
// an update changes it, handing the update to whatever imports it.
const boundary = (shape: string, value: number) =>
  [
    'declare const module: any;',
    `export const value = ${value};`,
    'const g = globalThis as any;',
    'g.__childRuns = (g.__childRuns ?? 0) + 1;',
    'const previous = module.hot.data && module.hot.data.shape;',
    `module.hot.dispose((data: any) => { data.shape = '${shape}'; });`,
    `if (previous !== undefined && previous !== '${shape}') module.hot.invalidate(); else module.hot.accept();`,
  ].join('\n');

const FIXTURE: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'hmr-invalidate-fixture', main: 'src/main' }),
  'index.html': '<!doctype html><div id="root"></div>',
  'src/main.ts': [
    "import './parent';",
    'const g = globalThis as any;',
    'g.__mainRuns = (g.__mainRuns ?? 0) + 1;',
    'export default 1;',
  ].join('\n'),
  'src/parent.ts': [
    'declare const module: any;',
    "import { value } from './child';",
    'const g = globalThis as any;',
    'g.__parentSaw = value;',
    'g.__parentRuns = (g.__parentRuns ?? 0) + 1;',
    'module.hot.accept();',
  ].join('\n'),
  'src/child.ts': boundary('one', 1),
};

const g = globalThis as Record<string, unknown>;

describe('HMR: a module that invalidates itself', () => {
  let h: BundlerHarness;
  let restore: () => void;

  const refreshRequests = () => h.sentMessages.filter((message) => message.type === 'request-refresh').length;

  beforeAll(async () => {
    restore = installEvalGlobals();
    h = await createBundlerHarness(FIXTURE, { forCompile: true });
    const evaluate = await h.bundler.compile();
    (evaluate as () => unknown)();
  }, 60000);

  afterAll(async () => {
    for (const key of ['__mainRuns', '__parentRuns', '__parentSaw', '__childRuns', '__loops']) delete g[key];
    await h.teardown();
    restore();
  });

  it('re-runs its importers in the same compile, so the preview is not stale', async () => {
    expect(g).toMatchObject({ __parentSaw: 1, __parentRuns: 1, __childRuns: 1, __mainRuns: 1 });

    await fs.promises.writeFile(underAppRoot('/src/child.ts'), boundary('two', 2));
    h.bundler.markFilesChanged([underAppRoot('/src/child.ts')]);
    h.babel.resetTransformRequests();
    const evaluate = await h.bundler.compile();
    (evaluate as () => unknown)();

    // The importer ran again and saw the new export …
    expect(g.__parentSaw).toBe(2);
    expect(g.__parentRuns).toBe(2);
    // … with the code it already had: only the edited file went through Babel.
    expect(h.babel.transformRequests).toEqual([underAppRoot('/src/child.ts')]);
    // The invalidated module was created once more and accepts updates again.
    expect(g.__childRuns).toBe(3);
    expect(h.bundler.getModule(underAppRoot('/src/child.ts'))?.isHot()).toBe(true);
    // The update stopped at the importer that accepts it: no reload, entry untouched.
    expect(g.__mainRuns).toBe(1);
    expect(refreshRequests()).toBe(0);
  }, 60000);

  it('still updates in place on the next edit of the same module', async () => {
    await fs.promises.writeFile(underAppRoot('/src/child.ts'), boundary('two', 3));
    h.bundler.markFilesChanged([underAppRoot('/src/child.ts')]);
    const evaluate = await h.bundler.compile();
    (evaluate as () => unknown)();

    // Same shape: the module accepts the update itself and nothing else runs.
    expect(g.__childRuns).toBe(4);
    expect(g.__parentRuns).toBe(2);
    expect(refreshRequests()).toBe(0);
  }, 60000);

  it('reloads when the update reaches an importer that does not accept updates', () => {
    const leaf = new Module(
      '/app/leaf.js',
      'exports.value = 1; if (module.hot.data) module.hot.invalidate(); else module.hot.accept();',
      true,
      h.bundler
    );
    const importer = new Module('/app/importer.js', 'exports.seen = require("./leaf").value;', true, h.bundler);
    h.bundler.modules.set(leaf.filepath, leaf);
    h.bundler.modules.set(importer.filepath, importer);
    importer.dependencyMap.set('./leaf', leaf.filepath);
    importer.dependencies.add(leaf.filepath);
    h.bundler.addInitiator(leaf.filepath, importer.filepath);
    importer.evaluate();

    leaf.evaluation = null;
    leaf.hot.hmrConfig?.setDirty(true);
    (h.bundler as unknown as { applyHotUpdate(): void }).applyHotUpdate();

    expect(refreshRequests()).toBe(1);
    expect(h.bundler.isReloading).toBe(true);
    // The next scenario needs a bundler that is not waiting for a reload.
    (h.bundler as unknown as { reloadRequested: boolean }).reloadRequested = false;
    h.sentMessages.length = 0;
    h.bundler.modules.delete(leaf.filepath);
    h.bundler.modules.delete(importer.filepath);
  });

  it('reloads instead of looping when a module invalidates itself every time it runs', () => {
    const looping = new Module(
      '/app/looping.js',
      'globalThis.__loops = (globalThis.__loops || 0) + 1; if (module.hot.data) module.hot.invalidate(); else module.hot.accept();',
      true,
      h.bundler
    );
    h.bundler.modules.set(looping.filepath, looping);
    looping.evaluate();
    expect(looping.isHot()).toBe(true);

    // An update of it: dirty, to be evaluated by the next hot pass.
    looping.evaluation = null;
    looping.hot.hmrConfig?.setDirty(true);
    (h.bundler as unknown as { applyHotUpdate(): void }).applyHotUpdate();

    // First run, the update, one re-creation: then the bundler gives up on patching in place.
    expect(g.__loops).toBe(3);
    expect(refreshRequests()).toBe(1);
    expect(h.bundler.isReloading).toBe(true);
  });
});

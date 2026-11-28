import type { Mock } from '@rstest/core';
import { underAppRoot } from '../../fsLayout';
import { scanCjsModule } from '../transforms/raw-cjs/scan';
import { createBundlerHarness, COMPILE_FIXTURE, installEvalGlobals, type BundlerHarness } from '../testHarness/bundlerHarness';
import { fetchManifest, fetchModule, fetchModuleEntries } from './module-cdn';

rs.mock('./module-cdn', () => ({
  ...rs.requireActual('./module-cdn'),
  fetchManifest: rs.fn(),
  fetchModule: rs.fn(),
  fetchModuleEntries: rs.fn(),
}));
rs.mock('../transforms/raw-cjs/scan', () => {
  const actual = rs.requireActual<typeof import('../transforms/raw-cjs/scan')>('../transforms/raw-cjs/scan');
  return { ...actual, scanCjsModule: rs.fn(actual.scanCjsModule) };
});

const manifest = fetchManifest as Mock<typeof fetchManifest>;
const download = fetchModule as Mock<typeof fetchModule>;
const parse = scanCjsModule as Mock<typeof scanCjsModule>;

const pkg = JSON.stringify({ name: 'glue', main: './index.js', imports: { '#inner': './inner.js' } });
const INDEX = 'module.exports = [require("#inner"), require("./loader.js")];';
const LOADER = 'module.exports = function (name) { return require(name); };';
const INNER = 'module.exports = "inner";';

// A CDN that scans what it transforms says what a parse of each file would
// find (`s`, `u`); the files of a preview are then not parsed a second time
// on the thread it boots on.
describe('[harness] what the CDN says about a transformed file', () => {
  let h: BundlerHarness;
  let restore: () => void;

  beforeEach(async () => {
    restore = installEvalGlobals();
    manifest.mockReset();
    download.mockReset();
    (fetchModuleEntries as Mock<typeof fetchModuleEntries>).mockReset();
    manifest.mockImplementation(async (deps, _pins, entries) =>
      Object.keys(deps).map((n) => ({ n, v: '1.0.0', d: 0, e: entries?.[n] }))
    );
    h = await createBundlerHarness(COMPILE_FIXTURE);
    parse.mockClear();
  });

  afterEach(async () => {
    await h.teardown();
    restore();
  });

  const install = async (files: Record<string, unknown>) => {
    download.mockResolvedValue({ f: { 'package.json': { c: pkg, d: [], t: true, s: 0 }, ...files }, m: [] } as never);
    await h.bundler.moduleRegistry.fetchManifest({ glue: '^1.0.0' }, {});
    await h.bundler.moduleRegistry.ensurePackages(['glue']);
    await h.bundler.resolveAsync('glue', underAppRoot('/src/index.ts'));
    return (path: string) => h.bundler.getModule(`/node_modules/glue/${path}`)!;
  };

  it('is taken at its word: no file is parsed, unlisted requires are linked, and a file that needs the compiler gets it', async () => {
    const module = await install({
      // `#inner` is no edge of the package graph the CDN lists in `d`.
      'index.js': { c: INDEX, d: ['./loader.js'], t: true, s: 0, u: ['#inner'] },
      'inner.js': { c: INNER, d: [], t: true, s: 0 },
      'loader.js': { c: LOADER, d: [], t: true, s: 1 },
    });

    expect(parse).not.toHaveBeenCalled();
    expect(module('index.js').dependencyMap.get('#inner')).toBe('/node_modules/glue/inner.js');
    expect(module('index.js').dependencyMap.get('./loader.js')).toBe('/node_modules/glue/loader.js');
    // Runs as it is: the downloaded code is the compiled code.
    expect(module('index.js').compiled).toBe(INDEX);
    expect(module('inner.js').compiled).toBe(INNER);
    // Its `require(name)` is the compiler's to deal with.
    expect(module('loader.js').compiled).not.toBe(LOADER);
  });

  it('is found by parsing when the CDN did not say (an older CDN, a payload cached before)', async () => {
    const module = await install({
      'index.js': { c: INDEX, d: ['./loader.js'], t: true },
      'inner.js': { c: INNER, d: [], t: true },
      'loader.js': { c: LOADER, d: [], t: true },
    });

    expect(parse.mock.calls.map(([source]) => source).sort()).toEqual([INDEX, INNER, LOADER].sort());
    expect(module('index.js').dependencyMap.get('#inner')).toBe('/node_modules/glue/inner.js');
    expect(module('index.js').compiled).toBe(INDEX);
    expect(module('loader.js').compiled).not.toBe(LOADER);
  });
});

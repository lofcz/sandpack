import { fs } from '@zenfs/core';

import { underAppRoot } from '../fsLayout';
import { createBundlerHarness, installEvalGlobals, type BundlerHarness } from './testHarness/bundlerHarness';
import { fetchManifest, fetchModule } from './module-registry/module-cdn';

jest.mock('./module-registry/module-cdn', () => ({
  ...jest.requireActual('./module-registry/module-cdn'),
  fetchManifest: jest.fn(),
  fetchModule: jest.fn(),
}));

const mockedFetchManifest = fetchManifest as jest.MockedFunction<typeof fetchManifest>;
const mockedFetchModule = fetchModule as jest.MockedFunction<typeof fetchModule>;

/** Every requested package resolves to a one-file CommonJS package that wraps its argument in brackets. */
function installFakeCdn(): void {
  mockedFetchManifest.mockImplementation(async (deps) => Object.keys(deps).map((n) => ({ n, v: '1.0.0', d: 0 })));
  mockedFetchModule.mockImplementation(async (name) => ({
    f: {
      'package.json': { c: JSON.stringify({ name, version: '1.0.0', main: 'index.js' }), d: [], t: true },
      'index.js': { c: "module.exports = function (text) { return '[' + text + ']'; };", d: [], t: true },
    },
    m: [],
  }));
}

const PACKAGE_JSON = JSON.stringify({ name: 'retry-fixture', main: 'src/main', dependencies: { 'left-pad': '1.0.0' } });

const MAIN = [
  "import pad from 'left-pad';",
  "import './counter';",
  "import { view } from './view';",
  '(globalThis as any).__rendered = pad(view());',
  'export default 1;',
].join('\n');

const FIXTURE: Record<string, string> = {
  'package.json': PACKAGE_JSON,
  'index.html': '<!doctype html><div id="root"></div>',
  'src/main.ts': MAIN,
  'src/counter.ts': 'const g = globalThis as any;\ng.__counterRuns = (g.__counterRuns ?? 0) + 1;\nexport {};',
  // The first draft does not parse.
  'src/view.ts': "export function view( { return 'first draft'; }",
};

const g = globalThis as Record<string, unknown>;

// A first build that fails must not cost a second cold boot: what was installed
// and linked stays, and the next attempt compiles only what changed.
describe('retrying a first build that failed', () => {
  let h: BundlerHarness;
  let restore: () => void;
  let installedPackages: number;

  const write = async (path: string, content: string) => {
    await fs.promises.writeFile(underAppRoot(path), content);
    h.bundler.markFilesChanged([underAppRoot(path)]);
  };
  const transformedAppFiles = () => h.babel.transformRequests.filter((path) => path.startsWith('/app/')).sort();

  beforeAll(async () => {
    restore = installEvalGlobals();
    installFakeCdn();
    h = await createBundlerHarness(FIXTURE, { forCompile: true });
  }, 60000);

  afterAll(async () => {
    for (const key of ['__rendered', '__counterRuns']) delete g[key];
    await h.teardown();
    restore();
  });

  it('fails the first build on the compile error', async () => {
    await expect(h.bundler.compile()).rejects.toMatchObject({ path: underAppRoot('/src/view.ts') });
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);
    installedPackages = mockedFetchModule.mock.calls.length;
    expect(installedPackages).toBeGreaterThan(0);
    expect(h.bundler.isFirstLoad).toBe(true);
  }, 60000);

  it('compiles only the fixed file on the next attempt, against the same install', async () => {
    // It parses now, but throws when it runs.
    await write('/src/view.ts', "export function view() { return 'second draft'; }\nthrow new Error('view exploded');");
    h.babel.resetTransformRequests();

    const evaluate = await h.bundler.compile();

    expect(transformedAppFiles()).toEqual([underAppRoot('/src/view.ts')]);
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);
    expect(mockedFetchModule).toHaveBeenCalledTimes(installedPackages);
    expect(evaluate).toThrow('view exploded');
    // The modules before the one that threw did run; the build has still not come up.
    expect(g.__counterRuns).toBe(1);
    expect(h.bundler.isFirstLoad).toBe(true);
  }, 60000);

  it('retries a module whose import could not be resolved once the file exists', async () => {
    await write('/src/main.ts', MAIN.replace("import './counter';", "import './counter';\nimport './late';"));
    await expect(h.bundler.compile()).rejects.toThrow(/late/);

    // Only the missing file arrives; the module that imports it is not touched again.
    await write('/src/late.ts', 'export {};');
    await write('/src/view.ts', "export function view() { return 'third draft'; }");
    h.babel.resetTransformRequests();

    const evaluate = await h.bundler.compile();
    (evaluate as () => unknown)();

    expect(g.__rendered).toBe('[third draft]');
    expect(transformedAppFiles()).toEqual(['/src/late.ts', '/src/main.ts', '/src/view.ts'].map(underAppRoot));
    // Evaluated before the earlier failure and unaffected by the edits: not run again.
    expect(g.__counterRuns).toBe(1);
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);
    expect(mockedFetchModule).toHaveBeenCalledTimes(installedPackages);
    expect(h.bundler.isFirstLoad).toBe(false);
    expect(h.sentMessages.filter((message) => message.type === 'request-refresh')).toHaveLength(0);
  }, 60000);
});

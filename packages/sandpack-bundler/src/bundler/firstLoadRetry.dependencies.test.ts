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

const packageJson = (dependencies: Record<string, string>) =>
  JSON.stringify({ name: 'retry-dependencies-fixture', main: 'src/main', dependencies });

const FIXTURE: Record<string, string> = {
  'package.json': packageJson({ 'left-pad': '1.0.0' }),
  'index.html': '<!doctype html><div id="root"></div>',
  'src/main.ts': [
    "import pad from 'left-pad';",
    "import { view } from './view';",
    '(globalThis as any).__rendered = pad(view());',
    'export default 1;',
  ].join('\n'),
  'src/view.ts': "export function view( { return 'first draft'; }",
};

const g = globalThis as Record<string, unknown>;

describe('retrying a first build that failed: when it starts over', () => {
  let h: BundlerHarness;
  let restore: () => void;

  const write = async (path: string, content: string) => {
    await fs.promises.writeFile(underAppRoot(path), content);
    h.bundler.markFilesChanged([underAppRoot(path)]);
  };

  beforeAll(async () => {
    restore = installEvalGlobals();
    installFakeCdn();
    h = await createBundlerHarness(FIXTURE, { forCompile: true });
    await expect(h.bundler.compile()).rejects.toMatchObject({ path: underAppRoot('/src/view.ts') });
  }, 60000);

  afterAll(async () => {
    delete g.__rendered;
    await h.teardown();
    restore();
  });

  it('keeps the install when package.json is rewritten with the same content', async () => {
    // The host rewrites package.json on every handshake.
    await write('/package.json', FIXTURE['package.json']);

    await expect(h.bundler.compile()).rejects.toMatchObject({ path: underAppRoot('/src/view.ts') });
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);
  }, 60000);

  it('drops a deleted file from the build instead of failing on it', async () => {
    await fs.promises.unlink(underAppRoot('/src/view.ts'));
    h.bundler.markFilesChanged([underAppRoot('/src/view.ts')]);
    await write('/src/main.ts', "import pad from 'left-pad';\n(globalThis as any).__rendered = pad('no view');\nexport default 1;");

    await expect(h.bundler.compile()).resolves.toBeInstanceOf(Function);
    expect(h.bundler.getModule(underAppRoot('/src/view.ts'))).toBeUndefined();
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);
  }, 60000);

  it('starts over when the dependencies changed', async () => {
    await write('/package.json', packageJson({ 'left-pad': '1.0.0', 'right-pad': '1.0.0' }));
    await write(
      '/src/main.ts',
      "import pad from 'left-pad';\nimport padRight from 'right-pad';\n(globalThis as any).__rendered = padRight(pad('both'));\nexport default 1;"
    );

    const evaluate = await h.bundler.compile();
    (evaluate as () => unknown)();

    // A second /dep_tree request, for both packages this time.
    expect(mockedFetchManifest).toHaveBeenCalledTimes(2);
    expect(Object.keys(mockedFetchManifest.mock.calls[1][0]).sort()).toEqual(['left-pad', 'right-pad']);
    expect(g.__rendered).toBe('[[both]]');
    expect(h.bundler.isFirstLoad).toBe(false);
  }, 60000);
});

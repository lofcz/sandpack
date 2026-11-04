import { underAppRoot } from '../../fsLayout';
import { fetchManifest, fetchModule, fetchModuleEntries } from '../module-registry/module-cdn';
import { createBundlerHarness, COMPILE_FIXTURE, type BundlerHarness } from './bundlerHarness';

jest.mock('../module-registry/module-cdn', () => ({
  ...jest.requireActual('../module-registry/module-cdn'),
  fetchManifest: jest.fn(),
  fetchModule: jest.fn(),
  fetchModuleEntries: jest.fn(),
}));

const mockedFetchManifest = fetchManifest as jest.MockedFunction<typeof fetchManifest>;
const mockedFetchModule = fetchModule as jest.MockedFunction<typeof fetchModule>;
const mockedFetchModuleEntries = fetchModuleEntries as jest.MockedFunction<typeof fetchModuleEntries>;

// Import-driven installs through the real resolver + `/node_modules` mount: an
// app import of a declared package the boot install did not cover installs it
// and resolves; nothing else ever reaches the CDN.
describe('[harness] resolving an app import installs the declared package on demand', () => {
  let h: BundlerHarness;
  const app = underAppRoot('/src/index.ts');

  beforeEach(async () => {
    mockedFetchManifest.mockReset();
    mockedFetchModule.mockReset();
    mockedFetchManifest.mockImplementation(async (deps) => Object.keys(deps).map((n) => ({ n, v: '1.0.0', d: 0 })));
    mockedFetchModuleEntries.mockReset();
    // The listing with the root entry inlined; `addon.js` is listed only.
    mockedFetchModule.mockImplementation(async (name) => ({
      f: {
        'package.json': { c: JSON.stringify({ name, version: '1.0.0', main: 'index.js' }), d: [], t: true },
        'index.js': { c: 'module.exports = {};', d: [], t: true },
        'addon.js': 40,
      },
      m: [],
    }));
    h = await createBundlerHarness(COMPILE_FIXTURE);
    // Boot: the app declares tooling and types it never imports; nothing is requested.
    await h.bundler.moduleRegistry.fetchManifest(
      { leftpad: '^1.0.0', vite: '^7.0.0', '@types/leftpad': '^1.0.0' },
      {},
    );
    mockedFetchManifest.mockClear();
  });

  afterEach(async () => {
    await h.teardown();
  });

  it('installs and resolves a declared package, even after a cached miss', async () => {
    // Warm the resolver's and the FS's negative caches the way a racing lookup would.
    await expect(h.bundler.fs.isFileAsync('/node_modules/leftpad/package.json')).resolves.toBe(false);

    await expect(h.bundler.resolveAsync('leftpad', app)).resolves.toBe('/node_modules/leftpad/index.js');
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);
    expect(mockedFetchManifest.mock.calls[0][0]).toEqual({ leftpad: '^1.0.0' });
    expect(Object.keys(mockedFetchManifest.mock.calls[0][1] ?? {})).toEqual(
      expect.arrayContaining(['vite', '@types/leftpad']),
    );
  });

  it('names an undeclared import instead of fetching it', async () => {
    await expect(h.bundler.resolveAsync('left-pad', app)).rejects.toThrow(
      /Cannot find module 'left-pad'.*"left-pad" is not listed in package.json dependencies/,
    );
    expect(mockedFetchManifest).not.toHaveBeenCalled();
  });

  it("never installs for a CDN package's own imports (the CDN owns their closure)", async () => {
    await h.bundler.moduleRegistry.ensurePackages(['leftpad']);
    mockedFetchManifest.mockClear();
    await h.bundler.moduleRegistry.fetchManifest({ leftpad: '^1.0.0', vite: '^7.0.0' }, {});
    mockedFetchManifest.mockClear();
    await expect(h.bundler.resolveAsync('vite', '/node_modules/leftpad/cli.js')).rejects.toThrow(/Cannot find module/);
    expect(mockedFetchManifest).not.toHaveBeenCalled();
  });

  it('installs for code in node_modules the CDN did not resolve (the self-hosted SDK)', async () => {
    await expect(
      h.bundler.resolveAsync('leftpad', '/node_modules/@immediately-run/sdk/dist/render.js'),
    ).resolves.toBe('/node_modules/leftpad/index.js');
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);
  });

  it('expands an installed package when a deep import lands on a file it did not inline', async () => {
    await h.bundler.resolveAsync('leftpad', app);
    mockedFetchManifest.mockClear();
    mockedFetchManifest.mockImplementation(async (deps, _pins, entries) =>
      Object.keys(deps).map((n) => ({ n, v: '1.0.0', d: 0, e: entries?.[n] })),
    );
    mockedFetchModuleEntries.mockResolvedValue({ f: { 'addon.js': { c: 'module.exports = 1;', d: [], t: true } }, m: [] });

    await expect(h.bundler.resolveAsync('leftpad/addon.js', app)).resolves.toBe('/node_modules/leftpad/addon.js');
    expect(mockedFetchManifest).toHaveBeenCalledWith({ leftpad: '1.0.0' }, expect.anything(), { leftpad: ['./addon.js'] });
    expect(mockedFetchModuleEntries).toHaveBeenCalledWith('leftpad', '1.0.0', ['./addon.js']);
    expect(h.bundler.moduleRegistry.modules.get('leftpad')!.files['addon.js']).toEqual({ c: 'module.exports = 1;', d: [], t: true });

    // Inlined now (and the root entry always was): resolving expands nothing.
    mockedFetchManifest.mockClear();
    await h.bundler.resolveAsync('leftpad/addon.js', app);
    await h.bundler.resolveAsync('leftpad', app);
    expect(mockedFetchManifest).not.toHaveBeenCalled();
  });
});

/**
 * @jest-environment node
 *
 * Import-driven installs: the boot install covers only what the app is known to
 * import; a declared package imported later installs through `ensurePackages`,
 * batched into one /dep_tree request that pins everything already installed.
 */
import { ModuleRegistry } from './index';
import { fetchManifest, fetchModule, fetchModuleEntries } from './module-cdn';

jest.mock('./module-cdn', () => ({
  CDN_VERSION: 7,
  fetchManifest: jest.fn(),
  fetchModule: jest.fn(),
  fetchModuleEntries: jest.fn(),
  mergeModuleParts: jest.requireActual('./module-cdn').mergeModuleParts,
}));

const mockedFetchManifest = fetchManifest as jest.MockedFunction<typeof fetchManifest>;
const mockedFetchModule = fetchModule as jest.MockedFunction<typeof fetchModule>;
const mockedFetchModuleEntries = fetchModuleEntries as jest.MockedFunction<typeof fetchModuleEntries>;

function stubBundler(): any {
  return {
    modules: new Map(),
    forgetMissingNodeModules: jest.fn(),
    fs: { readFileAsync: jest.fn(), readBytesAsync: jest.fn() },
  };
}

const DECLARED = {
  react: '^19.0.0',
  'react-dom': '^19.0.0',
  three: '^0.160.0',
  zod: '^3.23.0',
  vite: '^7.0.0',
};

describe('ModuleRegistry.ensurePackages', () => {
  let registry: ModuleRegistry;

  beforeEach(async () => {
    mockedFetchManifest.mockReset();
    mockedFetchModule.mockReset();
    mockedFetchManifest.mockImplementation(async (deps) =>
      Object.keys(deps).map((n) => ({ n, v: `${n === 'three' ? '0.160.1' : '1.0.0'}`, d: 0 })),
    );
    mockedFetchModule.mockResolvedValue({ f: {}, m: [] });
    registry = new ModuleRegistry(stubBundler(), null);
    await registry.fetchManifest(DECLARED, { react: DECLARED.react });
    await registry.preloadModules();
    mockedFetchManifest.mockClear();
  });

  it('batches concurrently discovered imports into one pinned request', async () => {
    await Promise.all([registry.ensurePackages(['three']), registry.ensurePackages(['zod', 'three'])]);
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);
    const [deps, pins] = mockedFetchManifest.mock.calls[0];
    expect(deps).toEqual({ three: '^0.160.0', zod: '^3.23.0' });
    // Declared ranges, with the installed react pinned to its exact version.
    expect(pins).toEqual({ ...DECLARED, react: '1.0.0' });
    expect(registry.modules.has('three')).toBe(true);
    expect(registry.modules.has('zod')).toBe(true);
  });

  it('ignores undeclared and already-installed packages', async () => {
    await registry.ensurePackages(['react', 'left-pad']);
    expect(mockedFetchManifest).not.toHaveBeenCalled();
    expect(registry.isDeclared('left-pad')).toBe(false);
  });

  it('runs later batches after earlier ones, pinning what they installed', async () => {
    await registry.ensurePackages(['three']);
    await registry.ensurePackages(['zod']);
    expect(mockedFetchManifest).toHaveBeenCalledTimes(2);
    expect(mockedFetchManifest.mock.calls[1][1]).toMatchObject({ react: '1.0.0', three: '0.160.1' });
  });

  it('reports a failed install to every importer and retries after a package.json edit', async () => {
    mockedFetchManifest.mockResolvedValueOnce([]); // the CDN drops zod
    await expect(registry.ensurePackages(['zod'])).rejects.toThrow(/Could not resolve package.*"zod@\^3\.23\.0"/);
    await expect(registry.ensurePackages(['zod'])).rejects.toThrow(/zod/);
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);

    registry.setDeclared({ ...DECLARED, zod: '^3.22.0' });
    await Promise.resolve();
    await registry.ensurePackages(['zod']);
    expect(mockedFetchManifest).toHaveBeenLastCalledWith(
      { zod: '^3.22.0' },
      expect.objectContaining({ zod: '^3.22.0' }),
      { zod: ['.'] },
    );
    expect(registry.modules.has('zod')).toBe(true);
  });

  it('expands an installed package with a deep entry at its installed release, with the entry\'s packages', async () => {
    await registry.ensureEntries('three', ['.']);
    const three = registry.modules.get('three')!;
    expect([...three.entries]).toEqual(['.']);
    mockedFetchManifest.mockClear();
    mockedFetchModule.mockClear();
    // The addon's closure imports `zod` (declared, not installed yet).
    mockedFetchManifest.mockResolvedValueOnce([
      { n: 'three', v: '0.160.1', d: 0, e: ['./addons/x.js'] },
      { n: 'zod', v: '3.23.8', d: 1, e: ['.'] },
    ]);
    mockedFetchModuleEntries.mockResolvedValueOnce({
      f: { 'examples/jsm/x.js': { c: 'x', d: ['zod'], t: true } },
      m: ['zod'],
    });

    await registry.ensureEntries('three', ['./addons/x.js']);

    const [deps, , entries] = mockedFetchManifest.mock.calls[0];
    expect(deps).toEqual({ three: '0.160.1' });
    expect(entries).toEqual({ three: ['./addons/x.js'] });
    expect(mockedFetchModuleEntries).toHaveBeenCalledWith('three', '0.160.1', ['./addons/x.js']);
    expect(mockedFetchModule).toHaveBeenCalledWith('zod', '3.23.8', ['.']);
    expect(mockedFetchModule).not.toHaveBeenCalledWith('three', expect.anything(), expect.anything());
    expect(three.files['examples/jsm/x.js']).toEqual({ c: 'x', d: ['zod'], t: true });
    expect([...three.entries].sort()).toEqual(['.', './addons/x.js']);
    expect(registry.modules.has('zod')).toBe(true);

    // Already expanded: nothing more is requested.
    mockedFetchManifest.mockClear();
    await registry.ensureEntries('three', ['./addons/x.js']);
    expect(mockedFetchManifest).not.toHaveBeenCalled();
  });
});

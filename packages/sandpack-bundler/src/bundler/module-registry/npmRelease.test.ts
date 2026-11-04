/**
 * @jest-environment node
 *
 * Every module records the npm release its files come from: an `npm:` alias
 * installs its target's files under the alias, and an esm.sh fallback keeps the
 * assets of the release esm.sh built.
 */
import { ModuleRegistry } from './index';
import { fetchManifest, fetchModule } from './module-cdn';
import { esmBuildVersion, fetchEsmFallbackRelease, synthesizeEsmFallbackModule, type EsmFallbackFetcher } from './esm-fallback';
import { ICDNModuleFile } from './module-cdn';

jest.mock('./module-cdn', () => ({
  CDN_VERSION: 5,
  fetchManifest: jest.fn(),
  fetchModule: jest.fn(),
}));

const mockedFetchManifest = fetchManifest as jest.MockedFunction<typeof fetchManifest>;
const mockedFetchModule = fetchModule as jest.MockedFunction<typeof fetchModule>;

const stubBundler = (): any => ({ modules: new Map(), fs: { readFileAsync: jest.fn(), readBytesAsync: jest.fn() } });

describe('npm alias', () => {
  beforeEach(() => {
    mockedFetchManifest.mockReset();
    mockedFetchModule.mockReset();
  });

  it("installs the target's files under the alias name", async () => {
    mockedFetchManifest.mockResolvedValueOnce([
      { n: 'react', v: '10.26.0', d: 0, s: 'preact' },
      { n: 'string-width-cjs', v: '4.2.3', d: 1, s: 'string-width' },
    ]);
    mockedFetchModule.mockImplementation(async (name) => ({
      f: { 'index.js': { c: `module.exports = ${JSON.stringify(name)};`, d: [], t: true } },
      m: [],
    }));
    const registry = new ModuleRegistry(stubBundler());
    await registry.fetchManifest({ react: 'npm:preact@^10' }, { react: 'npm:preact@^10' });
    await registry.preloadModules();

    expect(mockedFetchModule.mock.calls.map(([name, version]) => `${name}@${version}`).sort()).toEqual([
      'preact@10.26.0',
      'string-width@4.2.3',
    ]);
    expect(registry.modules.get('react')?.release).toEqual({ name: 'preact', version: '10.26.0' });
    expect(registry.modules.get('string-width-cjs')?.release).toEqual({ name: 'string-width', version: '4.2.3' });
  });
});

describe('esm.sh fallback release', () => {
  it('reads the version from the esm.sh build path', () => {
    expect(esmBuildVersion('lucide-react', '/lucide-react@0.400.0/X-ZXJlYWN0/es2022/lucide-react.mjs')).toBe('0.400.0');
    expect(esmBuildVersion('@scope/ui', 'https://esm.sh/@scope/ui@2.1.0-rc.1/es2022/ui.mjs')).toBe('2.1.0-rc.1');
    expect(esmBuildVersion('lucide-react', 'https://esm.sh/lucide-react@^0.400.0?target=es2022')).toBe('^0.400.0');
    expect(esmBuildVersion('lucide', '/lucide-react@0.400.0/es2022/lucide-react.mjs')).toBeNull();
    expect(esmBuildVersion('lucide-react', '/other@1.0.0/x.mjs')).toBeNull();
  });

  const listing: EsmFallbackFetcher = async (url) => {
    if (url === 'https://unpkg.com/@scope/ui@2.1.0/?meta') {
      return JSON.stringify({
        version: '2.1.0',
        files: [
          { path: '/package.json', size: 10 }, { path: '/dist/index.mjs', size: 900 }, { path: '/dist/index.d.ts', size: 50 },
          { path: '/dist/index.mjs.map', size: 80 }, { path: '/dist/style.css', size: 300 }, { path: '/fonts/ui.woff2', size: 2000 },
        ],
      });
    }
    if (url === 'https://unpkg.com/@scope/ui@2.1.0/package.json') {
      return JSON.stringify({ exports: { '.': { import: './dist/index.mjs' }, './style.css': './dist/style.css' } });
    }
    throw new Error(`HTTP 404 fetching ${url}`);
  };

  it('lists the non-script files of the release esm.sh built', async () => {
    const release = await fetchEsmFallbackRelease('@scope/ui', '/@scope/ui@2.1.0/es2022/ui.mjs', listing);
    expect(release?.release).toEqual({ name: '@scope/ui', version: '2.1.0' });
    expect(release?.assets).toEqual({ 'dist/style.css': 300, 'fonts/ui.woff2': 2000 });

    const module = synthesizeEsmFallbackModule('@scope/ui', '^2', 'module.exports = {};', [], release);
    expect(module.f['dist/style.css']).toBe(300);
    expect(JSON.parse((module.f['package.json'] as ICDNModuleFile).c)).toEqual({
      name: '@scope/ui',
      version: '2.1.0',
      main: 'index.js',
      exports: { './style.css': './dist/style.css', '.': './index.js', './package.json': './package.json' },
    });
  });

  it('stays code-only when the release cannot be confirmed', async () => {
    expect(await fetchEsmFallbackRelease('@scope/ui', '/@scope/ui@9.9.9/es2022/ui.mjs', listing)).toBeNull();
    expect(await fetchEsmFallbackRelease('@scope/ui', 'https://esm.sh/@scope/ui@^2', async () => '{"version":"2.1.0","files":[]}')).toBeNull();
    expect(await fetchEsmFallbackRelease('@scope/ui', '/x.mjs', listing)).toBeNull();
    const module = synthesizeEsmFallbackModule('@scope/ui', '^2', 'module.exports = {};', [], null);
    expect(Object.keys(module.f).sort()).toEqual(['index.js', 'package.json']);
  });
});

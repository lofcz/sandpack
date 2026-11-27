import { underAppRoot } from '../fsLayout';
import { fetchManifest, fetchModule, fetchModuleEntries } from '../bundler/module-registry/module-cdn';
import {
  createBundlerHarness,
  COMPILE_FIXTURE,
  installEvalGlobals,
  type BundlerHarness,
} from '../bundler/testHarness/bundlerHarness';

jest.mock('../bundler/module-registry/module-cdn', () => ({
  ...jest.requireActual('../bundler/module-registry/module-cdn'),
  fetchManifest: jest.fn(),
  fetchModule: jest.fn(),
  fetchModuleEntries: jest.fn(),
}));

const manifest = fetchManifest as jest.MockedFunction<typeof fetchManifest>;
const download = fetchModule as jest.MockedFunction<typeof fetchModule>;
const downloadEntries = fetchModuleEntries as jest.MockedFunction<typeof fetchModuleEntries>;

const inlined = (c: string, d: string[] = []) => ({ c, d, t: true });

// Package rules through the real bundler: its filesystem, its registry of CDN
// packages and its install paths, with the CDN's responses as it serves them.
describe('[harness] package exports and imports against CDN packages', () => {
  let h: BundlerHarness;
  let restore: () => void;
  const app = underAppRoot('/src/index.ts');

  beforeEach(async () => {
    restore = installEvalGlobals();
    manifest.mockReset();
    download.mockReset();
    downloadEntries.mockReset();
    manifest.mockImplementation(async (deps, _pins, entries) =>
      Object.keys(deps).map((n) => ({ n, v: '1.0.0', d: 0, e: entries?.[n] }))
    );
    h = await createBundlerHarness(COMPILE_FIXTURE);
  });

  afterEach(async () => {
    await h.teardown();
    restore();
  });

  it('resolves three/addons/… to a file the CDN listed but did not ship, and fetches its closure', async () => {
    const pkg = {
      name: 'three',
      main: './build/three.cjs',
      exports: {
        '.': { import: './build/three.module.js', require: './build/three.cjs' },
        './addons/*': './examples/jsm/*',
        './examples/jsm/*': './examples/jsm/*',
      },
    };
    // What the CDN serves for the root entry: its closure inlined, the rest listed by size.
    download.mockResolvedValue({
      f: {
        'package.json': inlined(JSON.stringify(pkg)),
        'build/three.cjs': inlined('module.exports = { name: "three" };'),
        'build/three.module.js': 900,
        'examples/jsm/controls/OrbitControls.js': 40,
      },
      m: [],
    });
    downloadEntries.mockResolvedValue({
      f: { 'examples/jsm/controls/OrbitControls.js': inlined('exports.OrbitControls = require("three").name;', ['three']) },
      m: [],
    });
    await h.bundler.moduleRegistry.fetchManifest({ three: '^1.0.0' }, {});
    await h.bundler.moduleRegistry.ensurePackages(['three']);

    await expect(h.bundler.resolveAsync('three/addons/controls/OrbitControls.js', app)).resolves.toBe(
      '/node_modules/three/examples/jsm/controls/OrbitControls.js'
    );
    // The file path is the entry the deployed CDN is asked to expand.
    expect(downloadEntries).toHaveBeenCalledWith('three', '1.0.0', ['./examples/jsm/controls/OrbitControls.js']);
    const orbit = h.bundler.getModule('/node_modules/three/examples/jsm/controls/OrbitControls.js');
    expect(orbit!.evaluate().context.exports.OrbitControls).toBe('three');
  });

  it('links a precompiled file that imports a #name of its own package', async () => {
    const pkg = {
      name: 'vfile',
      exports: './index.js',
      imports: { '#minpath': { node: './lib/minpath.js', default: './lib/minpath.browser.js' } },
    };
    download.mockResolvedValue({
      f: {
        'package.json': inlined(JSON.stringify(pkg)),
        'index.js': inlined('module.exports = require("#minpath");', ['#minpath']),
        'lib/minpath.js': 120,
        'lib/minpath.browser.js': inlined('module.exports = { build: "browser" };'),
      },
      m: [],
    });
    await h.bundler.moduleRegistry.fetchManifest({ vfile: '^1.0.0' }, {});
    await h.bundler.moduleRegistry.ensurePackages(['vfile']);

    await expect(h.bundler.resolveAsync('vfile', app)).resolves.toBe('/node_modules/vfile/index.js');
    const entry = h.bundler.getModule('/node_modules/vfile/index.js');
    expect(entry!.dependencyMap.get('#minpath')).toBe('/node_modules/vfile/lib/minpath.browser.js');
    expect(entry!.evaluate().context.exports).toEqual({ build: 'browser' });
    // Nothing more was asked of the CDN: the browser build was already inlined.
    expect(downloadEntries).not.toHaveBeenCalled();
  });
});

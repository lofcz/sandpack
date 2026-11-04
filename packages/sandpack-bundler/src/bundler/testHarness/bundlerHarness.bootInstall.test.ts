import { fetchManifest, fetchModule } from '../module-registry/module-cdn';
import { createBundlerHarness, type BundlerHarness } from './bundlerHarness';

jest.mock('../module-registry/module-cdn', () => ({
  ...jest.requireActual('../module-registry/module-cdn'),
  fetchManifest: jest.fn(),
  fetchModule: jest.fn(),
}));

const mockedFetchManifest = fetchManifest as jest.MockedFunction<typeof fetchManifest>;
const mockedFetchModule = fetchModule as jest.MockedFunction<typeof fetchModule>;

// The generated three.js game from the sciobot-next session (2026-11-04) that
// executed `@types/three` as JavaScript: it declares types and tooling next to
// its runtime packages, imports `three` through a namespace import plus a
// type-only import, and keeps a Vite `src/main` shim.
const GAME_FIXTURE: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'space-invaders-3d',
    main: 'src/App.ts',
    dependencies: {
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      three: '0.160.0',
      '@types/three': '0.160.0',
      '@types/react': '^19.0.0',
      csstype: '^3.1.0',
      vite: '^7.0.0',
    },
  }),
  'index.html': '<!doctype html><div id="root"></div>',
  // JSX-free: the harness Babel loopback cannot lazy-load the JSX plugins.
  'src/App.ts': [
    "import { createElement, useEffect, useRef } from 'react';",
    "import { createScene } from './scene';",
    "import { canvasStyle } from './style';",
    'export default function App() {',
    '  const mount = useRef<HTMLDivElement>(null);',
    '  useEffect(() => createScene(mount.current!), []);',
    "  return createElement('div', { ref: mount, style: canvasStyle });",
    '}',
  ].join('\n'),
  // A types-only package used only in type positions: Babel erases the import.
  'src/style.ts': [
    "import { Properties } from 'csstype';",
    "import { type Property } from 'csstype';",
    "const cursor: Property.Cursor = 'crosshair';",
    'export const canvasStyle: Properties = { cursor };',
  ].join('\n'),
  'src/scene.ts': [
    "import * as THREE from 'three';",
    "import type { Mesh } from 'three';",
    'export function createScene(el: HTMLElement) {',
    '  const mesh: Mesh = new THREE.Mesh();',
    '  el.dataset.mesh = String(mesh.id);',
    '  return () => {};',
    '}',
  ].join('\n'),
  // The Vite shim compile never runs: only its side-effect import is applied.
  'src/main.ts': [
    "import './polyfill';",
    "import { createRoot } from 'react-dom/client';",
    "import { createElement } from 'react';",
    "import App from './App';",
    "createRoot(document.getElementById('root')!).render(createElement(App));",
  ].join('\n'),
  'src/polyfill.ts': "import 'core-js/stable/array/at';\nexport {};",
  'vite.config.ts': "import { defineConfig } from 'vite';\nexport default defineConfig({});",
};

const PACKAGE_FILES = {
  'package.json': (name: string) => JSON.stringify({ name, version: '1.0.0', main: 'index.js' }),
};

describe('[harness] live boot installs everything the app imports in one request', () => {
  let h: BundlerHarness;

  beforeAll(async () => {
    mockedFetchManifest.mockImplementation(async (deps) => Object.keys(deps).map((n) => ({ n, v: '1.0.0', d: 0 })));
    mockedFetchModule.mockImplementation(async (name) => ({
      f: {
        'package.json': { c: PACKAGE_FILES['package.json'](name), d: [], t: true },
        'index.js': { c: 'module.exports = {};', d: [], t: true },
        'jsx-runtime.js': { c: 'module.exports = { jsx(){}, jsxs(){} };', d: [], t: true },
        'stable/array/at.js': { c: 'module.exports = {};', d: [], t: true },
      },
      m: [],
    }));
    h = await createBundlerHarness(GAME_FIXTURE, { forCompile: true });
    await h.bundler.compile();
  }, 60000);

  afterAll(async () => {
    await h.teardown();
  });

  it('sends a single /dep_tree request', () => {
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);
  });

  it('requests exactly the imported declared packages plus the preset implicits', () => {
    const [deps, pins] = mockedFetchManifest.mock.calls[0];
    expect(Object.keys(deps).sort()).toEqual(['core-js', 'react', 'react-error-boundary', 'react-refresh', 'three']);
    // Types, type-only usage and tooling are declared (pinned) but never requested.
    expect(pins).toMatchObject({ '@types/three': '0.160.0', csstype: '^3.1.0', vite: '^7.0.0' });
  });

  it('transformed each app module once: compile adopted the boot scan\'s results', () => {
    const appTransforms = h.babel.transformRequests.filter((path) => path.startsWith('/app/'));
    expect(appTransforms.sort()).toEqual(['/app/src/App.ts', '/app/src/polyfill.ts', '/app/src/scene.ts', '/app/src/style.ts']);
  });

  it('compiled the whole graph without installing anything on demand', () => {
    expect([...h.bundler.modules.keys()].some((path) => path.endsWith('/src/scene.ts'))).toBe(true);
    expect([...h.bundler.moduleRegistry.modules.keys()].sort()).toEqual(
      ['core-js', 'react', 'react-error-boundary', 'react-refresh', 'three'],
    );
  });
});

import gensync from 'gensync';

import { ModuleNotFoundError } from '../errors/ModuleNotFound';
import { PackageImportNotDefinedError, PackagePathNotExportedError } from './errors';
import { resolveSync } from './resolver';

// The extension set the bundler resolves scripts with (bundler.ts DEFAULT_EXTENSIONS).
const EXTS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mdx'];

type Files = Record<string, string | object>;

/** Resolve against an in-memory tree; object values are written as JSON. */
function tree(files: Files) {
  const contents = new Map(
    Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? value : JSON.stringify(value)])
  );
  const probed: string[] = [];
  const read: string[] = [];
  const isFile = gensync({
    sync: (p: string) => {
      probed.push(p);
      return contents.has(p);
    },
  });
  const readFile = gensync({
    sync: (p: string) => {
      read.push(p);
      const content = contents.get(p);
      if (content === undefined) throw new Error('File not found');
      return content;
    },
  });
  const resolve = (specifier: string, filename: string, extensions: string[] = EXTS) =>
    resolveSync(specifier, { filename, extensions, isFile, readFile });
  return { resolve, probed, read };
}

const pkg = (name: string, json: object, files: string[]): Files => ({
  [`/node_modules/${name}/package.json`]: { name, ...json },
  ...Object.fromEntries(files.map((f) => [`/node_modules/${name}/${f}`, ''])),
});

describe('package.json exports (Node PACKAGE_EXPORTS_RESOLVE)', () => {
  const three = pkg(
    'three',
    {
      main: './build/three.cjs',
      module: './build/three.module.js',
      exports: {
        '.': { import: './build/three.module.js', require: './build/three.cjs' },
        './addons': './examples/jsm/Addons.js',
        './addons/*': './examples/jsm/*',
        './examples/jsm/*': './examples/jsm/*',
      },
    },
    ['build/three.cjs', 'build/three.module.js', 'examples/jsm/Addons.js', 'examples/jsm/controls/OrbitControls.js']
  );

  it('resolves a subpath pattern whose "*" spans directories (three/addons/…)', () => {
    const { resolve } = tree(three);
    expect(resolve('three/addons/controls/OrbitControls.js', '/app/src/App.tsx')).toBe(
      '/node_modules/three/examples/jsm/controls/OrbitControls.js'
    );
    expect(resolve('three/addons', '/app/src/App.tsx')).toBe('/node_modules/three/examples/jsm/Addons.js');
    // Condition priority is unchanged: require before import.
    expect(resolve('three', '/app/src/App.tsx')).toBe('/node_modules/three/build/three.cjs');
    // A package importing itself by name.
    expect(resolve('three', '/node_modules/three/examples/jsm/controls/OrbitControls.js')).toBe(
      '/node_modules/three/build/three.cjs'
    );
  });

  it('gives the longest matching prefix the subpath', () => {
    const { resolve } = tree(
      pkg('ui', { exports: { './*': './dist/*.js', './icons/*': './dist/icons/*/index.js' } }, [
        'dist/button.js',
        'dist/icons/a/b.js',
        'dist/icons/a/b/index.js',
      ])
    );
    expect(resolve('ui/button', '/app/a.ts')).toBe('/node_modules/ui/dist/button.js');
    expect(resolve('ui/icons/a/b', '/app/a.ts')).toBe('/node_modules/ui/dist/icons/a/b/index.js');
  });

  it('reads top-level conditions as the package entry (chalk 6, decode-named-character-reference)', () => {
    const { resolve } = tree({
      ...pkg('chalk', { exports: { types: './source/index.d.ts', default: './source/index.js' } }, ['source/index.js']),
      ...pkg(
        'decode-named-character-reference',
        { main: 'index.js', exports: { deno: './index.js', browser: './index.dom.js', default: './index.js' } },
        ['index.js', 'index.dom.js']
      ),
    });
    expect(resolve('chalk', '/app/a.ts')).toBe('/node_modules/chalk/source/index.js');
    expect(resolve('decode-named-character-reference', '/app/a.ts')).toBe(
      '/node_modules/decode-named-character-reference/index.dom.js'
    );
  });

  it('follows nested conditions and array fallbacks, and falls through a condition that leads nowhere', () => {
    const { resolve } = tree(
      pkg(
        'cond',
        {
          exports: {
            '.': { types: { default: './a.d.ts' }, browser: { module: './a.browser.esm.js', default: './a.browser.cjs.js' }, default: './a.cjs.js' },
            './list': [{ node: './node.js' }, './list.js'],
            './through': { browser: { node: './node-only.js' }, default: './through.js' },
          },
        },
        ['a.browser.cjs.js', 'a.cjs.js', 'list.js', 'through.js', 'node-only.js']
      )
    );
    expect(resolve('cond', '/app/a.ts')).toBe('/node_modules/cond/a.browser.cjs.js');
    expect(resolve('cond/list', '/app/a.ts')).toBe('/node_modules/cond/list.js');
    expect(resolve('cond/through', '/app/a.ts')).toBe('/node_modules/cond/through.js');
  });

  it('refuses a null target and browser-less conditions, naming the specifier and the package', () => {
    const { resolve } = tree(
      pkg('guarded', { exports: { '.': './index.js', './internal': null, './server': { node: './server.js' } } }, [
        'index.js',
        'internal.js',
        'server.js',
      ])
    );
    for (const specifier of ['guarded/internal', 'guarded/server']) {
      let error: unknown;
      try {
        resolve(specifier, '/app/src/App.tsx');
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(PackagePathNotExportedError);
      // Still a module-not-found error to the bundler's install and reporting paths.
      expect(error).toBeInstanceOf(ModuleNotFoundError);
      expect((error as Error).message).toContain('is not exported by the package "guarded"');
      expect((error as Error).message).toContain(`'${specifier}' from '/app/src/App.tsx'`);
    }
  });

  it('loads an unlisted path that names a file of the package, and refuses one that names nothing', () => {
    const { resolve } = tree(pkg('listed', { exports: { '.': './index.js' } }, ['index.js', 'dist/extra.js']));
    // The CDN serves file paths as entries and the bundler's own lookups use them.
    expect(resolve('listed/dist/extra.js', '/app/a.ts')).toBe('/node_modules/listed/dist/extra.js');
    expect(resolve('listed/package.json', '/app/a.ts', [])).toBe('/node_modules/listed/package.json');
    expect(() => resolve('listed/nope', '/app/a.ts')).toThrow(
      /Package path "\.\/nope" is not exported by the package "listed".*'listed\/nope' from '\/app\/a\.ts'/
    );
  });

  it('lets exports, not a nested package.json, decide a subpath', () => {
    const { resolve } = tree({
      ...pkg('emo', { exports: { '.': './dist/emo.cjs.js', './jsx-runtime': { browser: './jsx-runtime/dist/browser.cjs.js', default: './jsx-runtime/dist/cjs.js' } } }, [
        'dist/emo.cjs.js',
        'jsx-runtime/dist/browser.cjs.js',
        'jsx-runtime/dist/cjs.js',
        'jsx-runtime/dist/esm.js',
      ]),
      '/node_modules/emo/jsx-runtime/package.json': { main: 'dist/cjs.js', module: 'dist/esm.js' },
    });
    expect(resolve('emo/jsx-runtime', '/app/a.tsx')).toBe('/node_modules/emo/jsx-runtime/dist/browser.cjs.js');
  });

  it("does not rewrite the package's own relative imports", () => {
    const { resolve } = tree(
      pkg('dual', { exports: { '.': './index.js', './feature': './esm/feature.js' } }, ['index.js', 'feature.js', 'esm/feature.js'])
    );
    expect(resolve('dual/feature', '/app/a.ts')).toBe('/node_modules/dual/esm/feature.js');
    expect(resolve('./feature', '/node_modules/dual/index.js')).toBe('/node_modules/dual/feature.js');
  });
});

describe('modules without a package.json at the package root', () => {
  it('resolves through the package.json beside the file (bundler-written modules)', () => {
    const { resolve } = tree({
      '/node_modules/react-refresh/runtime/package.json': { main: 'index.js' },
      '/node_modules/react-refresh/runtime/index.js': '',
    });
    expect(resolve('react-refresh/runtime', '/app/a.tsx')).toBe('/node_modules/react-refresh/runtime/index.js');
  });
});

describe('the browser map and exports together (axios)', () => {
  const axios = pkg(
    'axios',
    {
      main: './dist/node/axios.cjs',
      module: './index.js',
      browser: {
        './dist/node/axios.cjs': './dist/browser/axios.cjs',
        './lib/adapters/http.js': './lib/helpers/null.js',
        './lib/platform/node/index.js': './lib/platform/browser/index.js',
      },
      exports: {
        '.': { browser: { require: './dist/browser/axios.cjs', default: './index.js' }, default: { require: './dist/node/axios.cjs', default: './index.js' } },
        './lib/adapters/http.js': './lib/adapters/http.js',
        './unsafe/*': './lib/*',
      },
    },
    ['index.js', 'lib/adapters/adapters.js', 'lib/adapters/http.js', 'lib/helpers/null.js', 'lib/platform/node/index.js', 'lib/platform/browser/index.js', 'lib/platform/index.js']
  );

  it('replaces a file that exports lists under the same key', () => {
    const { resolve } = tree(axios);
    const adapters = '/node_modules/axios/lib/adapters/adapters.js';
    expect(resolve('./http.js', adapters)).toBe('/node_modules/axios/lib/helpers/null.js');
    expect(resolve('./http', adapters)).toBe('/node_modules/axios/lib/helpers/null.js');
    expect(resolve('./node/index.js', '/node_modules/axios/lib/platform/index.js')).toBe(
      '/node_modules/axios/lib/platform/browser/index.js'
    );
  });

  it('applies the browser map to what exports resolves to', () => {
    const { resolve } = tree(axios);
    expect(resolve('axios/lib/adapters/http.js', '/app/a.ts')).toBe('/node_modules/axios/lib/helpers/null.js');
    expect(resolve('axios/unsafe/adapters/http.js', '/app/a.ts')).toBe('/node_modules/axios/lib/helpers/null.js');
    expect(resolve('axios', '/app/a.ts')).toBe('/node_modules/axios/index.js');
  });
});

describe('browser map values without "./"', () => {
  const files = {
    ...pkg('sloppy', { main: 'index.js', browser: { './node.js': 'browser.js', ws: 'ws-shim.js', fs: 'memfs' } }, [
      'index.js',
      'node.js',
      'browser.js',
      'ws-shim.js',
    ]),
    ...pkg('memfs', { main: 'index.js' }, ['index.js']),
  };

  it('name a file of the package when it has one', () => {
    const { resolve } = tree(files);
    expect(resolve('./node', '/node_modules/sloppy/index.js')).toBe('/node_modules/sloppy/browser.js');
    expect(resolve('./node.js', '/node_modules/sloppy/index.js')).toBe('/node_modules/sloppy/browser.js');
    expect(resolve('ws', '/node_modules/sloppy/index.js')).toBe('/node_modules/sloppy/ws-shim.js');
  });

  it('name a module otherwise', () => {
    const { resolve } = tree(files);
    expect(resolve('fs', '/node_modules/sloppy/index.js')).toBe('/node_modules/memfs/index.js');
  });
});

describe('package.json imports (Node PACKAGE_IMPORTS_RESOLVE)', () => {
  const files = {
    ...pkg(
      'vfile',
      {
        exports: './index.js',
        imports: {
          '#minpath': { node: './lib/minpath.js', default: './lib/minpath.browser.js' },
          '#dep': { node: 'dep-node', default: 'dep-browser' },
          '#internal/*': './lib/internal/*.js',
          '#node-only': { node: './lib/minpath.js' },
        },
      },
      ['index.js', 'lib/index.js', 'lib/minpath.js', 'lib/minpath.browser.js', 'lib/internal/a/b.js']
    ),
    ...pkg('dep-browser', { main: 'main.js' }, ['main.js']),
    // A different package with the same name defined differently.
    ...pkg('other', { imports: { '#minpath': './other.js' } }, ['index.js', 'other.js']),
    '/app/package.json': { name: 'app', imports: { '#components/*': './src/components/*' } },
    '/app/src/components/Button.tsx': '',
    '/app/src/App.tsx': '',
  };

  it("resolves a #name against the importing file's package", () => {
    const { resolve } = tree(files);
    expect(resolve('#minpath', '/node_modules/vfile/lib/index.js')).toBe('/node_modules/vfile/lib/minpath.browser.js');
    expect(resolve('#internal/a/b', '/node_modules/vfile/lib/index.js')).toBe('/node_modules/vfile/lib/internal/a/b.js');
    expect(resolve('#minpath', '/node_modules/other/index.js')).toBe('/node_modules/other/other.js');
  });

  it('resolves a #name that names another package from the package root', () => {
    const { resolve } = tree(files);
    expect(resolve('#dep', '/node_modules/vfile/lib/index.js')).toBe('/node_modules/dep-browser/main.js');
  });

  it("resolves the app's own imports", () => {
    const { resolve } = tree(files);
    expect(resolve('#components/Button', '/app/src/App.tsx')).toBe('/app/src/components/Button.tsx');
  });

  it('reports a name that is not defined for the browser', () => {
    const { resolve } = tree(files);
    for (const specifier of ['#nope', '#node-only']) {
      let error: unknown;
      try {
        resolve(specifier, '/node_modules/vfile/lib/index.js');
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(PackageImportNotDefinedError);
      expect(error).toBeInstanceOf(ModuleNotFoundError);
      expect((error as Error).message).toContain(`'${specifier}'`);
      expect((error as Error).message).toContain('/node_modules/vfile/package.json');
      expect((error as Error).message).toContain("'/node_modules/vfile/lib/index.js'");
    }
  });
});

describe('TypeScript-style imports', () => {
  const files = {
    '/app/package.json': { name: 'app' },
    '/app/src/App.tsx': '',
    '/app/src/utils.ts': '',
    '/app/src/View.tsx': '',
    '/app/src/Card.tsx': '',
    '/app/src/esm.mts': '',
    '/app/src/common.cts': '',
    '/app/src/both.js': '',
    '/app/src/both.ts': '',
    '/app/src/data.json': '{}',
    '/app/src/styles.json': '{}',
  };
  const from = '/app/src/App.tsx';

  it('resolves a JavaScript extension to the TypeScript source when only that exists', () => {
    const { resolve } = tree(files);
    expect(resolve('./utils.js', from)).toBe('/app/src/utils.ts');
    expect(resolve('./View.js', from)).toBe('/app/src/View.tsx');
    expect(resolve('./Card.jsx', from)).toBe('/app/src/Card.tsx');
    expect(resolve('./esm.mjs', from)).toBe('/app/src/esm.mts');
    expect(resolve('./common.cjs', from)).toBe('/app/src/common.cts');
    // The file the import names wins when it exists.
    expect(resolve('./both.js', from)).toBe('/app/src/both.js');
    expect(() => resolve('./missing.js', from)).toThrow(ModuleNotFoundError);
  });

  it('resolves an extensionless import to a .json file', () => {
    const { resolve } = tree(files);
    expect(resolve('./data', from)).toBe('/app/src/data.json');
  });

  it('keeps both fallbacks to script resolution', () => {
    const { resolve } = tree(files);
    // A stylesheet lookup must not land on a script or a JSON file.
    expect(() => resolve('./styles', from, ['.css'])).toThrow(ModuleNotFoundError);
    expect(() => resolve('./utils.js', from, ['.css'])).toThrow(ModuleNotFoundError);
  });

  it('probes nothing extra for an import that resolves', () => {
    const { resolve, probed } = tree(files);
    resolve('./both.js', from);
    resolve('./utils', from);
    expect(probed.filter((p) => p.endsWith('.json') || p.endsWith('.mts') || p.endsWith('.cts'))).toEqual([]);
  });
});

describe('tsconfig / jsconfig paths under the app root', () => {
  const app = {
    '/app/package.json': { name: 'app' },
    '/app/src/App.tsx': '',
    '/app/src/components/Button.tsx': '',
    '/app/src/lib/math.ts': '',
  };
  const from = '/app/src/App.tsx';

  it('reads /app/tsconfig.json and maps paths without baseUrl', () => {
    const { resolve } = tree({ ...app, '/app/tsconfig.json': { compilerOptions: { paths: { '@/*': ['./src/*'] } } } });
    expect(resolve('@/components/Button', from)).toBe('/app/src/components/Button.tsx');
    expect(resolve('@/lib/math', from)).toBe('/app/src/lib/math.ts');
  });

  it('reads /app/jsconfig.json when there is no tsconfig', () => {
    const { resolve } = tree({ ...app, '/app/jsconfig.json': { compilerOptions: { baseUrl: 'src' } } });
    expect(resolve('components/Button', from)).toBe('/app/src/components/Button.tsx');
  });

  it('follows one level of relative extends', () => {
    const { resolve } = tree({
      ...app,
      '/app/tsconfig.json': '{ "extends": "./tsconfig.base", /* own options */ "compilerOptions": { "strict": true } }',
      '/app/tsconfig.base.json': { compilerOptions: { baseUrl: '.', paths: { '~lib/*': ['src/lib/*'] } } },
    });
    expect(resolve('~lib/math', from)).toBe('/app/src/lib/math.ts');
  });

  it('does not read the app config for a declared package that is not installed yet', () => {
    const { resolve, read } = tree({
      ...app,
      '/app/package.json': { name: 'app', dependencies: { zustand: '^5.0.0' } },
      '/app/tsconfig.json': { compilerOptions: { paths: { '@/*': ['./src/*'] } } },
    });
    // The bundler installs it on this error and resolves again.
    expect(() => resolve('zustand/middleware', from)).toThrow("Cannot find module 'zustand/middleware'");
    expect(read.filter((p) => p.startsWith('/app/') && p.endsWith('config.json'))).toEqual([]);
  });

  it('does not read the app config for an import an installed package answers', () => {
    const { resolve, read } = tree({
      ...app,
      '/app/tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } },
      ...pkg('react', { main: 'index.js' }, ['index.js']),
    });
    expect(resolve('react', from)).toBe('/node_modules/react/index.js');
    // Under the app root every lookup is a round trip to the host.
    expect(read.filter((p) => p.startsWith('/app/') && p.endsWith('config.json'))).toEqual([]);
  });
});

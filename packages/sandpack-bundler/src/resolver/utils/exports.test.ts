import { resolvePackageExports, resolvePackageImports } from './exports';

const file = (path: string) => ({ target: { kind: 'file', path } });

describe('package.json exports', () => {
  it('lets "*" span slashes and substitutes it in the target', () => {
    const exports = { '.': './build/three.cjs', './addons/*': './examples/jsm/*' };
    expect(resolvePackageExports(exports, './addons/controls/OrbitControls.js')).toEqual(
      file('examples/jsm/controls/OrbitControls.js')
    );
  });

  it('prefers an exact key, then the pattern with the longest prefix, then the longer key', () => {
    const exports = {
      './*': './dist/*.js',
      './features/*': './src/features/*.js',
      './features/*.css': './styles/*.css',
      './features/exact': './exact.js',
    };
    expect(resolvePackageExports(exports, './features/exact')).toEqual(file('exact.js'));
    expect(resolvePackageExports(exports, './features/a/b')).toEqual(file('src/features/a/b.js'));
    expect(resolvePackageExports(exports, './features/a.css')).toEqual(file('styles/a.css'));
    expect(resolvePackageExports(exports, './other')).toEqual(file('dist/other.js'));
    // A pattern needs something for its "*".
    expect(resolvePackageExports({ './features/*': './f/*' }, './features/')).toEqual({ reason: 'unmatched' });
  });

  it('reads conditions written at the top level as the package itself', () => {
    const exports = { types: './source/index.d.ts', default: './source/index.js' };
    expect(resolvePackageExports(exports, '.')).toEqual(file('source/index.js'));
    expect(resolvePackageExports(exports, './default')).toEqual({ reason: 'unmatched' });
    expect(resolvePackageExports('./index.js', '.')).toEqual(file('index.js'));
  });

  it('follows nested conditions and arrays of fallbacks', () => {
    const exports = {
      '.': {
        types: { import: './a.d.mts', default: './a.d.ts' },
        browser: { module: './a.browser.esm.js', default: './a.browser.cjs.js' },
        default: './a.cjs.js',
      },
      './list': [{ node: './node.js' }, './list.js'],
    };
    expect(resolvePackageExports(exports, '.')).toEqual(file('a.browser.cjs.js'));
    expect(resolvePackageExports(exports, './list')).toEqual(file('list.js'));
  });

  it('goes on to the next condition when the first leads nowhere', () => {
    const exports = { '.': { browser: { node: './node-in-browser.js' }, default: './fallback.js' } };
    expect(resolvePackageExports(exports, '.')).toEqual(file('fallback.js'));
  });

  it('reports a null target and unsatisfied conditions as excluded', () => {
    const exports = { '.': './index.js', './internal': null, './server': { node: './server.js' }, './off': { browser: null, default: './on.js' } };
    expect(resolvePackageExports(exports, './internal')).toEqual({ reason: 'excluded' });
    expect(resolvePackageExports(exports, './server')).toEqual({ reason: 'excluded' });
    // null under a satisfied condition ends the search, as in Node.
    expect(resolvePackageExports(exports, './off')).toEqual({ reason: 'excluded' });
    expect(resolvePackageExports(exports, './missing')).toEqual({ reason: 'unmatched' });
  });

  it('keeps a target inside the package', () => {
    expect(resolvePackageExports({ './x': '../outside.js' }, './x')).toEqual({ reason: 'excluded' });
    expect(resolvePackageExports({ './lib/*': './lib/*' }, './lib/../../secret')).toEqual({ reason: 'excluded' });
  });

  it('maps a directory key ("./lib/") by appending the rest', () => {
    expect(resolvePackageExports({ './lib/': './src/' }, './lib/a/b.js')).toEqual(file('src/a/b.js'));
  });
});

describe('package.json imports', () => {
  const imports = {
    '#minpath': { node: './lib/minpath.js', default: './lib/minpath.browser.js' },
    '#ansi-styles': './source/vendor/ansi-styles/index.js',
    '#dep': { node: 'dep-node', default: 'dep-browser/sub' },
    '#internal/*': './src/internal/*.js',
  };

  it('resolves a name through the same conditions', () => {
    expect(resolvePackageImports(imports, '#minpath')).toEqual(file('lib/minpath.browser.js'));
    expect(resolvePackageImports(imports, '#ansi-styles')).toEqual(file('source/vendor/ansi-styles/index.js'));
    expect(resolvePackageImports(imports, '#internal/a/b')).toEqual(file('src/internal/a/b.js'));
  });

  it('may name another module', () => {
    expect(resolvePackageImports(imports, '#dep')).toEqual({ target: { kind: 'module', specifier: 'dep-browser/sub' } });
  });

  it('reports an undefined name', () => {
    expect(resolvePackageImports(imports, '#nope')).toEqual({ reason: 'unmatched' });
    expect(resolvePackageImports(undefined, '#nope')).toEqual({ reason: 'unmatched' });
  });
});

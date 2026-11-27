import fs from 'fs';
import path from 'path';

import { resolvePackageExports } from './exports';
import { processPackageJSON } from './pkg-json';

const FIXTURE_PATH = path.join(__dirname, '../fixture');
const fixture = (file: string) => JSON.parse(fs.readFileSync(path.join(FIXTURE_PATH, file), 'utf-8'));

describe('process package.json', () => {
  it('keeps pkg.exports out of the aliases (@babel/runtime)', () => {
    const processed = processPackageJSON(fixture('node_modules/@babel/runtime/package.json'), '/node_modules/@babel/runtime');
    // No main file and no "." export: nothing is aliased, the exports stay as data.
    expect(processed.aliases).toEqual({});
    expect(processed.name).toBe('@babel/runtime');
    expect(resolvePackageExports(processed.exports, './helpers/esm/extends')).toEqual({
      target: { kind: 'file', path: 'helpers/esm/extends.js' },
    });
    expect(resolvePackageExports(processed.exports, './helpers/extends')).toEqual({
      target: { kind: 'file', path: 'helpers/extends.js' },
    });
  });

  it('aliases only the main file and the browser map for nested pkg#exports (solid-js)', () => {
    const processed = processPackageJSON(fixture('node_modules/solid-js/package.json'), '/node_modules/solid-js');
    expect(processed.aliases).toEqual({
      // exports["."]: browser, then require (the bundler's condition priority)
      '/node_modules/solid-js': '/node_modules/solid-js/dist/solid.cjs',
      '/node_modules/solid-js/dist/server.cjs': '/node_modules/solid-js/dist/solid.cjs',
      '/node_modules/solid-js/dist/server.js': '/node_modules/solid-js/dist/solid.js',
    });
    expect(resolvePackageExports(processed.exports, './universal')).toEqual({
      target: { kind: 'file', path: 'universal/dist/dev.cjs' },
    });
    expect(resolvePackageExports(processed.exports, './web/dist/web.js')).toEqual({
      target: { kind: 'file', path: 'web/dist/web.js' },
    });
  });

  it('does not load exports from the root pkg.json', () => {
    const processed = processPackageJSON(fixture('package.json'), '/');
    expect(processed.exports).toBeUndefined();
    expect(processed.aliases).toMatchObject({
      aliased: 'foo',
      'aliased-file': '/bar.js',
      'glob/*/*': '/nested/$2',
      something: '/nested/test.js',
    });
  });

  it('remembers browser values written without "./" as possible files of the package', () => {
    const processed = processPackageJSON(
      { name: 'x', browser: { './node.js': 'browser.js', fs: 'memfs', './a.js': './b.js', net: false } },
      '/node_modules/x'
    );
    expect(processed.browserFiles).toEqual({
      'browser.js': '/node_modules/x/browser.js',
      memfs: '/node_modules/x/memfs',
    });
    expect(processed.aliases['/node_modules/x/node.js']).toBe('browser.js');
  });
});

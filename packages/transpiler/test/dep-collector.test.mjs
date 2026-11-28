// The dependency list a transform reports: every specifier known at build time,
// and nothing for a `require()`/`import()` whose argument is only known when the
// code runs.
import { test } from '@rstest/core';
import assert from 'node:assert/strict';

import { transformBabel, transformFile, PLAIN_BABEL_CONFIG } from '../dist/index.js';

const deps = async (code) =>
  [...(await transformBabel({ code, filepath: '/app/src/x.ts', config: PLAIN_BABEL_CONFIG })).dependencies];

test('a computed require() or import() is not reported as a dependency', async () => {
  const collected = await deps(
    [
      "import fixed from './fixed';",
      'export const a = require(name);',
      "export const b = (n: string) => import('./pages/' + n);",
      'export const c = require();',
      'export const d = require(42);',
      'export default fixed;',
    ].join('\n'),
  );
  assert.deepEqual(collected, ['./fixed']);
});

test('a specifier Babel can evaluate is reported', async () => {
  const collected = await deps(
    [
      "const a = require('./a');",
      'const b = require(`./b`);',
      "const c = require('./' + 'c');",
      "export const d = () => import('./d');",
      'export { a, b, c };',
    ].join('\n'),
  );
  assert.deepEqual(collected, ['./a', './b', './c', './d']);
});

test('a shadowed require is not a dependency', async () => {
  assert.deepEqual(await deps("export function load(require: (id: string) => unknown) { return require('./x'); }"), []);
});

test('transformFile never reports a non-string dependency', async () => {
  const result = await transformFile({
    path: '/app/src/Lazy.jsx',
    code: 'export const load = (page) => import(`./pages/${page}`);\nexport const mod = require(window.name);',
  });
  assert.ok(!('error' in result), result.error?.message);
  assert.ok(result.deps.every((dep) => typeof dep === 'string'), JSON.stringify(result.deps));
});

test('each file gets its own dependency list', async () => {
  const [one, two] = await Promise.all([deps("import './one';"), deps("import './two';")]);
  assert.deepEqual(one, ['./one']);
  assert.deepEqual(two, ['./two']);
});

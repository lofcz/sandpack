// What the Babel chain must keep emitting whatever Babel's own defaults are:
// these are the places where Babel 8 changed a default the compiled modules
// depend on.
import { test } from '@rstest/core';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import {
  transformBabel,
  augmentDependencies,
  PLAIN_BABEL_CONFIG,
  REACT_REFRESH_BABEL_CONFIG,
} from '../dist/index.js';

const plain = async (code, filepath = '/app/src/x.ts') =>
  (await transformBabel({ code, filepath, config: PLAIN_BABEL_CONFIG })).code.replace(/\n\/\/# sourceMappingURL=.*$/, '');

test('modules compile to CommonJS', async () => {
  const code = await plain("import a from './a';\nexport const b = a;\nexport default b;");
  assert.match(code, /^"use strict";/);
  assert.match(code, /Object\.defineProperty\(exports, "__esModule"/);
  assert.match(code, /require\("\.\/a"\)/);
  assert.doesNotMatch(code, /^\s*(import|export)\s/m);
});

test('JSX compiles to the production automatic runtime whatever NODE_ENV is', async () => {
  const source = 'export const a = <p className="x">hi</p>;';
  const before = process.env.NODE_ENV;
  const outputs = [];
  try {
    for (const env of ['development', 'production', 'test', undefined]) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      // a config the chain has not seen, so nothing is answered from a cache
      const config = { presets: [['react', { runtime: 'automatic' }]], plugins: [], env };
      outputs.push((await transformBabel({ code: source, filepath: '/app/src/x.jsx', config })).code);
    }
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
  assert.equal(new Set(outputs).size, 1, 'the output depends on NODE_ENV');
  assert.match(outputs[0], /require\("react\/jsx-runtime"\)/);
  assert.match(outputs[0], /_jsxRuntime\.jsx\)\("p"/);
  assert.doesNotMatch(outputs[0], /jsx-dev-runtime|__source|__self|fileName/);
});

test('an import used only as a type is dropped', async () => {
  const code = await plain(
    "import { Props, helper } from './types';\nimport Shape from './shape';\nexport const f = (p: Props, s: Shape) => helper(p);",
  );
  assert.match(code, /require\("\.\/types"\)/);
  assert.doesNotMatch(code, /shape/, 'a type-only import must not become a require()');
  assert.doesNotMatch(code, /Props/);
});

test('TypeScript fields without an initializer define nothing', async () => {
  const code = await plain(
    [
      'class Base { value = 1; }',
      'export class Model extends Base {',
      '  value: number;',
      '  label?: string;',
      '  ready!: boolean;',
      '  static count: number;',
      '  #hidden: number;',
      '  kept = 2;',
      '  declare declared: string;',
      '}',
    ].join('\n'),
  );
  assert.doesNotMatch(code, /^\s*(value|label|ready|static count|declared);$/m, code);
  assert.match(code, /#hidden;/);
  assert.match(code, /kept = 2;/);

  const module = { exports: {} };
  new Function('exports', 'module', code)(module.exports, module);
  const model = new module.exports.Model();
  assert.equal(model.value, 1, 'a redeclared field must not reset what the parent class assigned');
  assert.deepEqual(Object.keys(model), ['value', 'kept']);
  assert.equal(Object.hasOwn(module.exports.Model, 'count'), false);
});

test('a JavaScript field without an initializer is a real field', async () => {
  const code = await plain('export class A { x; static y; }', '/app/src/x.js');
  assert.match(code, /^\s*x;$/m);
  assert.match(code, /static y;/);
});

test('text Babel writes itself keeps its characters', async () => {
  const code = await plain('export const a = <p title="žluťoučký">Příliš – „ok“ 😀</p>;', '/app/src/x.tsx');
  assert.match(code, /title: "žluťoučký"/);
  assert.match(code, /children: "Příliš – „ok“ 😀"/);
});

test('a chain that names the retired resource-management plugin still compiles `using`', async () => {
  const source = 'export function read(open) {\n  using handle = open();\n  return handle.read();\n}';
  const legacy = {
    presets: [['react', { runtime: 'automatic' }]],
    plugins: [['react-refresh/babel', { skipEnvCheck: true }], '@babel/plugin-proposal-explicit-resource-management'],
  };
  const fromLegacy = await transformBabel({ code: source, filepath: '/app/src/r.js', config: legacy });
  const fromCurrent = await transformBabel({ code: source, filepath: '/app/src/r.js', config: REACT_REFRESH_BABEL_CONFIG });
  assert.equal(fromLegacy.code, fromCurrent.code);
  assert.deepEqual([...fromLegacy.dependencies], [...fromCurrent.dependencies]);
  assert.match(fromCurrent.code, /_usingCtx/);
  assert.doesNotMatch(fromCurrent.code, /\busing handle\b/);
});

test('every polyfill the chain imports exists in the core-js release materials install', async () => {
  const require = createRequire(import.meta.url);
  const corejsRoot = dirname(require.resolve('core-js/package.json'));
  const installed = JSON.parse(readFileSync(join(corejsRoot, 'package.json'), 'utf8')).version;
  assert.equal(installed, augmentDependencies({})['core-js'], 'the test must check the release materials get');

  // Built-ins from every ECMAScript edition since the baseline, as calls a material would make.
  const source = [
    'using handle = open(); await using other = open();',
    "const s = Symbol.dispose, t = Symbol.asyncDispose, e = new SuppressedError(1, 2), d = new DisposableStack();",
    'const a = [1].at(-1), b = Object.groupBy([], (x) => x), c = new Set([1]).union(new Set());',
    "const f = [3, 1].toSorted(), g = [1].toReversed(), h = [1].with(0, 2), i = [1].findLast(Boolean), j = [[1]].flat();",
    "const k = Promise.withResolvers(), l = Promise.try(() => 1), m = Array.fromAsync([]), n = structuredClone({});",
    "const o = Iterator.from([]).map((x) => x).filter(Boolean).take(1).drop(1).toArray(), p = [1].includes(1), q = 'x'.replaceAll('a', 'b');",
    "const r = new Map().getOrInsert(1, 2), u = Math.sumPrecise([1]), v = RegExp.escape('a'), w = Error.isError(1), x = JSON.rawJSON('1');",
    "const y = Uint8Array.fromBase64(''), z = new Uint8Array(1).toHex(), aa = 'x'.isWellFormed(), ab = Object.hasOwn({}, 'a'), ac = [1, 2].join('-');",
    'queueMicrotask(() => {}); setTimeout(() => {}, 1); new URL("a:b"); new URLSearchParams(""); globalThis.x; atob("");',
    'export {};',
  ].join('\n');
  const { dependencies } = await transformBabel({ code: source, filepath: '/app/src/x.js', config: REACT_REFRESH_BABEL_CONFIG });
  const polyfills = [...dependencies].filter((dep) => dep.startsWith('core-js/'));
  assert.ok(polyfills.length > 0, 'the probe must make the chain inject at least one polyfill');
  for (const specifier of polyfills) {
    assert.match(specifier, /^core-js\/modules\/[\w.-]+\.js$/);
    assert.ok(existsSync(join(corejsRoot, specifier.slice('core-js/'.length))), `${specifier} is not in core-js ${installed}`);
  }
});

test('a chain is resolved once per config and never shared between configs', async () => {
  const source = 'export const a = <p>x</p>;';
  const classic = { presets: [['react', { runtime: 'classic' }]] };
  const first = await transformBabel({ code: source, filepath: '/app/src/x.jsx', config: PLAIN_BABEL_CONFIG });
  const other = await transformBabel({ code: source, filepath: '/app/src/x.jsx', config: classic });
  const again = await transformBabel({ code: source, filepath: '/app/src/x.jsx', config: structuredClone(PLAIN_BABEL_CONFIG) });
  assert.equal(again.code, first.code);
  assert.match(first.code, /jsx-runtime/);
  assert.match(other.code, /React\.createElement/);
});

test('a config that carries a plugin function is used as given', async () => {
  let visits = 0;
  const counting = () => ({ visitor: { Program() { visits++; } } });
  const config = { presets: [['react', { runtime: 'automatic' }]], plugins: [counting] };
  await transformBabel({ code: 'export const a = 1;', filepath: '/app/src/x.js', config });
  await transformBabel({ code: 'export const a = 2;', filepath: '/app/src/x.js', config });
  assert.equal(visits, 2);
});

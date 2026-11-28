// The react-refresh wrapper around Babel's output: the module keeps the strict
// mode Babel compiled it for, and positions in the wrapped code still resolve
// to the right source line.
import { test } from '@rstest/core';
import assert from 'node:assert/strict';
import { SourceMap } from 'node:module';

import { transformFile, getWrapperCode, HELPER_PATH } from '../dist/index.js';

// Run a wrapped module the way the sandbox does: as the body of a function that
// receives the CommonJS parameters, with nothing before the code on its first line.
function evaluate(code) {
  const module = { exports: {}, id: '/app/src/x.jsx', hot: { data: null } };
  const window = {};
  const helper = { prelude() {}, postlude() {} };
  const require = (specifier) => (specifier === HELPER_PATH ? helper : {});
  const run = new Function('exports', 'require', 'module', 'window', '$RefreshReg$', '$RefreshSig$', code + '\n');
  run.call(module.exports, module.exports, require, module, window, () => {}, () => (type) => type);
  return module.exports;
}

function inlineMap(code) {
  const base64 = code.slice(code.lastIndexOf('base64,') + 'base64,'.length).trim();
  return new SourceMap(JSON.parse(Buffer.from(base64, 'base64').toString('utf8')));
}

test('a wrapped ES module runs in strict mode', async () => {
  const result = await transformFile({
    path: '/app/src/x.jsx',
    code: [
      'export const thisOfPlainCall = (function () { return this; })();',
      'export function leak() { undeclared = 1; }',
    ].join('\n'),
  });
  assert.ok(!('error' in result), result.error?.message);
  assert.ok(result.code.startsWith('"use strict";'), result.code.slice(0, 80));

  const exports = evaluate(result.code);
  assert.equal(exports.thisOfPlainCall, undefined, 'a plain call has no `this` in strict mode');
  assert.throws(() => exports.leak(), ReferenceError, 'assigning an undeclared name must throw');
});

test('the prelude still runs before the module body', async () => {
  const result = await transformFile({ path: '/app/src/x.jsx', code: 'export const answer = 42;' });
  const [first, second] = result.code.split('\n');
  assert.match(first, /^"use strict";var _csbRefreshUtils = require\(".*refresh-helper\.js"\);.*_csbRefreshUtils\.prelude\(module\);$/);
  assert.equal(second, '"use strict";', 'Babel\'s own output starts on the second line, unchanged');
  assert.equal(evaluate(result.code).answer, 42);
});

test('code that is not strict is not made strict', () => {
  const wrapped = getWrapperCode('exports.thisOfPlainCall = (function () { return this; })();');
  assert.ok(wrapped.startsWith('var _csbRefreshUtils'), wrapped.slice(0, 40));
  assert.notEqual(evaluate(wrapped).thisOfPlainCall, undefined);
  // a string statement that only looks like the directive
  assert.ok(getWrapperCode('"use strict".length;').startsWith('var _csbRefreshUtils'));
  assert.ok(getWrapperCode('foo();"use strict";').startsWith('var _csbRefreshUtils'));
});

test('the directive is found behind comments and other directives', () => {
  for (const code of [
    "'use strict';exports.a = 1;",
    '/* licence */\n// note\n"use strict";\nexports.a = 1;',
    '"use client";\n"use strict";\nexports.a = 1;',
  ]) {
    assert.ok(getWrapperCode(code).startsWith('"use strict";var _csbRefreshUtils'), code);
  }
});

test('a position in the wrapped module maps to its source line', async () => {
  const source = [
    "import { useState } from 'react';",
    '',
    'export default function App() {',
    '  const [n] = useState(0);',
    "  if (n > 1) throw new Error('boom');",
    '  return <p>{n}</p>;',
    '}',
  ].join('\n');
  const result = await transformFile({ path: '/app/src/App.jsx', code: source });
  assert.ok(!('error' in result), result.error?.message);

  const lines = result.code.split('\n');
  const map = inlineMap(result.code);
  for (const [needle, sourceLine] of [
    ['throw new Error', 5],
    ['function App()', 3],
    ['(0, _react.useState)(0)', 4],
  ]) {
    const line = lines.findIndex((text) => text.includes(needle));
    assert.ok(line > 0, `${needle} not found in the output`);
    const entry = map.findEntry(line, lines[line].indexOf(needle));
    assert.equal(entry.originalLine + 1, sourceLine, `${needle} maps to line ${entry.originalLine + 1}`);
  }
});

// R3-328 — the `import.meta` shim. The sandbox evaluates compiled modules as classic
// scripts, where `import.meta` is a parse-time SyntaxError that kills the whole module
// (caught live on the reckoner demo, 2026-08-24). The transform rewrites the syntax to the
// runtime-provided identifier; these tests pin the emitted shape and prove the output is
// EVALUABLE as a classic script with the runtime's frozen `{ url }`.
import test from 'node:test';
import assert from 'node:assert/strict';

import { transformBabel, IMPORT_META_GLOBAL, PLAIN_BABEL_CONFIG } from '../dist/index.js';

const transform = (code, filepath = '/app/src/example.ts') =>
  transformBabel({ code, filepath, config: PLAIN_BABEL_CONFIG });

test('import.meta.url rewrites to the runtime identifier', async () => {
  const { code } = await transform(`export const u = import.meta.url;`);
  assert.ok(code.includes(`${IMPORT_META_GLOBAL}.url`), `emitted: ${code}`);
  assert.ok(!/import\.meta/.test(code), 'no import.meta may survive the transform');
});

test('the sanctioned worker-URL idiom survives intact (URL construction preserved)', async () => {
  const { code } = await transform(
    `new Worker(new URL('./engine.ts', import.meta.url), { type: 'module' });`
  );
  assert.ok(code.includes(`new URL('./engine.ts', ${IMPORT_META_GLOBAL}.url)`), `emitted: ${code}`);
});

test('bundler-specific reads become honest undefined member access', async () => {
  const { code } = await transform(`export const dev = import.meta.env?.DEV;`);
  assert.ok(code.includes(`${IMPORT_META_GLOBAL}.env`), `emitted: ${code}`);
  assert.ok(!/import\.meta/.test(code));
});

test('bare import.meta rewrites; new.target is NOT a MetaProperty we touch', async () => {
  const { code } = await transform(
    `export const m = import.meta;\nexport function f() { return new.target; }`
  );
  assert.ok(code.includes(IMPORT_META_GLOBAL));
  assert.ok(code.includes('new.target'), 'new.target must pass through untouched');
});

test('the emitted code EVALUATES as a classic script with the runtime global (the actual bug)', async () => {
  const { code } = await transform(`module.exports = { url: import.meta.url };`);
  // The runtime contract: a frozen { url } provided under exactly this identifier.
  const meta = Object.freeze({ url: 'https://sandbox.immediately.run/app/src/example.ts' });
  const moduleObj = { exports: {} };
  const fn = new Function(IMPORT_META_GLOBAL, 'module', 'exports', code);
  fn(meta, moduleObj, moduleObj.exports);
  assert.equal(moduleObj.exports.url, meta.url);
});

test('the identifier is the cross-repo contract — changing it breaks the sandbox evaluator', () => {
  // The sandbox's module evaluator injects this exact name (frozen { url }); a silent
  // rename would make every shimmed reference throw ReferenceError at runtime. Pinned
  // deliberately, greppably.
  assert.equal(IMPORT_META_GLOBAL, '$ir_import_meta');
});

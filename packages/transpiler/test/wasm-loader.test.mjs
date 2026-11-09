// R3-426 — the two wasm loader idioms, pinned at the transform layer (the sandbox
// composes them with its asset transform + module-space fetch; see that repo's
// bundler tests). No emitted-bytes change here — R3-328's import.meta shim already
// covers the syntax — these tests pin that the chain KEEPS supporting:
//
//   row 1: `import wasmUrl from './add.wasm'`   — collected as a dependency, so the
//          sandbox routes it to its asset transform (data URL export);
//   row 2: `new URL('./add.wasm', import.meta.url)` — the Emscripten/wasm-pack idiom —
//          rewrites to the runtime identifier and EVALUATES as a classic script,
//          resolving the sibling against the module's own URL.
import test from 'node:test';
import assert from 'node:assert/strict';

import { transformBabel, transformFile, IMPORT_META_GLOBAL, PLAIN_BABEL_CONFIG } from '../dist/index.js';

// Build the expected identifier from the exported constant, not a literal, so the
// cross-repo name stays pinned in exactly one place.
const META_URL = `${IMPORT_META_GLOBAL}.url`;
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('row 1: a .wasm import is collected as a dependency and required at runtime', async () => {
  const { code, dependencies } = await transformBabel({
    code: `import wasmUrl from './add.wasm';\nexport default wasmUrl;`,
    filepath: '/app/src/main.ts',
    config: PLAIN_BABEL_CONFIG,
  });
  assert.ok(dependencies.has('./add.wasm'), `collected: ${[...dependencies]}`);

  // Evaluate the emitted classic script: the sandbox's asset transform answers the
  // require with a data-URL string module (`module.exports = "data:..."`).
  const dataUrl = 'data:application/wasm;base64,AGFzbQEAAAA=';
  const moduleObj = { exports: {} };
  const requireStub = (specifier) => (specifier === './add.wasm' ? dataUrl : {});
  const fn = new Function('require', 'module', 'exports', code);
  fn(requireStub, moduleObj, moduleObj.exports);
  assert.equal(moduleObj.exports.default, dataUrl);
});

// Goes through `transformFile()` so the CHAIN IS SELECTED BY THE REAL PRODUCER
// rather than hand-picked. `/app/src/loader.ts` is app-root but not matched by
// APP_ROOT_REFRESH_RE (which covers js/jsx/mjs/cjs/tsx, not bare .ts), so it
// legitimately lands on the plain chain and the emitted classic script can be
// evaluated. The react-refresh chain a `.js` loader really takes is pinned by the
// test below it — an earlier version of this file asserted the idiom against
// PLAIN_BABEL_CONFIG on a `.js` path, i.e. a chain no such file ever takes.
test('row 2: new URL(sibling, import.meta.url) evaluates and resolves beside the module', async () => {
  const { code, error } = await transformFile({
    path: '/app/src/loader.ts',
    code: `export const wasmUrl = new URL('./add.wasm', import.meta.url);`,
  });
  assert.equal(error, undefined, `transformFile: ${error?.message}`);
  assert.ok(!/import\.meta/.test(code), 'no import.meta may survive the transform');

  const meta = Object.freeze({ url: 'https://sandbox.immediately.run/app/src/loader.ts' });
  const moduleObj = { exports: {} };
  const fn = new Function(IMPORT_META_GLOBAL, 'require', 'module', 'exports', code);
  fn(meta, () => ({}), moduleObj, moduleObj.exports);
  assert.equal(moduleObj.exports.wasmUrl.href, 'https://sandbox.immediately.run/app/src/add.wasm');
});

// The chain a real wasm-pack / Emscripten loader actually takes: an app-root `.js`
// selects react-refresh. The refresh wrapper makes the module awkward to evaluate
// standalone, so this pins the rewrite itself — which is the part the sandbox's
// module-space fetch depends on.
test('row 2 on the react-refresh chain an app-root .js really selects', async () => {
  const { code, error } = await transformFile({
    path: '/app/src/loader.js',
    code: `export const wasmUrl = new URL('./add.wasm', import.meta.url);`,
  });
  assert.equal(error, undefined, `transformFile: ${error?.message}`);
  assert.ok(!/import\\.meta/.test(code), 'no import.meta may survive the refresh chain either');
  assert.match(code, new RegExp(esc(META_URL)));
});

test('row 2, wasm-pack shape: fetch(new URL(...)) stays a plain global fetch call', async () => {
  // The sandbox serves the resolved URL through its per-module fetch shadow — which
  // only works if the emitted code still calls the bare `fetch` identifier (a free
  // global reference the evaluator can provide), not some rewritten indirection.
  const { code } = await transformBabel({
    code: `export const p = fetch(new URL('./add.wasm', import.meta.url));`,
    filepath: '/app/src/loader.ts',
    config: PLAIN_BABEL_CONFIG,
  });
  assert.match(code, new RegExp(`fetch\\(new URL\\('\\./add\\.wasm', ${esc(META_URL)}\\)\\)`));
});

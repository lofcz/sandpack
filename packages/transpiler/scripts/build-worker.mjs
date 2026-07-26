#!/usr/bin/env node
/*
 * Build the prebuilt same-origin transform worker (`worker/babel-worker.js`) with
 * esbuild (R3-150). This replaces the previous Parcel target (`build:worker`).
 *
 * WHY esbuild, not Parcel:
 *   The worker now owns the MDX compile (`mdx-compile`) as well as the Babel chain
 *   (`transform`) — MDX_CONTENT_COLLECTIONS_SPEC §1.1. Bundling `@mdx-js/mdx` +
 *   `remark-gfm` + the unified tree means following their `exports` conditional map
 *   (`devlop`, `unist-*`, `decode-named-character-reference`). Parcel's resolver
 *   can't follow that tree (the documented wall — babel-worker-packaging), which is
 *   exactly why MDX historically compiled in-iframe. esbuild follows it fine, so it
 *   also lets us retire Parcel from this package entirely (one bundler: esbuild via
 *   tsup for the package + esbuild here for the worker).
 *
 * THE TWO WORKER-SPECIFIC GOTCHAS this config encodes:
 *   1. A Web Worker has NO DOM. `decode-named-character-reference` (a micromark dep)
 *      ships a `browser` build that calls `document.createElement` to decode HTML
 *      entities — which throws in a worker. Its `exports` also expose a `worker`
 *      condition pointing at the DOM-free `./index.js`, listed BEFORE `browser`, so
 *      putting `worker` in `conditions` makes esbuild pick the safe variant. (This
 *      is the difference the iframe hid: an iframe HAS a document; a worker doesn't.)
 *   2. esbuild has no automatic node-builtin polyfills (Parcel did). The few builtins
 *      the Babel chain reaches (`path`, `assert`, `buffer`, `stream`, ...) are aliased
 *      to the browserify shims this package already declares as devDependencies, plus
 *      a `process`/`Buffer` inject.
 *
 * OUTPUT SHAPE (the R3-149 contract, preserved): a CLASSIC web worker — `format:
 * 'iife'` writing into the worker global `self`, spawned by the parent as
 * `new Worker(url)` (not a module worker). esbuild's IIFE can't code-split, so the
 * bundle is a single self-contained file (no `importScripts` async chunks like
 * Parcel emitted). That is fine for a version-stamped transform worker whose whole
 * job is transforming; byte-IDENTITY is about transform OUTPUT (proven by the golden
 * suite + the worker harness), not the worker's own chunk layout.
 */
import { build } from 'esbuild';
import { rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'worker');
const ENTRY = join(ROOT, 'worker-src', 'babel-worker.ts');
const SHIM = join(ROOT, 'scripts', 'worker-node-shim.mjs');

// Node builtins the Babel chain touches -> the browserify shims this package
// already declares as devDependencies. Keep this list minimal and let esbuild's
// "built into node" error surface any new one instead of silently stubbing it.
const alias = {
  path: 'path-browserify',
  assert: 'assert',
  buffer: 'buffer',
  crypto: 'crypto-browserify',
  stream: 'stream-browserify',
  string_decoder: 'string_decoder',
  vm: 'vm-browserify',
  events: 'events',
  process: 'process',
};

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

await build({
  entryPoints: [ENTRY],
  outfile: join(OUT_DIR, 'babel-worker.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  alias,
  inject: [SHIM],
  // `worker` before esbuild's implicit `browser` picks DOM-free package variants
  // (gotcha #1 above). `import`/`default` keep ESM-only deps (mdx/unified) resolving.
  conditions: ['worker', 'import', 'default'],
  define: {
    'process.env.NODE_ENV': '"production"',
    global: 'globalThis',
  },
  logLevel: 'info',
});

console.log('Built worker/babel-worker.js (esbuild, classic worker)');

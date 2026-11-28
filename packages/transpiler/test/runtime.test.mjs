import assert from 'node:assert/strict';
import { test } from '@rstest/core';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rspack } from '@rspack/core';
import * as runtime from '../dist/runtime.js';
import * as compiler from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('runtime entry preserves the shared compiler contract in ESM and CJS', () => {
  const cjs = createRequire(import.meta.url)('../dist/runtime.cjs');
  for (const [name, value] of Object.entries(runtime)) {
    assert.equal(typeof value, typeof compiler[name], name);
    assert.equal(typeof value, typeof cjs[name], name);
    if (typeof value !== 'function') assert.deepEqual(value, compiler[name], name);
  }
  const dependencies = { react: '19.2.0', 'react-dom': '19.2.0' };
  assert.deepEqual(runtime.computeDeclaredDepMap(dependencies), compiler.computeDeclaredDepMap(dependencies));
  assert.deepEqual(runtime.selectReactChain('/app/main.tsx'), compiler.selectReactChain('/app/main.tsx'));
  assert.equal(runtime.getWrapperCode('exports.answer = 42'), compiler.getWrapperCode('exports.answer = 42'));
});

test('browser runtime entry never pulls the compiler into preview startup', async () => {
  // Bundle the entry the way a consumer's browser build does and look at what
  // the bundle is made of.
  const outDir = mkdtempSync(join(tmpdir(), 'transpiler-runtime-'));
  try {
    const stats = await new Promise((done, fail) => {
      rspack({
        context: root,
        mode: 'none',
        target: 'web',
        entry: './dist/runtime.js',
        output: { path: outDir, filename: 'runtime.bundle.js', module: true, library: { type: 'module' } },
      }).run((error, result) => (error ? fail(error) : done(result)));
    });
    assert.deepEqual(stats.toJson({ all: false, errors: true }).errors, []);
    const inputs = [...stats.compilation.modules].map((module) => module.identifier());
    assert(inputs.some((name) => name.includes('dist/runtime.js')), `unexpected module list: ${inputs}`);
    assert(!inputs.some((name) => /node_modules\/(?:@babel|@mdx-js|remark|unified)/.test(name)));
    assert(statSync(join(outDir, 'runtime.bundle.js')).size < 100_000, 'Runtime facts must stay lightweight');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

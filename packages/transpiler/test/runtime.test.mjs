import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import * as runtime from '../dist/runtime.js';
import * as compiler from '../dist/index.js';

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
  const result = await build({
    entryPoints: ['dist/runtime.js'], bundle: true, platform: 'browser',
    format: 'esm', write: false, metafile: true,
  });
  assert(!Object.keys(result.metafile.inputs).some(path => /node_modules\/(?:@babel|@mdx-js|remark|unified)/.test(path)));
  assert(result.outputFiles[0].contents.byteLength < 100_000, 'Runtime facts must stay lightweight');
});

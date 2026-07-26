import test from 'node:test';
import assert from 'node:assert/strict';

import { computeToolchainHash } from '../dist/index.js';

const enc = (s) => new TextEncoder().encode(s);

test('is a 64-char lower-case hex sha-256 digest', async () => {
  const hash = await computeToolchainHash({ 'a.js': enc('x') });
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('independent of input iteration order (sorted by path internally)', async () => {
  const a = await computeToolchainHash([
    ['dist/index.js', enc('one')],
    ['dist/index.cjs', enc('two')],
    ['package.json', enc('three')],
  ]);
  const b = await computeToolchainHash([
    ['package.json', enc('three')],
    ['dist/index.js', enc('one')],
    ['dist/index.cjs', enc('two')],
  ]);
  assert.equal(a, b);
});

test('Map, array-of-pairs and Record inputs agree', async () => {
  const record = { 'a.js': enc('aaa'), 'b.js': enc('bbb') };
  const map = new Map([['a.js', enc('aaa')], ['b.js', enc('bbb')]]);
  const pairs = [['b.js', enc('bbb')], ['a.js', enc('aaa')]];
  const h = await computeToolchainHash(record);
  assert.equal(await computeToolchainHash(map), h);
  assert.equal(await computeToolchainHash(pairs), h);
});

test('sensitive to file bytes', async () => {
  const base = await computeToolchainHash({ 'a.js': enc('x') });
  const changed = await computeToolchainHash({ 'a.js': enc('y') });
  assert.notEqual(base, changed);
});

test('sensitive to path (path is part of the contribution)', async () => {
  const a = await computeToolchainHash({ 'a.js': enc('x') });
  const b = await computeToolchainHash({ 'b.js': enc('x') });
  assert.notEqual(a, b);
});

test('frozen recipe vector — locks the canonical-bytes algorithm', async () => {
  // sha256( utf8("a.js") ‖ 0x00 ‖ sha256("x") ‖ utf8("b.js") ‖ 0x00 ‖ sha256("yy") )
  const hash = await computeToolchainHash([
    ['b.js', enc('yy')],
    ['a.js', enc('x')],
  ]);
  assert.equal(hash, 'fce55e554d8c9808ae065bf2a08b344970aa0475bb6efbd83d4c94cdc8d14c40');
});

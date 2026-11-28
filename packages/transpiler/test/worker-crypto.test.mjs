// The worker build gives react-refresh this module in place of Node's `crypto`.
// A hook signature is a hash of the hooks a component calls, so the two must
// agree on every input or the worker and the CLI emit different bytes.
import { test } from '@rstest/core';
import assert from 'node:assert/strict';
import { createHash as nodeCreateHash } from 'node:crypto';

import { createHash } from '../shims/crypto.mjs';

const reference = (text) => nodeCreateHash('sha1').update(text).digest('base64');

test('sha1/base64 of the shim equals Node crypto', () => {
  const inputs = [
    '',
    'a',
    'useState{[count, setCount](initial)}',
    'useState{[n, setN](0)}\nuseEffect{}\nuseCallback{cb}',
    'příliš žluťoučký kůň 😀 \u{1F600}',
    'x'.repeat(55),
    'x'.repeat(56),
    'x'.repeat(64),
    'x'.repeat(1000),
  ];
  for (const input of inputs) {
    assert.equal(createHash('sha1').update(input).digest('base64'), reference(input), JSON.stringify(input.slice(0, 40)));
  }
});

test('update() can be called in pieces', () => {
  assert.equal(createHash('sha1').update('use').update('State').digest('base64'), reference('useState'));
});

test('anything but sha1/base64 is refused, not answered wrongly', () => {
  assert.throws(() => createHash('sha256'), /Unsupported hash algorithm/);
  assert.throws(() => createHash('sha1').update('a').digest('hex'), /Unsupported digest encoding/);
});

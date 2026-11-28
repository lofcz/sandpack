import { createHash as nodeCreateHash } from 'node:crypto';

import { createHash } from './crypto.mjs';

// react-refresh/babel replaces a long component signature by this hash, and a
// pre-transpiled artifact was hashed by Node: both must name the same signature.
it.each([
  '',
  'useState{[count, setCount](0)}',
  'useEffect{}\nuseCustom{value}',
  'příliš žluťoučký 🐎',
  'x'.repeat(10_000),
])('hashes a signature as Node does: %#', (signature) => {
  expect(createHash('sha1').update(signature).digest('base64')).toBe(
    nodeCreateHash('sha1').update(signature).digest('base64')
  );
});

it('refuses what the shim does not implement', () => {
  expect(() => createHash('sha256')).toThrow('sha256');
  expect(() => createHash('sha1').update('x').digest('hex')).toThrow('hex');
});

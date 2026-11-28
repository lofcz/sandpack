// `crypto` as react-refresh/babel uses it: one SHA-1 of a component signature,
// read as base64. A whole browser port of Node's crypto would be bundled for it
// otherwise.
import { sha1 } from '@noble/hashes/legacy.js';

export function createHash(algorithm) {
  if (algorithm !== 'sha1') throw new Error(`createHash("${algorithm}") is not available in the bundler`);
  const hash = sha1.create();
  return {
    update(text) {
      hash.update(new TextEncoder().encode(text));
      return this;
    },
    digest(encoding) {
      if (encoding !== 'base64') throw new Error(`digest("${encoding}") is not available in the bundler`);
      let binary = '';
      for (const byte of hash.digest()) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
  };
}

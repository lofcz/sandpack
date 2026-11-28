// React Refresh signs a component's hooks with Node's
// `crypto.createHash('sha1').update(text).digest('base64')`. A worker has no
// `crypto` module, and that one call is all the compiler needs of it, so the
// worker build resolves react-refresh's `crypto` to this module instead of a
// polyfill of Node's whole crypto library.
import { sha1 } from '@noble/hashes/legacy.js';

export function createHash(algorithm) {
  if (algorithm !== 'sha1') throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  let text = '';
  return {
    update(chunk) {
      text += chunk;
      return this;
    },
    digest(encoding) {
      if (encoding !== 'base64') throw new Error(`Unsupported digest encoding: ${encoding}`);
      return btoa(String.fromCharCode(...sha1(new TextEncoder().encode(text))));
    },
  };
}

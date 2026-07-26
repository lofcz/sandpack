// esbuild `inject` shim: supply the `process` and `Buffer` globals the bundled
// Babel/MDX chain expects, since a worker has neither and esbuild adds no node
// polyfills automatically. `process` resolves to the aliased `process` shim and
// `Buffer` to `buffer` (both declared devDependencies). esbuild rewrites free
// references to these globals in the bundle to import from here.
import process from 'process';
import { Buffer } from 'buffer';

export { process, Buffer };

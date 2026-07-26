// The same-origin Babel worker entry, now living in the package that owns the
// transform logic (R3-149 / SIMPLIFIED_DEPLOYMENT_SPEC §14). This is the exact
// body of what used to be sandbox's `babel-worker.ts`, moved here so the worker's
// bundled transpiler is *this* package's own `transformBabel` — the worker IS the
// transpiler version, so it can never drift from the sandbox iframe's transpiler
// (the gen-toolchain-hash / G2-8 parity anchor, PRETRANSPILED_ARTIFACTS_SPEC §4.4).
//
// It imports the transform surface from the *built* package's worker entry
// (`../dist/babel/worker-api.js`) rather than the package root, so the bytes the
// bundler emits are the tsup-built `transformBabel`/`compileMdx` (byte-identical
// behaviour to the CLI's pre-transpiled artifacts and the sandbox iframe runtime).
// The worker now owns BOTH the Babel chain (`transform`) and the MDX->JSX compile
// (`mdx-compile`) — R3-150 moved the MDX compile out of the iframe now that the
// worker is esbuild-built (Parcel couldn't follow the unified/mdx tree). The
// react-refresh wrap still happens in-iframe.
//
// The transport (WorkerMessageBus + the {type:'connect'} MessagePort handshake)
// comes from the leaf `@immediately-run/worker-transport` package, so this worker
// entry does not depend on `sandbox`.
//
// This worker is spawned **classic** by the parent page (`new Worker(url)` — NOT a
// module worker); the esbuild build (`scripts/build-worker.mjs`, `format: 'iife'`
// into the worker global) preserves that shape as a single self-contained file (no
// `importScripts` chunks). The parent transfers a `MessagePort` entangled with one
// handed into the sandboxed iframe so the iframe can drop `allow-same-origin` and
// transform requests flow directly.
import { bindWorkerMessageBus } from '@immediately-run/worker-transport';
// eslint-disable-next-line import/extensions
import { transformBabel, compileMdx, type ITransformData } from '../dist/babel/worker-api.js';

bindWorkerMessageBus(self, {
  channel: 'sandpack-babel',
  handleRequest: (method, data) => {
    switch (method) {
      case 'transform':
        return transformBabel(data as ITransformData);
      case 'mdx-compile': {
        // Returns the compiled JSX program string; throws `MdxCompileError` on a
        // malformed source. The transport serializes the error's own `line`/`column`
        // (spread into the wire error) so the iframe's `MDXTransformer` can rebuild a
        // positioned `BundlerError`.
        const { code, path } = data as { code: string; path: string };
        return compileMdx(code, path);
      }
      default:
        return Promise.reject(new Error('Unknown method'));
    }
  },
});

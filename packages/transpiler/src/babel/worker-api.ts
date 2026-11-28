// The surface the same-origin transform worker bundles (R3-149 + R3-150). The
// worker answers two methods over the MessagePort transport:
//   - `transform`     -> `transformBabel` (the Babel chain)
//   - `mdx-compile`   -> `compileMdx`     (the MDX -> JSX program stage)
// so the worker runs BOTH halves of the `.mdx` chain the sandbox iframe used to
// run in-process (MDX_CONTENT_COLLECTIONS_SPEC §1.1). The react-refresh wrap
// stays in-iframe (as for `.tsx`), so it is deliberately NOT exported here.
//
// The worker bundle (the `worker` lib of `rslib.config.ts`) is built from this
// entry, so the in-iframe `MDXTransformer` is a thin RPC and the worker runs the
// same `compileMdx`/`transformBabel` as the CLI (same package version,
// byte-identical behaviour to the CLI artifacts + the iframe runtime).
export { transformBabel } from './transform';
export type { ITransformData, BabelTransformResult } from './transform';
export { compileMdx, MdxCompileError } from '../mdx/compile';

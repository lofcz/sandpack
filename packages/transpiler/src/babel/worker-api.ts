// The surface the same-origin transform worker bundles (R3-149 + R3-150). The
// worker answers two methods over the MessagePort transport:
//   - `transform`     -> `transformBabel` (the Babel chain)
//   - `mdx-compile`   -> `compileMdx`     (the MDX -> JSX program stage)
// so the worker runs BOTH halves of the `.mdx` chain the sandbox iframe used to
// run in-process (MDX_CONTENT_COLLECTIONS_SPEC §1.1). The react-refresh wrap
// stays in-iframe (as for `.tsx`), so it is deliberately NOT exported here.
//
// Historically this entry was Babel-ONLY: the worker was Parcel-built, and
// Parcel's resolver can't follow the `@mdx-js/mdx` / unified conditional-exports
// tree (`devlop`/`unist`/`decode-named-character-reference`), so MDX compiled
// in-iframe. R3-150 swaps the worker build to esbuild (`scripts/build-worker.mjs`),
// which follows that tree fine — so the worker can now own the MDX compile too and
// the in-iframe `MDXTransformer` becomes a thin RPC. It is still the tsup-built
// `compileMdx`/`transformBabel` (same package version, byte-identical behaviour to
// the CLI artifacts + the iframe runtime).
export { transformBabel } from './transform';
export type { ITransformData, BabelTransformResult } from './transform';
export { compileMdx, MdxCompileError } from '../mdx/compile';

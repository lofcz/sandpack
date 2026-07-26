// @immediately-run/transpiler — the single source of truth for immediately.run's
// per-file transform chain (MDX + Babel + react-refresh), shared byte-for-byte
// between the browser sandbox bundler and the CLI's pre-transpiled-artifact
// emitter. See PRETRANSPILED_ARTIFACTS_SPEC §4.4 + MDX_CONTENT_COLLECTIONS_SPEC §1.

export { TRANSPILER_VERSION, PRESET_NAME } from './version';

// The public chain entry point.
export { transformFile } from './transformFile';
export type {
  TransformInput,
  TransformSuccess,
  TransformError,
  TransformResult,
} from './transformFile';

// Chain internals, exported so the sandbox can route its existing transformer
// classes through this package without re-implementing the chain.
export { transformBabel } from './babel/transform';
export type { ITransformData, BabelTransformResult } from './babel/transform';
export {
  selectReactChain,
  isTransformable,
  augmentDependencies,
  REACT_REFRESH_BABEL_CONFIG,
  PLAIN_BABEL_CONFIG,
} from './presets/react';
export type { ReactChain } from './presets/react';
export {
  getWrapperCode,
  HELPER_PATH,
  HELPER_CODE,
  REACT_REFRESH_RUNTIME,
} from './react-refresh/wrap';

// MDX: the compile stage + the shared frontmatter parser. The sandbox routes its
// `MDXTransformer` + `frontmatter.ts` through these (MDX_CONTENT_COLLECTIONS_SPEC
// §1.1), and the CLI's cache-zip metadata sidecar (G-MDX-3) will reuse
// `parseFrontmatter` so its values are byte-identical to the live scan.
export { compileMdx, MdxCompileError } from './mdx/compile';
export { parseFrontmatter } from './mdx/frontmatter';
export type { FrontmatterParseResult } from './mdx/frontmatter';

// Heading slug / section-id computation (MARKDOWN_SYNTAX_SPEC §15.1, R3-186/R3-211).
// Exported so a consumer that must reproduce the kernel's heading ids WITHOUT
// re-compiling — Grove's in-page `<Toc>` (`grove/src/lib/wiki.ts`), or any TOC —
// derives byte-identical ids from the one shared implementation.
// Re-exported from the shared plugin package (R3-213) — the transpiler's public API
// is unchanged (additive/stable); the source of truth just moved out of `src/mdx/`.
export { textSlug, sectionId } from '@immediately-run/mdx-plugins';
export type { HeadingAnchorOptions } from '@immediately-run/mdx-plugins';

// Dependency-map facts the CLI needs to compute the lockset input, plus the
// resolution-completeness guard shared with the sandbox runtime + CLI builder.
export { computeInputDepMap, assertDependenciesResolved } from './depmap';
export type { DepMap, ResolvedDependency } from './depmap';
export { filterBuildDeps, isBuildDep } from './presets/build-dep';

// Toolchain stamping.
export { computeToolchainHash } from './toolchainHash';
export type { TarballFiles } from './toolchainHash';

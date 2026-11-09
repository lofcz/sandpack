// Compiler-independent facts used by the preview iframe. Keep this entry free
// of Babel/MDX: normal transforms run in the parent-owned worker, and importing
// the full compiler here duplicates its download and initialization at boot.
export { TRANSPILER_VERSION, PRESET_NAME } from './version';
export { IMPORT_META_GLOBAL } from './babel/import-meta-shim';
export {
  selectReactChain,
  isTransformable,
  augmentDependencies,
  REACT_REFRESH_BABEL_CONFIG,
  PLAIN_BABEL_CONFIG,
} from './presets/react';
export {
  getWrapperCode,
  HELPER_PATH,
  HELPER_CODE,
  REACT_REFRESH_RUNTIME,
} from './react-refresh/wrap';
export {
  computeDeclaredDepMap,
  computeRequestDepMap,
  packageName,
  packageEntry,
  importedPackages,
  assertDependenciesResolved,
  rootRuntimeDependencies,
  concreteVersion,
  isPrereleaseVersion,
  findUnrequestedPrereleases,
} from './depmap';
export type { RootPackageShape, UnrequestedPrerelease } from './depmap';
export type { DepMap, ResolvedDependency } from './depmap';
export type { ReactChain } from './presets/react';

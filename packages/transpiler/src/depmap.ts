import { augmentDependencies } from './presets/react';
import { isBuildDep } from './presets/build-dep';
export function computeDeclaredDepMap(
  pkgDependencies: DepMap,
  registryResolved: readonly string[] = [],
): DepMap {
  const skip = new Set([...SELF_HOSTED_MODULES, ...registryResolved]);
  const selfHosted: DepMap = {};
  for (const [name, range] of Object.entries(pkgDependencies)) {
    if (!skip.has(name)) selfHosted[name] = range;
  }
  const augmented = augmentDependencies(selfHosted);
  const declared: DepMap = {};
  for (const [name, range] of Object.entries(augmented)) {
    if (!skip.has(name)) declared[name] = range;
  }
  return sortDepMap(declared);
}

// Deps the preset's own runtime code requires (the react-refresh helper, the
// self-hosted SDK, Babel's core-js injection) — invisible to an import scan of
// app sources, so always requested rather than discovered one round trip late.
const IMPLICIT_DEPENDENCIES = Object.keys(augmentDependencies({}));

/**
 * The packages to resolve from the CDN: the declared packages the app imports,
 * plus the preset's implicit deps. A declared package nothing imports (bundlers,
 * Babel plugins, linters, `@types/*`) is never fetched; an imported package that
 * isn't declared has no version source and is left to fail at resolution.
 * `imported` holds package names (`importedPackages`); `implicit` defaults to
 * the react preset's (the sandbox passes its active preset's).
 */
export function computeRequestDepMap(
  declared: DepMap,
  imported: Iterable<string>,
  implicit: readonly string[] = IMPLICIT_DEPENDENCIES,
): DepMap {
  const request: DepMap = {};
  for (const name of [...implicit, ...imported]) {
    if (Object.prototype.hasOwnProperty.call(declared, name)) request[name] = declared[name];
  }
  return sortDepMap(request);
}

// npm's package-name grammar (validate-npm-package-name), case-insensitive so
// legacy mixed-case names still count.
const PACKAGE_NAME_RE = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

/**
 * The package a module specifier loads from `node_modules`: `lodash/fp` →
 * `lodash`, `@scope/pkg/sub` → `@scope/pkg`. Null for anything that can't be a
 * package import — relative and absolute paths, `#subpath` imports, schemes
 * (`node:`, `https:`, `data:`), the dep collector's non-literal `undefined`.
 * Local aliases that look bare (`@/x`, tsconfig `paths`) may still yield a name;
 * that is harmless because only declared names are ever requested.
 */
export function packageName(specifier: unknown): string | null {
  if (typeof specifier !== 'string' || specifier === '') return null;
  if (/^[./#]/.test(specifier) || specifier.includes(':')) return null;
  const segments = specifier.split('/');
  const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
  return PACKAGE_NAME_RE.test(name) ? name : null;
}

/**
 * The package entry a module specifier imports: `react` → `.`,
 * `react-dom/client` → `./client`, `@scope/pkg/a/b` → `./a/b`. Null when the
 * specifier is not a package import (`packageName`).
 */
export function packageEntry(specifier: unknown): string | null {
  const name = packageName(specifier);
  if (name === null) return null;
  const subpath = (specifier as string).slice(name.length).replace(/^\/+|\/+$/g, '');
  return subpath ? `./${subpath}` : '.';
}

/** The set of package names a list of module specifiers imports. */
export function importedPackages(specifiers: Iterable<unknown>): Set<string> {
  const names = new Set<string>();
  for (const specifier of specifiers) {
    const name = packageName(specifier);
    if (name) names.add(name);
  }
  return names;
}

// dependency name => version range, same shape the runtime uses.
export type DepMap = Record<string, string>;

// One entry of the CDN's resolved flat dependency list (the `/dep_tree/` wire
// format): name / exact version / depth. The completeness check below only reads
// the name; the full shape is exported for callers that hold the resolved list.
export interface ResolvedDependency {
  /** package name */
  n: string;
  /** exact resolved version */
  v: string;
  /** depth in the resolved tree (0 = top-level) */
  d: number;
}

/**
 * Assert every requested top-level dependency appears in the CDN-resolved set.
 *
 * The sandpack CDN SILENTLY OMITS a package it can't resolve (most often a
 * version newer than its npm mirror has ingested) rather than erroring. Left
 * unchecked, the package never enters the module graph and the first `import` of
 * it evaluates to `undefined` — surfacing far from the cause as a cryptic
 * "Element type is invalid: ... got: undefined" (or a bare ENOENT). Detect the
 * drop by diffing the requested names against the resolved set (presence
 * ANYWHERE — never depends on the CDN's depth bookkeeping: a resolvable
 * top-level dep is always present, a dropped one is absent entirely) and throw
 * naming the unresolved package(s).
 *
 * Shared by the sandbox runtime (live + sidecar-lockset resolution) and the CLI
 * cache-zip builder (the in-zip pre-resolved manifest), so a drop reads
 * identically whether caught at boot or at zip-build time
 * (PRETRANSPILED_ARTIFACTS_SPEC §4.4: the shared package is the single source of
 * truth). The `resolved` param takes the structural minimum (`{ n }`) so both the
 * sandbox `IResolvedDependency` and the CLI `ResolvedDependency` satisfy it.
 */
export function assertDependenciesResolved(
  requested: DepMap,
  resolved: readonly Pick<ResolvedDependency, 'n'>[],
): void {
  const names = new Set(resolved.map((dep) => dep.n));
  const missing = Object.keys(requested).filter((name) => !names.has(name));
  if (missing.length === 0) return;
  const list = missing.map((name) => `"${name}@${requested[name]}"`).join(', ');
  throw new Error(
    `Could not resolve ${missing.length === 1 ? 'package' : 'packages'} from the package CDN: ${list}. ` +
      `The requested version may not exist on the CDN's npm mirror yet — try a lower version range in package.json.`,
  );
}

// Modules the runtime ALWAYS resolves from a self-hosted versioned origin, not
// the sandpack CDN (sandbox `SELF_HOST_BASES`). Resolution is implicit, so these
// are stripped from the input DepMap unconditionally — keep in sync with the
// sandbox. (`@immediately-run/sdk` is fetched from gh-pages `/v/<version>/`.)
const SELF_HOSTED_MODULES = ['@immediately-run/sdk'];

const sortDepMap = (deps: DepMap): DepMap =>
  Object.fromEntries(Object.entries(deps).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * Replicate the runtime's input DepMap derivation for the react preset
 * (`Bundler.loadNodeModules`): strip self-hosted modules, augment with the
 * preset's implicit deps, filter build-time-only deps, then key-sort. The CLI
 * embeds the result as the lockset's `dependencies` echo and the runtime applies
 * a sidecar lockset only on an exact match against its own computed map — so any
 * divergence here just falls back to live resolution, never a wrong lockset.
 *
 * Self-hosted modules (`SELF_HOSTED_MODULES`, plus any extra `registryResolved`
 * names) are stripped so a freshly published version not yet replicated npm→CDN
 * can't 500 the whole `/dep_tree/` request. This mirrors the runtime's
 * `registryResolvedNames()` stripping, keeping the echo comparison matched.
 *
 * Absorbed from the CLI's `src/lockset.ts` duplicate (PRETRANSPILED_ARTIFACTS_SPEC
 * §4.4: the shared package is the single source of truth).
 */
export function computeInputDepMap(
  pkgDependencies: DepMap,
  registryResolved: readonly string[] = [],
): DepMap {
  const skip = new Set([...SELF_HOSTED_MODULES, ...registryResolved]);
  const selfHosted: DepMap = {};
  for (const [name, range] of Object.entries(pkgDependencies)) {
    if (!skip.has(name)) selfHosted[name] = range;
  }
  const augmented = augmentDependencies(selfHosted);
  const filtered: DepMap = {};
  for (const [name, range] of Object.entries(augmented)) {
    if (!isBuildDep(name) && !skip.has(name)) filtered[name] = range;
  }
  return sortDepMap(filtered);
}

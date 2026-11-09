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

/** The package.json fields `rootRuntimeDependencies` reads. Everything else is
 *  ignored, so a full parsed package.json satisfies it. */
export interface RootPackageShape {
  dependencies?: DepMap;
  peerDependencies?: DepMap;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/**
 * The dependency map a package AT THE ROOT OF A RUN resolves against (R3-289).
 *
 * For a package being *consumed*, `peerDependencies` is a request the consumer
 * satisfy — and the bundler's library-mount path deliberately ignores peers for
 * exactly that reason. But the package at the root of a run has no consumer: the
 * platform is the environment, so a peer it declares and nobody fetches is
 * simply absent. Two failure shapes, neither naming the cause:
 *
 *  1. the React preset injects `react-error-boundary` into every app, it imports
 *     `react`, and an app whose ONLY react declaration is a peer dies with
 *     `Cannot find module 'react'` (R3-289's Grove finding);
 *  2. a peer-only `@immediately-run/sdk` pin never reaches self-host resolution
 *     and silently falls back to the (very stale) platform default version.
 *
 * So at the root, non-optional peers are fetched like dependencies, with
 * `dependencies` winning any name both declare and `peerDependenciesMeta`
 * `.optional` entries skipped (npm's own semantics: an optional peer may be
 * absent). Shared by the sandbox runtime (`loadNodeModules`) and the CLI
 * cache-zip builder (the lockset input DepMap) so the runtime's echo-match
 * against a zip's lockset holds — two implementations would silently degrade
 * every peer-declaring app's zip to live resolution.
 */
export function rootRuntimeDependencies(pkg: RootPackageShape | undefined | null): DepMap {
  const peers: DepMap = {};
  const peerDeps = pkg?.peerDependencies ?? {};
  const meta = pkg?.peerDependenciesMeta ?? {};
  for (const [name, range] of Object.entries(peerDeps)) {
    if (typeof range !== 'string') continue;
    if (meta[name]?.optional) continue;
    peers[name] = range;
  }
  return { ...peers, ...(pkg?.dependencies ?? {}) };
}

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

/**
 * Reduce a package.json dependency range to a concrete `x.y.z[-pre][+build]`
 * version — the range's FLOOR (what a caret/hyphenless range guarantees): strip
 * a leading range operator and take the first version token. Returns
 * `undefined` for anything that is not a single pinned-ish version (a tag, a
 * URL, `*`, a multi-range), in which case the caller cannot re-pin and fails
 * loud. Absorbed from the sandbox's `registryResolvedModules.ts` so the
 * prerelease guard below can pin to the floor in exactly one spelling
 * (PRETRANSPILED_ARTIFACTS_SPEC §4.4: the shared package is the single home).
 *
 * `^0.2.7` → `0.2.7`.
 */
export function concreteVersion(range: string | undefined): string | undefined {
  if (typeof range !== 'string') return undefined;
  const trimmed = range
    .trim()
    .replace(/^[\^~]|^>=|^<=|^>|^<|^=|^v/g, '')
    .trim();
  const m = trimmed.match(/^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/);
  return m ? m[1] : undefined;
}

/** A version is a prerelease when its `x.y.z` core is followed by `-`; build
 *  metadata (`+…`) is ignored, matching the sandbox's `compareSemver`. No
 *  semver library — this is the whole rule. */
export function isPrereleaseVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-/.test(version.split('+')[0]);
}

/** Does this RANGE itself ask for a prerelease (e.g. `^19.3.0-rc.1`)? The one
 *  range question the guard needs — deliberately not a range evaluator. */
const carriesPrerelease = (range: string): boolean => /\d+\.\d+\.\d+-[0-9A-Za-z]/.test(range);

/** One resolved entry nobody asked for as a prerelease. */
export interface UnrequestedPrerelease {
  /** package name */
  n: string;
  /** the prerelease version the CDN resolved to */
  v: string;
  /** depth in the resolved tree (0 = top-level) */
  d: number;
  /** the range that was requested, when the entry's package was requested
   *  (re-pin fuel — top-level entries carry it) */
  range?: string;
}

/**
 * The unrequested-prerelease guard (R3-600): the primary CDN's `/dep_tree/` has
 * answered a caret range with a canary (`react ^19.2.5` →
 * `19.3.0-canary-ff7445e6-20260831` while stable 19.3.0 was on npm) — under
 * npm's semver a caret NEVER matches a prerelease, so every app declaring the
 * range ran a canary in production. Returns the resolved entries that are
 * prereleases although NO requested range asked for one; each caller decides
 * what to do (the sandbox re-resolves top-level offenders pinned to their
 * range's floor and fails the boot if one survives; the CLI never embeds one).
 *
 * If ANY requested range carries a prerelease tag, nothing is refused — a range
 * like `^19.3.0-rc.1` legitimately resolves to (and pulls dependencies on)
 * prereleases.
 */
export function findUnrequestedPrereleases(
  requested: DepMap,
  resolved: readonly ResolvedDependency[],
): UnrequestedPrerelease[] {
  if (Object.values(requested).some(carriesPrerelease)) return [];
  const out: UnrequestedPrerelease[] = [];
  for (const dep of resolved) {
    if (!isPrereleaseVersion(dep.v)) continue;
    out.push({ n: dep.n, v: dep.v, d: dep.d, ...(requested[dep.n] !== undefined ? { range: requested[dep.n] } : {}) });
  }
  return out;
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

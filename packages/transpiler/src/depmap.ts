import { augmentDependencies } from './presets/react';
import { isBuildDep } from './presets/build-dep';

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

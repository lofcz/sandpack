/*
 * Dependency lockset consumption (PRETRANSPILED_ARTIFACTS_SPEC §4.3, §5.4).
 *
 * A cache zip's manifest sidecar may carry a `lockset`: the verbatim
 * /dep_tree response the CLI captured at zip-build time for the packages the
 * app imports (`requested`), together with an echo of the app's declared
 * DepMap it was resolved against. When the echo matches the declared map the
 * bundler computes itself, the blocking dep_tree CDN request is skipped. Any
 * mismatch — version, shape, or dependency set — falls back to live
 * resolution; the lockset is a cache, never a source of truth. A package the
 * lockset did not cover (an import the CLI could not see) installs on demand.
 */

import { DepMap } from '.';
import { CDN_VERSION, IResolvedDependency } from './module-cdn';

export interface LocksetSection {
  cdnVersion: number;
  // The declared DepMap the lockset was resolved against (the /dep_tree pins):
  // computeDeclaredDepMap(package.json dependencies).
  dependencies: DepMap;
  // The /dep_tree request: the declared packages the app imports
  // (computeRequestDepMap).
  requested: DepMap;
  // Verbatim /dep_tree response.
  resolved: IResolvedDependency[];
}

const isDepMap = (value: unknown): value is DepMap =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => typeof v === 'string');

const isResolvedDependency = (value: unknown): value is IResolvedDependency => {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<IResolvedDependency>;
  return typeof d.n === 'string' && typeof d.v === 'string' && typeof d.d === 'number' && (d.s === undefined || typeof d.s === 'string');
};

/**
 * Structural validation of an untrusted sidecar `lockset` value. Returns the
 * section when well-formed AND resolved against this runtime's CDN protocol
 * version, else null (→ live resolution).
 */
export const validateLockset = (value: unknown): LocksetSection | null => {
  if (!value || typeof value !== 'object') return null;
  const l = value as Partial<LocksetSection>;
  if (l.cdnVersion !== CDN_VERSION) return null;
  if (!isDepMap(l.dependencies) || !isDepMap(l.requested)) return null;
  if (!Array.isArray(l.resolved) || !l.resolved.every(isResolvedDependency)) return null;
  return l as LocksetSection;
};

/** Order-independent exact equality of two DepMaps (same keys, same ranges). */
export const depMapsEqual = (a: DepMap, b: DepMap): boolean => {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((k) => b[k] === a[k]);
};

/**
 * Closure check (SPEC_REVIEW PT-2): the echo-match proves the declared DepMap
 * is the app's, but NOT that `requested`/`resolved` faithfully resolve it — a
 * lockset could echo the right inputs yet inject extra packages, which
 * `preloadModules` would then fetch. /dep_tree returns a flat DEPTH list (no
 * parent edges), so we enforce what is verifiable network-free:
 *
 *  Declared request — every requested package is declared at the declared
 *  range, so the request can only narrow the app's own map.
 *
 *  No injected root — every depth-0 entry must be a requested package. A
 *  top-level package the request never named is the clear injection signal (the
 *  resolved set for a given input is otherwise deterministic).
 *
 * Residual (documented): a package injected at depth > 0 (claiming to be a
 * transitive dep) cannot be refuted without adjacency in /dep_tree. It is inert
 * unless an `import` reaches it (an un-imported fetched module is never
 * evaluated); fully closing it needs a /dep_tree shape that carries edges. We do
 * NOT require completeness here (every requested dep present in `resolved`):
 * a missing dep is an app-breakage, not an injection, and is reported by the
 * registry's resolution guard on either path.
 *
 * Returns true when the lockset may be used; false → fall back to live
 * resolution (the whole lockset is rejected, never partially trusted).
 */
export const locksetClosureValid = (lockset: LocksetSection): boolean => {
  for (const [name, range] of Object.entries(lockset.requested)) {
    if (!Object.prototype.hasOwnProperty.call(lockset.dependencies, name)) return false; // undeclared request
    if (lockset.dependencies[name] !== range) return false; // request outside the declared range
  }
  for (const r of lockset.resolved) {
    if (r.d === 0 && !Object.prototype.hasOwnProperty.call(lockset.requested, r.n)) return false; // injected top-level package
  }
  return true;
};

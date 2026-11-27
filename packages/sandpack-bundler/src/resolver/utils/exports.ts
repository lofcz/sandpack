// package.json `exports` and `imports`, resolved as Node does (PACKAGE_EXPORTS_RESOLVE,
// PACKAGE_IMPORTS_RESOLVE and PACKAGE_TARGET_RESOLVE in the ESM resolver algorithm).
// One deliberate difference: conditions are tried in this bundler's fixed priority,
// not in the package's key order (see CONDITIONS).

// Conditions this bundler satisfies, from high to low priority. `require` stays above
// `import`: precompiled CommonJS calls `require("pkg/x")()` and must get the CommonJS
// build, not the namespace of a transpiled ES module.
const CONDITIONS = ['browser', 'development', 'default', 'require', 'import'];

export type PackageTarget =
  // A file of the package, relative to its root and without a leading "./".
  | { kind: 'file'; path: string }
  // Another module (only `imports` may name one).
  | { kind: 'module'; specifier: string };

export type PackageResolution =
  | { target: PackageTarget }
  // `excluded`: the matching key maps to null, or to conditions this bundler does not
  // satisfy. `unmatched`: no key matches the subpath.
  | { target?: undefined; reason: 'excluded' | 'unmatched' };

interface SubpathMatch {
  target: unknown;
  // What `*` stands for; null for an exact key.
  match: string | null;
  // A key ending in "/" (the pre-pattern directory form): the rest is appended.
  directory: boolean;
}

interface PatternKey {
  key: string;
  base: string;
  trailer: string;
  directory: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Pattern keys of a map, most specific first (Node's PATTERN_KEY_COMPARE: the longer
// base wins, then the longer key). Computed once per package.json object.
const patternKeysCache = new WeakMap<object, PatternKey[]>();
function patternKeys(map: Record<string, unknown>): PatternKey[] {
  let keys = patternKeysCache.get(map);
  if (!keys) {
    keys = [];
    for (const key of Object.keys(map)) {
      const star = key.indexOf('*');
      if (star >= 0) {
        // Only a single "*" makes a pattern.
        if (key.indexOf('*', star + 1) < 0) {
          keys.push({ key, base: key.slice(0, star), trailer: key.slice(star + 1), directory: false });
        }
      } else if (key.endsWith('/')) {
        keys.push({ key, base: key, trailer: '', directory: true });
      }
    }
    keys.sort((a, b) => b.base.length - a.base.length || b.key.length - a.key.length);
    patternKeysCache.set(map, keys);
  }
  return keys;
}

function matchSubpath(map: Record<string, unknown>, subpath: string): SubpathMatch | undefined {
  if (Object.prototype.hasOwnProperty.call(map, subpath) && !subpath.includes('*') && !subpath.endsWith('/')) {
    return { target: map[subpath], match: null, directory: false };
  }
  for (const { key, base, trailer, directory } of patternKeys(map)) {
    if (subpath.length <= base.length || !subpath.startsWith(base)) continue;
    if (trailer && (subpath.length < key.length || !subpath.endsWith(trailer))) continue;
    return { target: map[key], match: subpath.slice(base.length, subpath.length - trailer.length), directory };
  }
  return undefined;
}

// A file target, normalized; undefined when it would leave the package.
function fileTarget(target: string): PackageTarget | undefined {
  const segments: string[] = [];
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return undefined;
    segments.push(segment);
  }
  return segments.length ? { kind: 'file', path: segments.join('/') } : undefined;
}

// null: the target excludes the subpath. undefined: nothing here applies, the caller
// goes on to its next condition or array item.
function resolveTarget(target: unknown, found: SubpathMatch, isImports: boolean): PackageTarget | null | undefined {
  if (typeof target === 'string') {
    const filled = found.directory
      ? target + found.match
      : found.match === null
      ? target
      : target.split('*').join(found.match);
    if (filled.startsWith('./')) return fileTarget(filled);
    if (filled.startsWith('../') || filled.startsWith('/')) return undefined;
    // Node rejects an `exports` target without "./"; packages that write one mean a
    // file of the package, which is how this resolver and the CDN always read it.
    return isImports ? { kind: 'module', specifier: filled } : fileTarget(filled);
  }
  if (Array.isArray(target)) {
    let last: PackageTarget | null | undefined;
    for (const item of target) {
      last = resolveTarget(item, found, isImports);
      if (last) return last;
    }
    return target.length ? last : null;
  }
  if (isObject(target)) {
    for (const condition of CONDITIONS) {
      if (!Object.prototype.hasOwnProperty.call(target, condition)) continue;
      const resolved = resolveTarget(target[condition], found, isImports);
      // A condition that leads nowhere (only `node`/`types` below it) does not end the
      // search: the next condition applies.
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  }
  // null, and `false` which packages write to mean the same.
  return target === null || target === false ? null : undefined;
}

function resolveIn(map: Record<string, unknown>, subpath: string, isImports: boolean): PackageResolution {
  const found = matchSubpath(map, subpath);
  if (!found) return { reason: 'unmatched' };
  const target = resolveTarget(found.target, found, isImports);
  return target ? { target } : { reason: 'excluded' };
}

/** Whether `exports` is a map of subpaths (keys start with ".") rather than one target. */
function isSubpathMap(exports: unknown): exports is Record<string, unknown> {
  if (!isObject(exports)) return false;
  for (const key in exports) {
    if (key[0] === '.') return true;
  }
  return false;
}

/**
 * The target `exports` gives a subpath ("." for the package itself, "./x" below it).
 * A string, an array or a conditions object is the package's only export.
 */
export function resolvePackageExports(exports: unknown, subpath: string): PackageResolution {
  if (isSubpathMap(exports)) return resolveIn(exports, subpath, false);
  if (subpath !== '.') return { reason: 'unmatched' };
  const target = resolveTarget(exports, { target: exports, match: null, directory: false }, false);
  return target ? { target } : { reason: 'excluded' };
}

/** The target `imports` gives a "#name" specifier. */
export function resolvePackageImports(imports: unknown, specifier: string): PackageResolution {
  if (!isObject(imports)) return { reason: 'unmatched' };
  return resolveIn(imports, specifier, true);
}

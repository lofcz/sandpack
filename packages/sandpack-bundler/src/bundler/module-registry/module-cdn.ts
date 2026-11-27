import { decode as decodeMsgPack } from '@msgpack/msgpack';
import urlJoin from 'url-join';

import { fetchDecoded, registerImmutableUrlPrefix } from '../../utils/fetch';
import { DepMap } from '.';

// Package CDN root — self-hosted only (Priprava `/sandpack-cdn/`). Never a
// public third-party CDN. Resolution order:
//  1) {@link setCdnRoot} from the parent `register-frame` handshake (preferred;
//     opaque-origin iframes cannot reliably derive a host from location)
//  2) build-time `SANDPACK_CDN_ROOT` (Parcel inlines `process.env.*`)
//  3) sibling of the bundler document URL (`…/sandpack-bundler/` → `…/sandpack-cdn/`)

function normalizeCdnRoot(root: string): string {
  return root.endsWith('/') ? root : `${root}/`;
}

let cdnRootCached: string | null = null;

/**
 * Pin the CDN root from the host handshake. Must run before the first
 * `/dep_tree` or `/package` fetch.
 */
export function setCdnRoot(root: string): void {
  if (!root || typeof root !== 'string') {
    throw new Error('setCdnRoot: expected a non-empty sandpack CDN URL');
  }
  cdnRootCached = normalizeCdnRoot(root);
  // /package/<name@exact-version> never changes for a given URL → cache-first.
  // /dep_tree/ is NOT registered: it resolves semver ranges and can change.
  registerImmutableUrlPrefix(urlJoin(cdnRootCached, '/package/'));
}

function resolveCdnRoot(): string {
  if (cdnRootCached) return cdnRootCached;
  const fromEnv = process.env.SANDPACK_CDN_ROOT;
  if (fromEnv && fromEnv.length > 0) {
    setCdnRoot(fromEnv);
    return cdnRootCached!;
  }
  try {
    // Use href, not location.origin — sandboxed opaque origins report "null".
    const u = new URL(self.location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      setCdnRoot(`${u.origin}/sandpack-cdn/`);
      return cdnRootCached!;
    }
  } catch {
    // fall through
  }
  throw new Error(
    'Sandpack CDN root not configured. The host must pass sandpackCdnRoot on register-frame ' +
      '(Priprava /sandpack-cdn/), or set SANDPACK_CDN_ROOT at bundler build time.',
  );
}

/** Lazily resolve + register the immutable `/package/` prefix once. */
function cdnRoot(): string {
  return resolveCdnRoot();
}

export interface IResolvedDependency {
  // name
  n: string;
  // version
  v: string;
  // depth
  d: number;
  // npm package the files come from, only for an `npm:` alias (`n` is then the install name)
  s?: string;
  // the entries the tree loads from this package (`.`, `./client`, …)
  e?: string[];
}

// Exported so the lockset check (lockset.ts) can reject locksets resolved
// against a different CDN protocol version.
export const CDN_VERSION = 7;

function encodePayload(payload: string): string {
  return btoa(`${CDN_VERSION}(${payload})`);
}

// /dep_tree answers only once every cold package of the tree is downloaded and
// transformed, so one attempt gets longer than the default before it is given up.
const DEP_TREE_TIMEOUTS = { attemptTimeoutMs: 60_000, totalTimeoutMs: 180_000 };

/**
 * One CDN reply, decoded. `shaped` says whether the decoded value is the
 * payload asked for: a reply that does not decode to it (truncated, or a
 * proxy's page with status 200) is retried and never cached.
 *
 * Keeps requests below proxy path-segment limits without splitting dependency resolution.
 */
async function fetchPayload<T>(
  endpoint: 'dep_tree' | 'package',
  payload: string,
  subject: string,
  shaped: (value: unknown) => value is T,
): Promise<T> {
  const encoded = encodePayload(payload);
  const segment = encodeURIComponent(encoded);
  const long = segment.length > 240;
  return fetchDecoded(
    urlJoin(cdnRoot(), long ? `/${endpoint}` : `/${endpoint}/${segment}`),
    {
      ...(long ? { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: encoded } : {}),
      ...(endpoint === 'dep_tree' ? DEP_TREE_TIMEOUTS : {}),
      maxRetries: 5,
      retryDelay: 1000,
      subject,
    },
    (body) => {
      const value = decodeMsgPack(body);
      if (!shaped(value)) throw new TypeError(`not a /${endpoint} payload`);
      return value;
    },
  );
}

const isManifest = (value: unknown): value is IResolvedDependency[] => Array.isArray(value);

const isModulePart = (value: unknown): value is ICDNModule => {
  const part = value as Partial<ICDNModule> | null;
  return (
    part !== null && typeof part === 'object' && part.f !== null && typeof part.f === 'object' && Array.isArray(part.m)
  );
};

/** The packages a /dep_tree request is about, short enough for an error message. */
function describeDeps(deps: DepMap): string {
  const names = Object.keys(deps);
  const shown = names.slice(0, 5).map((name) => `${name}@${deps[name]}`);
  if (names.length > shown.length) shown.push(`${names.length - shown.length} more`);
  return `the dependency tree of ${shown.join(', ')}`;
}

/**
 * Resolve `deps` (the packages to install) to a flat tree. `entries` names
 * what is imported from each (`.` when absent): only those entries' closures
 * are followed, and each tree entry reports the entries it is loaded through.
 * `pins` fix a name's range wherever it appears in that tree — the app's
 * declared map plus what is already installed — so a declared package reached
 * only transitively (a peer) still gets the app's version, and a later batch
 * never re-resolves an installed package to a different one.
 */
export async function fetchManifest(
  deps: DepMap,
  pins: DepMap = {},
  entries: Record<string, string[]> = {},
): Promise<IResolvedDependency[]> {
  return fetchPayload('dep_tree', JSON.stringify({ deps, pins, entries }), describeDeps(deps), isManifest);
}

export type CDNModuleFileType = ICDNModuleFile | number;

export interface ICDNModuleFile {
  // content
  c: string;
  // dependencies
  d: string[];
  // is transpiled
  t: boolean;
}

export interface ICDNModule {
  // files
  f: Record<string, CDNModuleFileType>;
  // transient dependencies
  m: string[];
}

/** One `/package` response: an entry's closure, or the listing (`entry: null`). */
async function fetchPackagePart(name: string, version: string, entry: string | null): Promise<ICDNModule> {
  const subject = `${name}@${version} (${entry === null ? 'file listing' : `entry ${entry}`})`;
  return fetchPayload('package', JSON.stringify({ name, version, entry }), subject, isModulePart);
}

/** Overlay inlined files onto `into` (a listing entry becomes the inlined file). */
export function mergeModuleParts(into: ICDNModule, parts: ICDNModule[]): ICDNModule {
  const files = { ...into.f };
  const modules = new Set(into.m);
  for (const part of parts) {
    for (const [path, file] of Object.entries(part.f)) {
      if (typeof file === 'object' || files[path] === undefined) files[path] = file;
    }
    for (const name of part.m) modules.add(name);
  }
  return { f: files, m: [...modules] };
}

/**
 * The closures of `entries` without the listing — for a package already
 * installed, whose listing the bundler holds.
 */
export async function fetchModuleEntries(name: string, version: string, entries: string[]): Promise<ICDNModule> {
  const parts = await Promise.all(entries.map((entry) => fetchPackagePart(name, version, entry)));
  return mergeModuleParts({ f: {}, m: [] }, parts);
}

/**
 * A package release as the bundler installs it: the file listing (what
 * resolution sees) with the closures of `entries` inlined. Each part is its
 * own immutable, separately cached response.
 */
export async function fetchModule(name: string, version: string, entries: string[] = ['.']): Promise<ICDNModule> {
  const [listing, ...parts] = await Promise.all([
    fetchPackagePart(name, version, null),
    ...entries.map((entry) => fetchPackagePart(name, version, entry)),
  ]);
  return mergeModuleParts(listing, parts);
}

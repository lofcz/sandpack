import { npmFileUrl } from '../../FileSystem/npmFileUrl';
import { ICDNModule } from './module-cdn';
import type { NpmRelease } from './NodeModule';

// esm.sh fallback for packages the primary dependency CDN (blazingly.io) cannot
// resolve — most often a version newer than its npm mirror has ingested. esm.sh
// tracks npm in near real time, so it covers the gap.
//
// Approach (transpile-through, shared React): we fetch the package's esm.sh
// SOURCE with the already-resolved deps marked `?external=...`, so esm.sh emits
// bare `import ... from "react"` (etc.) instead of bundling its own copies. That
// source is registered as a synthetic package and transpiled by the SAME chain
// the bundler runs, so its `require("react")` resolves through the bundler to the
// APP's React instance. This is what makes a React component library work: an
// earlier native-`import()` approach gave the fallback its OWN esm.sh React, and
// any package calling a hook against it (lucide-react@1.x reads `IconContext` via
// `useContext`) crashed with a null dispatcher. Sharing React via the bundler's
// own resolution avoids that entirely — no import map, no global, no dual React.
//
// Scope: handles a package whose esm.sh output is a single self-contained module
// (after following esm.sh's re-export stub) importing only the externalized,
// already-resolved deps — the common "newer version of a leaf library" case.
// A multi-internal-chunk package throws the clear "could not resolve" error
// rather than silently shipping a broken module.
//
// CSP: no change required. The sandbox document ships no CSP, and this is a
// direct cross-origin fetch from the iframe (not parent-forwarded); esm.sh sends
// `access-control-allow-origin: *`. If a CSP is ever added to the sandbox origin
// it must list `https://esm.sh` in `connect-src`.

export type EsmFallbackFetcher = (url: string) => Promise<string>;

const ESM_ORIGIN = 'https://esm.sh';

/** Default source fetcher — a plain cross-origin `fetch` (CORS-allowed by esm.sh). */
export const nativeEsmFallbackFetcher: EsmFallbackFetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
};

/** Build the esm.sh entry URL. Every already-resolved dependency is externalized
 *  so esm.sh emits bare imports for them — the bundler then resolves each to the
 *  shared instance it already has, instead of esm.sh bundling a duplicate. */
export function esmFallbackEntryUrl(name: string, range: string, externals: readonly string[]): string {
  const ext = externals.length ? `external=${[...externals].sort().join(',')}&` : '';
  return `${ESM_ORIGIN}/${name}@${range}?${ext}target=es2022`;
}

/** A specifier that points back into esm.sh (an internal chunk), vs a bare
 *  package name (`react`) that the bundler resolves. */
export function isEsmInternal(spec: string): boolean {
  return spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../') || spec.startsWith(ESM_ORIGIN);
}

/** Every module specifier the source imports/re-exports (static + dynamic). */
export function importedSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const fromRe = /\bfrom\s*["']([^"']+)["']/g; // import ... from / export ... from
  const dynRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [fromRe, dynRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specs.push(m[1]);
  }
  return specs;
}

/** If `src` is a pure esm.sh re-export stub (only `export * / {…} from "<one
 *  internal url>"`, no other code), return that internal URL; else null. esm.sh's
 *  package entry is such a stub pointing at the real `.mjs`. */
export function parseReexportStub(src: string): string | null {
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .trim();
  if (!stripped) return null;
  const targets = new Set<string>();
  for (const stmt of stripped.split(';').map((s) => s.trim()).filter(Boolean)) {
    const m = stmt.match(/^export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s*["']([^"']+)["']$/);
    if (!m) return null; // any non-reexport statement → not a stub
    targets.add(m[1]);
  }
  if (targets.size !== 1) return null;
  const url = [...targets][0];
  return isEsmInternal(url) ? new URL(url, ESM_ORIGIN).href : null;
}

/**
 * Fetch the package's esm.sh source, following re-export stubs to the real
 * module. Returns a single source whose only imports are bare (externalized)
 * specifiers, and the URL it came from (which names the release esm.sh built).
 * Throws if it still references esm.sh-internal chunks (multi-module package —
 * out of scope for the single-module fallback).
 */
export async function fetchEsmFallback(
  entryUrl: string,
  fetcher: EsmFallbackFetcher,
  maxHops = 8,
): Promise<{ source: string; moduleUrl: string }> {
  let url = entryUrl;
  let src = await fetcher(url);
  for (let hop = 0; hop < maxHops; hop++) {
    const next = parseReexportStub(src);
    if (!next) break;
    url = next;
    src = await fetcher(url);
  }
  const internal = importedSpecifiers(src).filter(isEsmInternal);
  if (internal.length) {
    throw new Error(
      `esm.sh module spans ${internal.length} internal chunk(s) (e.g. "${internal[0]}"); ` +
        `the single-module fallback can't inline it`,
    );
  }
  return { source: src, moduleUrl: url };
}

export async function fetchEsmFallbackSource(entryUrl: string, fetcher: EsmFallbackFetcher, maxHops = 8): Promise<string> {
  return (await fetchEsmFallback(entryUrl, fetcher, maxHops)).source;
}

/** The version in an esm.sh build path (`/<name>@<version>/…`), or null. */
export function esmBuildVersion(name: string, moduleUrl: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(moduleUrl, ESM_ORIGIN).pathname);
  } catch {
    return null;
  }
  const prefix = `/${name}@`;
  if (!path.startsWith(prefix)) return null;
  const version = path.slice(prefix.length).split('/')[0];
  return version || null;
}

/** Real files of the release esm.sh built, so a fallback package keeps its
 *  stylesheets, fonts and images (`import "pkg/dist/style.css"`). */
export interface EsmFallbackRelease {
  release: NpmRelease;
  /** Non-script package files → byte size, listed for lazy reads. */
  assets: Record<string, number>;
  /** The package's own `exports`, consulted for asset subpaths. */
  exports: unknown;
}

// Code is what esm.sh replaced; typings and maps are not needed by the preview.
const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?|map)$/i;

type NpmMeta = { version?: unknown; files?: Array<{ path?: unknown; size?: unknown }> };

/**
 * Confirm the release on the npm file origin: its listing must report the
 * exact version esm.sh built, or the fallback stays without assets (as before).
 */
export async function fetchEsmFallbackRelease(
  name: string,
  moduleUrl: string,
  fetcher: EsmFallbackFetcher,
): Promise<EsmFallbackRelease | null> {
  const version = esmBuildVersion(name, moduleUrl);
  if (!version) return null;
  try {
    const [meta, pkg] = await Promise.all([
      fetcher(npmFileUrl(name, version, '?meta')).then((text) => JSON.parse(text) as NpmMeta),
      fetcher(npmFileUrl(name, version, 'package.json')).then((text) => JSON.parse(text) as { exports?: unknown }),
    ]);
    if (meta.version !== version || !Array.isArray(meta.files)) return null;
    const assets: Record<string, number> = {};
    for (const file of meta.files) {
      if (typeof file.path !== 'string' || typeof file.size !== 'number') continue;
      const path = file.path.replace(/^\//, '');
      if (path && path !== 'package.json' && !SCRIPT_FILE.test(path)) assets[path] = file.size;
    }
    return { release: { name, version }, assets, exports: pkg.exports };
  } catch {
    return null;
  }
}

/** Keep the package's subpath exports so asset imports resolve, with the root
 *  pointing at the synthesized module. Null when it declares no subpaths. */
function fallbackExports(exports: unknown): Record<string, unknown> | null {
  if (!exports || typeof exports !== 'object' || Array.isArray(exports)) return null;
  const entries = Object.entries(exports as Record<string, unknown>).filter(([key]) => key.startsWith('./'));
  if (entries.length === 0) return null;
  return { ...Object.fromEntries(entries), '.': './index.js', './package.json': './package.json' };
}

/** Path the synthetic fallback package is mounted at (its transpile path also
 *  selects the PLAIN chain — under /node_modules, so no react-refresh wrap). */
export const esmFallbackModulePath = (name: string): string => `/node_modules/${name}/index.js`;

/**
 * Shape the transpiled fallback as an `ICDNModule` so it flows through the normal
 * NodeModule → RegistryFS → resolution path. `code` is already CJS (transpiled by
 * the shared chain); `deps` are its bare `require()` specifiers (e.g. `react`),
 * resolved by the bundler to the shared instances. `t: true` keeps it from being
 * re-transpiled.
 */
export function synthesizeEsmFallbackModule(
  name: string,
  range: string,
  code: string,
  deps: readonly string[],
  release: EsmFallbackRelease | null = null,
): ICDNModule {
  const exports = release ? fallbackExports(release.exports) : null;
  const pkg = { name, version: release?.release.version ?? range, main: 'index.js', ...(exports && { exports }) };
  return {
    f: {
      ...release?.assets,
      'package.json': { c: JSON.stringify(pkg), d: [], t: true },
      'index.js': { c: code, d: [...deps], t: true },
    },
    m: [],
  };
}

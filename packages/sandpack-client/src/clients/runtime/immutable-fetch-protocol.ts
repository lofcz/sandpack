/**
 * Parent-side fetch + cache for immutable, exact-versioned module URLs.
 *
 * The bundler iframe runs at an opaque origin (sandboxed without
 * `allow-same-origin`), so it has no persistent storage of any kind — its own
 * Cache API is unavailable. It therefore forwards immutable-URL fetches here
 * over the iframe protocol (`protocol-immutable-fetch`), and the parent — a
 * real origin — serves them cache-first from a persistent Cache API cache.
 *
 * Security: the handler only fetches URLs matching {@link IMMUTABLE_URL_ALLOWLIST}.
 * The iframe runs untrusted code, and an unrestricted parent-side fetch proxy
 * would let it read arbitrary cross-origin responses with the parent's network
 * context (a CORS bypass). The allowlist mirrors the prefixes the bundler
 * registers via `registerImmutableUrlPrefix` (see sandpack-bundler
 * `src/utils/fetch.ts`) — keep the two in sync.
 */

import { EXTENSIONS_MAP } from "./mime";
import { getExtension } from "./utils";

/**
 * Allowlist entries: an exact ORIGIN plus a path prefix matched against the
 * NORMALIZED pathname. R3-364: the old check was `url.startsWith(prefix)` on
 * the RAW string before any normalization, so
 * `https://immediately-run.github.io/immediately-run-sdk/v/../x` passed the
 * `/v/` check before normalization. Match the parsed origin and normalized
 * pathname, including for host-supplied prefixes; reject remaining encoded
 * dot segments that a server might interpret differently.
 */
interface AllowedOrigin {
  origin: string;
  pathPrefix: string;
  /**
   * What the prefix serves: single files of a package as published, or the
   * module CDN's packed `/package/` payloads. Decides what may be cached.
   */
  serves: "files" | "packages";
}

const IMMUTABLE_URL_ALLOWLIST: AllowedOrigin[] = [
  // The self-hosted module CDN is supplied through immutableUrlPrefixes.
  // unpkg files, requested by the bundler at registry-resolved exact versions.
  { origin: "https://unpkg.com", pathPrefix: "/", serves: "files" },
  // Self-hosted, versioned @immediately-run/sdk builds (SDK_PACKAGING_SPEC
  // §5/§11, Option A). The /v/<version>/ path encodes the exact version, so
  // responses are immutable; the bundler fetches these when an app opts the SDK
  // into immediately.run.resolveFromRegistry. Keep in sync with the prefix the
  // bundler registers via registerImmutableUrlPrefix (sandbox bundler.ts).
  {
    origin: "https://immediately-run.github.io",
    pathPrefix: "/immediately-run-sdk/v/",
    serves: "files",
  },
];

/**
 * The allowlist entry a PARSED URL falls under, if any. Origin is compared
 * exactly (a userinfo or lookalike host cannot match) and the path prefix
 * against the URL parser's NORMALIZED pathname; additionally, any dot segment —
 * literal or percent-encoded, in any hex case — is refused, so no spelling of
 * `..` can cross the prefix boundary after a server-side decode.
 */
const policyFor = (
  u: URL,
  allowlist: AllowedOrigin[],
): AllowedOrigin | undefined => {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password)
    return undefined;
  const segments = u.pathname.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment).toLowerCase();
    } catch {
      return segment.toLowerCase();
    }
  });
  if (segments.some((s) => s === ".." || s === ".")) return undefined;
  if (/%2e/.test(u.pathname.toLowerCase())) return undefined;
  return allowlist.find(
    ({ origin, pathPrefix }) =>
      u.origin === origin && u.pathname.startsWith(pathPrefix),
  );
};

// Old entries lost their final redirect URL, so they cannot be revalidated.
const IMMUTABLE_CACHE_NAME = "sandpack-immutable-fetch-v2";

const allowedPrefix = (prefix: string): AllowedOrigin[] => {
  try {
    const url = new URL(prefix);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return [];
    }
    return [
      { origin: url.origin, pathPrefix: url.pathname, serves: "packages" },
    ];
  } catch {
    return [];
  }
};

export interface ImmutableFetchResult {
  status: number;
  contentType: string;
  /** Structured-cloned (copied) to the iframe in the protocol response. */
  body: ArrayBuffer;
}

const serializeResponse = async (
  res: Response,
): Promise<ImmutableFetchResult> => ({
  status: res.status,
  contentType: res.headers.get("content-type") ?? "",
  body: await res.arrayBuffer(),
});

/**
 * Content types of a module CDN `/package/` payload. sandpack-cdn labels its
 * msgpack replies `application/javascript` so that proxies compress them
 * (crates/sandpack-cdn/src/router/custom_reply.rs); the others are the labels
 * msgpack goes by when it is named for what it is.
 */
const PACKAGE_PAYLOAD_TYPES = new Set([
  "application/javascript",
  "application/msgpack",
  "application/x-msgpack",
  "application/vnd.msgpack",
]);

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

/**
 * May this response be kept forever under its URL? Only when it is what the
 * URL promises. A page served in a payload's place with status 200 (an SPA
 * fallback while the CDN is down, a captive portal) would otherwise fail every
 * later boot until the cache is wiped.
 */
const cacheable = (
  result: ImmutableFetchResult,
  url: URL,
  serves: AllowedOrigin["serves"],
): boolean => {
  if (result.status !== 200) return false;
  const type = result.contentType.split(";", 1)[0].trim().toLowerCase();
  if (serves === "packages") {
    return result.body.byteLength > 0 && PACKAGE_PAYLOAD_TYPES.has(type);
  }
  // A package may ship any kind of file, HTML included, but an HTML document
  // under a name that is not an HTML file's stands in for the file.
  return (
    !HTML_TYPES.has(type) ||
    EXTENSIONS_MAP.get(getExtension(url.pathname).toLowerCase()) === type
  );
};

// CacheStorage may be unavailable (insecure context) or fail (storage
// pressure); degrade to a plain fetch rather than failing the request.
const openCache = async (): Promise<Cache | undefined> => {
  try {
    return await caches.open(IMMUTABLE_CACHE_NAME);
  } catch {
    return undefined;
  }
};

/** SHA-384 of bytes, formatted `sha384-<base64>` (SRI style). */
const sha384 = async (body: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-384", body);
  let bin = "";
  const view = new Uint8Array(digest);
  for (let i = 0; i < view.length; i++)
    bin += String.fromCharCode(view[i]);
  return `sha384-${btoa(bin)}`;
};

/**
 * Does `body` match the caller-supplied `integrity` (an `sha384-<base64>` SRI
 * hash)? Returns true when no integrity was supplied (nothing to check).
 */
const matchesIntegrity = async (
  body: ArrayBuffer,
  integrity: string | undefined,
): Promise<boolean> => {
  if (!integrity) return true;
  try {
    return (await sha384(body)) === integrity;
  } catch {
    // crypto unavailable → can't verify; treat as a non-match so we neither
    // serve nor persist bytes we couldn't validate (fail safe).
    return false;
  }
};

/**
 * `protocol-immutable-fetch` handler: serve an allowlisted immutable URL,
 * cache-first from the persistent parent-side cache.
 *
 * INTEGRITY-AWARE CACHING (cache-poisoning prevention). When the caller passes
 * the expected SHA-384 (`integrity`), the cache is never allowed to serve or
 * persist bytes that don't match it:
 *  - verify-on-read: a cache HIT whose bytes no longer match the expected hash
 *    (the host re-pinned the version under the cached bytes) is EVICTED and the
 *    URL refetched, so a stale/poisoned entry self-heals instead of failing the
 *    consumer forever.
 *  - verify-before-cache: freshly fetched bytes are only stored when they match.
 *    Mismatched bytes are returned (so the consumer's own check fails closed with
 *    a clear error) but NEVER cached, so a bad upstream window can't poison the
 *    cache. Without an `integrity` argument the URL is cached by URL as before.
 *
 * Either way only a plausible payload is kept (see {@link cacheable}), and an
 * entry that is not one is evicted the same way as a mismatching one.
 */
export async function handleImmutableFetch(
  url: unknown,
  integrity?: unknown,
  extraPrefixes: string[] = [],
): Promise<ImmutableFetchResult> {
  const allowlist = IMMUTABLE_URL_ALLOWLIST.concat(
    extraPrefixes.flatMap(allowedPrefix),
  );
  if (typeof url !== "string") {
    throw new Error(`URL not allowed for immutable fetch: ${String(url)}`);
  }
  // R3-364: the policy check runs on the PARSED, NORMALIZED URL — never on the
  // raw string (see IMMUTABLE_URL_ALLOWLIST). A malformed URL refuses here.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`URL not allowed for immutable fetch: ${url}`);
  }
  const policy = policyFor(parsed, allowlist);
  if (!policy) {
    throw new Error(`URL not allowed for immutable fetch: ${url}`);
  }
  const expected = typeof integrity === "string" ? integrity : undefined;

  const cache = await openCache();
  if (cache) {
    const hit = await cache.match(url).catch(() => undefined);
    if (hit) {
      const cached = await serializeResponse(hit);
      if (
        cacheable(cached, parsed, policy.serves) &&
        (await matchesIntegrity(cached.body, expected))
      ) {
        return cached;
      }
      // Stale/poisoned entry: drop it and fall through to a fresh fetch.
      await cache.delete(url).catch(() => undefined);
    }
  }

  const res = await fetch(parsed);
  if (!res.ok) {
    throw new Error(
      `Immutable fetch failed with status ${res.status}: ${url}`,
    );
  }
  // R3-364: the prefix hosts are exact-version content hosts; a redirect that
  // leaves the allowlist means the bytes did NOT come from an in-policy origin —
  // refuse rather than serve (and never cache) them. The browser follows
  // redirects itself (cross-origin `redirect: 'manual'` responses are opaque),
  // so this is the final-URL check: `res.url` is where the bytes actually came
  // from. A response that reports no URL (test doubles) skips the check.
  if (
    res.redirected &&
    res.url !== "" &&
    !policyFor(new URL(res.url), allowlist)
  ) {
    throw new Error(
      `Immutable fetch redirected outside the allowlist: ${res.url}`,
    );
  }
  const result = await serializeResponse(res);
  if (
    cache &&
    cacheable(result, parsed, policy.serves) &&
    (await matchesIntegrity(result.body, expected))
  ) {
    // Only persist verified bytes. A failed put (quota) only costs the entry.
    await cache
      .put(
        url,
        new Response(result.body.slice(0), {
          status: result.status,
          headers: { "content-type": result.contentType },
        }),
      )
      .catch(() => undefined);
  }
  return result;
}

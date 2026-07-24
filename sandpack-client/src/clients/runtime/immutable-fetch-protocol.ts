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

/**
 * Built-in URL prefixes whose responses never change for a given URL (the URL
 * encodes the exact content version). Only these (plus any prefixes passed via
 * {@link handleImmutableFetch}'s `extraPrefixes`) may be fetched on the
 * iframe's behalf, and they are safe to cache forever.
 */
const IMMUTABLE_URL_ALLOWLIST = [
  // Legacy public staging CDN (fallback when bundler couldn't derive a host).
  // Prefer passing the Priprava `/sandpack-cdn/package/` prefix via ClientOptions.
  "https://sandpack-cdn-staging.blazingly.io/package/",
  // unpkg files, requested by the bundler at registry-resolved exact versions.
  "https://unpkg.com/",
  // Self-hosted, versioned @lofcz/sdk builds (SDK_PACKAGING_SPEC
  // §5/§11, Option A). The /v/<version>/ path encodes the exact version, so
  // responses are immutable; the bundler fetches these when an app opts the SDK
  // into immediately.run.resolveFromRegistry. Keep in sync with the prefix the
  // bundler registers via registerImmutableUrlPrefix (sandbox bundler.ts).
  "https://immediately-run.github.io/immediately-run-sdk/v/",
];

const IMMUTABLE_CACHE_NAME = "sandpack-immutable-fetch-v1";

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
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
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
 */
export async function handleImmutableFetch(
  url: unknown,
  integrity?: unknown,
  extraPrefixes?: string[],
): Promise<ImmutableFetchResult> {
  const allowlist =
    extraPrefixes && extraPrefixes.length > 0
      ? IMMUTABLE_URL_ALLOWLIST.concat(extraPrefixes)
      : IMMUTABLE_URL_ALLOWLIST;
  if (
    typeof url !== "string" ||
    !allowlist.some((prefix) => url.startsWith(prefix))
  ) {
    throw new Error(`URL not allowed for immutable fetch: ${String(url)}`);
  }
  const expected = typeof integrity === "string" ? integrity : undefined;

  const cache = await openCache();
  if (cache) {
    const hit = await cache.match(url).catch(() => undefined);
    if (hit) {
      const body = await hit.clone().arrayBuffer();
      if (await matchesIntegrity(body, expected)) {
        return serializeResponse(hit);
      }
      // Stale/poisoned entry: drop it and fall through to a fresh fetch.
      await cache.delete(url).catch(() => undefined);
    }
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Immutable fetch failed with status ${res.status}: ${url}`);
  }
  const result = await serializeResponse(res);
  if (cache && (await matchesIntegrity(result.body, expected))) {
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

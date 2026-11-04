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
}

const IMMUTABLE_URL_ALLOWLIST: AllowedOrigin[] = [
  // The self-hosted module CDN is supplied through immutableUrlPrefixes.
  // unpkg files, requested by the bundler at registry-resolved exact versions.
  { origin: "https://unpkg.com", pathPrefix: "/" },
  // Self-hosted, versioned @immediately-run/sdk builds (SDK_PACKAGING_SPEC
  // §5/§11, Option A). The /v/<version>/ path encodes the exact version, so
  // responses are immutable; the bundler fetches these when an app opts the SDK
  // into immediately.run.resolveFromRegistry. Keep in sync with the prefix the
  // bundler registers via registerImmutableUrlPrefix (sandbox bundler.ts).
  {
    origin: "https://immediately-run.github.io",
    pathPrefix: "/immediately-run-sdk/v/",
  },
];

/**
 * Is a PARSED URL inside the allowlist? Origin is compared exactly (a userinfo
 * or lookalike host cannot match) and the path prefix against the URL parser's
 * NORMALIZED pathname; additionally, any dot segment — literal or
 * percent-encoded, in any hex case — is refused, so no spelling of `..` can
 * cross the prefix boundary after a server-side decode.
 */
const inPolicy = (u: URL, allowlist: AllowedOrigin[]): boolean => {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password)
    return false;
  const segments = u.pathname.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment).toLowerCase();
    } catch {
      return segment.toLowerCase();
    }
  });
  if (segments.some((s) => s === ".." || s === ".")) return false;
  if (/%2e/.test(u.pathname.toLowerCase())) return false;
  return allowlist.some(
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
    return [{ origin: url.origin, pathPrefix: url.pathname }];
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
  if (!inPolicy(parsed, allowlist)) {
    throw new Error(`URL not allowed for immutable fetch: ${url}`);
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
    !inPolicy(new URL(res.url), allowlist)
  ) {
    throw new Error(
      `Immutable fetch redirected outside the allowlist: ${res.url}`,
    );
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

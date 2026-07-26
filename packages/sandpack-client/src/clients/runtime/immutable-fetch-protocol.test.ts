/**
 * Integrity-aware parent-side immutable cache (cache-poisoning prevention).
 *
 * These pin down the property that broke prod: a cache entry whose bytes don't
 * match the host's current integrity pin must never be served or persisted —
 * it self-heals (evict + refetch) instead of failing the consumer forever.
 */
import { handleImmutableFetch } from "./immutable-fetch-protocol";

const ALLOWED =
  "https://immediately-run.github.io/immediately-run-sdk/v/0.8.0/runtime.js";

const sha384 = async (s: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-384",
    new TextEncoder().encode(s),
  );
  let bin = "";
  const view = new Uint8Array(digest);
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
  return `sha384-${btoa(bin)}`;
};

/** Minimal in-memory Cache + CacheStorage covering match/put/delete. */
class FakeCache {
  store = new Map<string, ArrayBuffer>();
  async match(url: string): Promise<Response | undefined> {
    const b = this.store.get(url);
    return b === undefined ? undefined : new Response(b.slice(0));
  }
  async put(url: string, res: Response): Promise<void> {
    this.store.set(url, await res.arrayBuffer());
  }
  async delete(url: string): Promise<boolean> {
    return this.store.delete(url);
  }
}

describe("handleImmutableFetch — integrity-aware caching", () => {
  let cache: FakeCache;
  let fetchBodies: string[];
  let fetchCalls: number;

  beforeEach(() => {
    cache = new FakeCache();
    fetchCalls = 0;
    fetchBodies = [];
    (globalThis as any).caches = { open: async () => cache };
    (globalThis as any).fetch = async () => {
      const body = fetchBodies[Math.min(fetchCalls, fetchBodies.length - 1)];
      fetchCalls++;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/javascript" },
      });
    };
  });

  const bodyOf = async (r: { body: ArrayBuffer }) =>
    new TextDecoder().decode(r.body);

  it("verify-before-cache: mismatched bytes are returned but NEVER cached", async () => {
    fetchBodies = ["BAD-BYTES"];
    const goodSri = await sha384("GOOD-BYTES");
    const res = await handleImmutableFetch(ALLOWED, goodSri);
    expect(await bodyOf(res)).toBe("BAD-BYTES"); // returned (caller fails closed)
    expect(cache.store.has(ALLOWED)).toBe(false); // but not persisted
  });

  it("caches + serves bytes that match the pin", async () => {
    fetchBodies = ["GOOD-BYTES"];
    const sri = await sha384("GOOD-BYTES");
    await handleImmutableFetch(ALLOWED, sri);
    expect(cache.store.has(ALLOWED)).toBe(true);
    // Second call is a verified cache hit — no extra network.
    const before = fetchCalls;
    const res2 = await handleImmutableFetch(ALLOWED, sri);
    expect(fetchCalls).toBe(before);
    expect(await bodyOf(res2)).toBe("GOOD-BYTES");
  });

  it("verify-on-read self-heal: a stale hit (pin changed) is evicted + refetched", async () => {
    // Seed the cache with OLD bytes (as if cached during a broken window).
    await cache.put(ALLOWED, new Response("OLD-BYTES"));
    // The origin now serves NEW bytes; the host pins NEW.
    fetchBodies = ["NEW-BYTES"];
    const newSri = await sha384("NEW-BYTES");
    const res = await handleImmutableFetch(ALLOWED, newSri);
    expect(await bodyOf(res)).toBe("NEW-BYTES"); // refetched, not the stale hit
    expect(fetchCalls).toBe(1); // hit was rejected → one network fetch
    expect(new TextDecoder().decode(cache.store.get(ALLOWED)!)).toBe(
      "NEW-BYTES",
    ); // re-cached verified
  });

  it("without an integrity arg, caches by URL (legacy behavior preserved)", async () => {
    fetchBodies = ["ANY"];
    await handleImmutableFetch(ALLOWED);
    expect(cache.store.has(ALLOWED)).toBe(true);
  });

  it("rejects URLs outside the allowlist", async () => {
    await expect(
      handleImmutableFetch("https://evil.example/x.js"),
    ).rejects.toThrow(/not allowed/i);
  });
});

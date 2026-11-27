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
  for (let i = 0; i < view.length; i++)
    bin += String.fromCharCode(view[i]);
  return `sha384-${btoa(bin)}`;
};

/**
 * Minimal in-memory Cache + CacheStorage covering match/put/delete. Like the
 * real one it gives an entry back with the content type it was stored with.
 */
class FakeCache {
  store = new Map<string, ArrayBuffer>();
  types = new Map<string, string>();
  async match(url: string): Promise<Response | undefined> {
    const b = this.store.get(url);
    if (b === undefined) return undefined;
    const type = this.types.get(url);
    return new Response(b.slice(0), {
      headers: type ? { "content-type": type } : {},
    });
  }
  async put(url: string, res: Response): Promise<void> {
    this.types.set(url, res.headers.get("content-type") ?? "");
    this.store.set(url, await res.arrayBuffer());
  }
  async delete(url: string): Promise<boolean> {
    this.types.delete(url);
    return this.store.delete(url);
  }
}

/** A `/package/` reply as sandpack-cdn labels it (router/custom_reply.rs). */
const cdnPayload = (body: string, type = "application/javascript") =>
  new Response(body, { status: 200, headers: { "content-type": type } });

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
      const body =
        fetchBodies[Math.min(fetchCalls, fetchBodies.length - 1)];
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

// ── R3-364 — policy on the PARSED URL + redirect end-state validation ────────

describe("handleImmutableFetch — allowlist matching (R3-364)", () => {
  beforeEach(() => {
    (globalThis as any).caches = undefined;
    let calls = 0;
    (globalThis as any).fetch = async () => {
      calls++;
      return new Response("OK-BYTES", {
        status: 200,
        headers: { "content-type": "text/javascript" },
      });
    };
    (globalThis as any).__fetchCalls = () => calls;
  });

  const refused = async (url: string) => {
    await expect(handleImmutableFetch(url)).rejects.toThrow(/not allowed/);
    expect((globalThis as any).__fetchCalls()).toBe(0); // pre-request, never fetched
  };

  it("the legitimate allowlist shapes still pass", async () => {
    for (const url of [
      "https://unpkg.com/@scope/pkg@1.2.3/dist/index.js",
      "https://immediately-run.github.io/immediately-run-sdk/v/0.8.0/runtime.js",
    ]) {
      const res = await handleImmutableFetch(url);
      expect(res.status).toBe(200);
    }
  });

  it("a raw /../ traversal past the /v/ prefix is refused pre-request", async () => {
    await refused(
      "https://immediately-run.github.io/immediately-run-sdk/v/../other/path.js",
    );
    // The URL parser normalizes /../ — the normalized path leaves the prefix. A
    // traversal that lands back INSIDE the prefix (…/v/../immediately-run-sdk/v/x)
    // normalizes to an in-policy path and is allowed — that is what "match the
    // normalized path" means; (unpkg's entry is origin-wide by design, so a
    // traversal there cannot leave policy at all).
  });

  it("percent-encoded dot segments are refused — every spelling, pre-request", async () => {
    // Node's WHATWG URL parser resolves the ENCODED spellings of `..` too, so
    // these normalize past the /v/ prefix and fail it; the explicit dot-segment
    // and %2e refusals in inPolicy are the belt-and-braces for parsers/servers
    // that decode differently than the check.
    await refused(
      "https://immediately-run.github.io/immediately-run-sdk/v/%2e%2e/secret.js",
    );
    await refused(
      "https://immediately-run.github.io/immediately-run-sdk/v/%2E%2E/secret.js",
    );
    await refused(
      "https://immediately-run.github.io/immediately-run-sdk/v/.%2e/secret.js",
    );
    await refused(
      "https://immediately-run.github.io/immediately-run-sdk/v/%2e./secret.js",
    );
    // A traversal out of the prefix on unpkg cannot leave POLICY (its entry is
    // origin-wide by design) — but a same-position traversal on the sdk host
    // must still refuse, which the cases above pin.
  });

  it("an allowlist prefix inside a DIFFERENT origin's path is refused", async () => {
    await refused("https://evil.example/https://unpkg.com/pkg@1.0.0/x.js");
    await refused("https://evil.example/probe?url=https://unpkg.com/");
  });

  it("userinfo tricks do not match the allowlist origin", async () => {
    await refused("https://unpkg.com@evil.example/pkg@1.0.0/x.js");
    await refused("https://user:pass@unpkg.com.evil.example/x.js");
  });

  it("a non-http(s) or malformed URL refuses", async () => {
    await refused("javascript:alert(1)");
    await refused("not a url");
    await refused("");
  });
});

describe("handleImmutableFetch — redirect end-state validation (R3-364)", () => {
  beforeEach(() => {
    const cache = new FakeCache();
    (globalThis as any).caches = { open: async () => cache };
    (globalThis as any).__cache = cache;
  });

  /** A response DOUBLE that reports where the browser's redirect-follow ended
   *  up — the fields handleImmutableFetch reads beyond the body. */
  const redirected = (finalUrl: string, body = "REDIRECTED-BYTES") =>
    ({
      ok: true,
      status: 200,
      redirected: true,
      url: finalUrl,
      headers: new Headers({ "content-type": "text/javascript" }),
      arrayBuffer: async () => new TextEncoder().encode(body),
    } as unknown as Response);

  it("a prefix-host 302 to an off-allowlist origin is REFUSED, not followed-then-used", async () => {
    (globalThis as any).fetch = async () =>
      redirected("https://evil.example/payload.js");
    await expect(
      handleImmutableFetch(
        "https://immediately-run.github.io/immediately-run-sdk/v/0.8.0/runtime.js",
      ),
    ).rejects.toThrow(/redirected outside the allowlist/);
    // And nothing from that exchange was cached under the allowlisted key.
    expect((globalThis as any).__cache.store.size).toBe(0);
  });

  it("a redirect that STAYS inside the allowlist is served", async () => {
    (globalThis as any).fetch = async () =>
      redirected(
        "https://immediately-run.github.io/immediately-run-sdk/v/0.8.0/runtime.js",
      );
    const res = await handleImmutableFetch(
      "https://immediately-run.github.io/immediately-run-sdk/v/0.8.0/runtime.js",
    );
    expect(new TextDecoder().decode(res.body)).toBe("REDIRECTED-BYTES");
    expect((globalThis as any).__cache.store.size).toBe(1); // verified bytes cached
  });
});

describe("self-hosted immutable fetch policy", () => {
  const prefix = "https://host.example/sandpack-cdn/package/";
  const url = `${prefix}7/react@19.1.0`;
  let cache: FakeCache;
  let network: jest.Mock;

  beforeEach(() => {
    cache = new FakeCache();
    (globalThis as any).caches = {
      open: jest.fn().mockResolvedValue(cache),
    };
    network = jest.fn().mockResolvedValue(cdnPayload("SELF-HOSTED"));
    globalThis.fetch = network;
  });

  it("uses the configured CDN and caches its exact-version response", async () => {
    expect(
      new TextDecoder().decode(
        (await handleImmutableFetch(url, undefined, [prefix])).body,
      ),
    ).toBe("SELF-HOSTED");
    await handleImmutableFetch(url, undefined, [prefix]);
    expect(network).toHaveBeenCalledTimes(1);
    expect(cache.store.has(url)).toBe(true);
    expect(caches.open).toHaveBeenCalledWith(
      "sandpack-immutable-fetch-v2",
    );
  });

  it.each([
    "https://host.example/sandpack-cdn/package/../private",
    "https://host.example/sandpack-cdn/package/%2E%2e/private",
    "https://host.example.evil/sandpack-cdn/package/pkg",
    "https://host.example@evil.example/sandpack-cdn/package/pkg",
    "https://user:pass@host.example/sandpack-cdn/package/pkg",
    "https://host.example/sandpack-cdn/dep_tree/pkg",
    "https://sandpack-cdn-staging.blazingly.io/package/pkg",
  ])(
    "refuses an out-of-policy URL before fetching: %s",
    async (request) => {
      await expect(
        handleImmutableFetch(request, undefined, [prefix]),
      ).rejects.toThrow(/not allowed/);
      expect(network).not.toHaveBeenCalled();
    },
  );

  it("allows a localhost HTTP CDN when explicitly configured", async () => {
    await expect(
      handleImmutableFetch(
        "http://localhost:44298/package/pkg",
        undefined,
        ["http://localhost:44298/package/"],
      ),
    ).resolves.toMatchObject({ status: 200 });
  });

  it.each([
    "https://host.example/admin",
    "https://evil.example/package/pkg",
  ])(
    "refuses a redirect outside the CDN policy: %s",
    async (destination) => {
      const response = new Response("WRONG");
      Object.defineProperties(response, {
        redirected: { value: true },
        url: { value: destination },
      });
      network.mockResolvedValue(response);
      await expect(
        handleImmutableFetch(url, undefined, [prefix]),
      ).rejects.toThrow(/redirected outside/);
      expect(cache.store.size).toBe(0);
    },
  );

  it("allows a redirect within the configured CDN", async () => {
    const response = cdnPayload("OK");
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: `${prefix}7/other@1.0.0` },
    });
    network.mockResolvedValue(response);
    await expect(
      handleImmutableFetch(url, undefined, [prefix]),
    ).resolves.toMatchObject({ status: 200 });
    expect(cache.store.has(url)).toBe(true);
  });

  it("does not let one client's prefixes authorize another client's cache reads", async () => {
    await handleImmutableFetch(url, undefined, [prefix]);
    await expect(handleImmutableFetch(url)).rejects.toThrow(/not allowed/);
  });
});

describe("handleImmutableFetch — only a plausible payload is kept", () => {
  const prefix = "https://host.example/sandpack-cdn/package/";
  const packageUrl = `${prefix}7/react@19.1.0`;
  const scriptUrl = "https://unpkg.com/pkg@1.2.3/dist/index.js";
  let cache: FakeCache;
  let network: jest.Mock;

  beforeEach(() => {
    cache = new FakeCache();
    (globalThis as any).caches = { open: async () => cache };
    network = jest.fn();
    globalThis.fetch = network;
  });

  const text = (r: { body: ArrayBuffer }) => new TextDecoder().decode(r.body);
  const page = (status = 200) =>
    new Response("<!doctype html><title>App</title>", {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  it("returns a page served in a package payload's place, but never caches it", async () => {
    network.mockImplementation(async () => page());
    const first = await handleImmutableFetch(packageUrl, undefined, [prefix]);
    expect(first.contentType).toBe("text/html; charset=utf-8");
    expect(cache.store.size).toBe(0);
    // Once the CDN answers again, the payload is fetched and kept.
    network.mockImplementation(async () => cdnPayload("PAYLOAD"));
    expect(text(await handleImmutableFetch(packageUrl, undefined, [prefix]))).toBe("PAYLOAD");
    expect(network).toHaveBeenCalledTimes(2);
    expect(cache.store.has(packageUrl)).toBe(true);
  });

  it.each([
    ["a JSON body", () => cdnPayload('{"message":"down"}', "application/json")],
    ["plain text", () => cdnPayload("upstream unavailable", "text/plain")],
    ["an empty body", () => cdnPayload("")],
    ["a partial response", () => new Response("PAY", { status: 206, headers: { "content-type": "application/javascript" } })],
  ])("does not cache %s for a package URL", async (_name, reply) => {
    network.mockImplementation(async () => reply());
    await handleImmutableFetch(packageUrl, undefined, [prefix]);
    expect(cache.store.size).toBe(0);
  });

  it.each([
    "application/javascript",
    "Application/JavaScript; charset=utf-8",
    "application/msgpack",
    "application/x-msgpack",
    "application/vnd.msgpack",
  ])("caches a package payload labelled %s", async (type) => {
    network.mockImplementation(async () => cdnPayload("PAYLOAD", type));
    await handleImmutableFetch(packageUrl, undefined, [prefix]);
    expect(cache.store.has(packageUrl)).toBe(true);
    await handleImmutableFetch(packageUrl, undefined, [prefix]);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("evicts a page cached before this check and fetches the payload again", async () => {
    await cache.put(packageUrl, page());
    network.mockImplementation(async () => cdnPayload("PAYLOAD"));
    expect(text(await handleImmutableFetch(packageUrl, undefined, [prefix]))).toBe("PAYLOAD");
    expect(network).toHaveBeenCalledTimes(1);
    expect(cache.types.get(packageUrl)).toBe("application/javascript");
  });

  it("does not cache a page served in a package file's place", async () => {
    network.mockImplementation(async () => page());
    await handleImmutableFetch(scriptUrl);
    expect(cache.store.size).toBe(0);
  });

  it("caches an HTML file a package really ships, and any other file type", async () => {
    const htmlUrl = "https://unpkg.com/pkg@1.2.3/dist/Template.HTML";
    network.mockImplementation(async () => page());
    await handleImmutableFetch(htmlUrl);
    expect(cache.store.has(htmlUrl)).toBe(true);
    for (const [url, type] of [
      [scriptUrl, "text/javascript; charset=utf-8"],
      ["https://unpkg.com/pkg@1.2.3/package.json", "application/json"],
      ["https://unpkg.com/pkg@1.2.3/LICENSE", "text/plain"],
      ["https://unpkg.com/pkg@1.2.3/dist/empty.css", "text/css"],
    ]) {
      network.mockImplementation(async () => cdnPayload(url.endsWith(".css") ? "" : "FILE", type));
      await handleImmutableFetch(url);
      expect(cache.store.has(url)).toBe(true);
    }
  });
});

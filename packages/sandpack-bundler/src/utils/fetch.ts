import { FetchError, FetchFailure } from '../errors/FetchError';
import { sleep } from './sleep';

interface RetryOptions {
  maxRetries?: number;
  /** Wait before the first retry; it doubles per attempt (capped) and is jittered. */
  retryDelay?: number;
  /** Bound for one attempt: connecting, the headers and the whole body. */
  attemptTimeoutMs?: number;
  /** Bound for the whole call: every attempt plus the waits between them. */
  totalTimeoutMs?: number;
  /** What is being fetched in the caller's terms (e.g. `react@19.1.0`), for errors and slow-request reports. */
  subject?: string;
  /**
   * Expected `sha384-<base64>` of the response body for an immutable URL. When
   * set, the immutable cache becomes integrity-aware (cache-poisoning
   * prevention): a cache hit whose bytes no longer match is evicted + refetched
   * (self-heal), and freshly fetched bytes are only stored when they match
   * (never persist unverified bytes). Distinct from the native `integrity`
   * RequestInit field on purpose — that makes the browser HARD-FAIL the fetch on
   * mismatch, but we want to return mismatched bytes so the caller's own
   * verification fails closed with a precise error, while just refusing to cache.
   */
  pinnedSri?: string;
}

export type RequestInitWithRetry = RequestInit & RetryOptions;

/**
 * Turns a fully read response body into what the caller asked for. A throw
 * means the body is not that (truncated, or a proxy's HTML): the attempt
 * counts as failed and the bytes are never cached.
 */
export type BodyDecoder<T> = (body: ArrayBuffer, contentType: string) => T | Promise<T>;

/** SHA-384 of bytes, `sha384-<base64>` (SRI style). */
const sha384 = async (body: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-384', body);
  let bin = '';
  const view = new Uint8Array(digest);
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
  return `sha384-${btoa(bin)}`;
};

/** Whether a body matches `sri` (true when no `sri` to check). A
 *  hashing failure (no crypto) counts as a non-match so we never serve/persist
 *  bytes we couldn't validate. */
const bodyMatchesSri = async (body: ArrayBuffer, sri: string | undefined): Promise<boolean> => {
  if (!sri) return true;
  try {
    return (await sha384(body)) === sri;
  } catch {
    return false;
  }
};

// 408 request timeout, 425 too early, 429 too many requests, and every 5xx:
// the package CDN reports transient upstream failures as 500/502. Any other
// 4xx is the service's final answer to this exact request.
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

// A request that will not answer must end by itself: nothing above this layer
// can tell a dead connection from a slow one.
const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000;
const MAX_RETRY_DELAY_MS = 8_000;

// Jittered so clients that failed together do not all come back together.
const backoffDelay = (base: number, attempt: number): number => {
  const ceiling = Math.min(MAX_RETRY_DELAY_MS, base * 2 ** attempt);
  return ceiling / 2 + (Math.random() * ceiling) / 2;
};

// URL prefixes whose responses are immutable — the URL encodes the exact
// content version (e.g. the module CDN's /package/<name@version> endpoints, or
// unpkg files at an exact version). Such responses are served cache-first from
// a persistent Cache API cache: a hit never touches the network, a miss
// populates the cache after a successful fetch. Callers register their own
// prefixes (see module-cdn.ts / RegistryFS.ts) to avoid an import cycle
// back into this module. Do NOT register endpoints that resolve floating
// versions (semver ranges, tags): caching those would pin the resolution.
const immutableUrlPrefixes: string[] = [];

export const registerImmutableUrlPrefix = (prefix: string): void => {
  immutableUrlPrefixes.push(prefix);
};

const IMMUTABLE_CACHE_NAME = 'immutable-url-cache-v1';

// CacheStorage can be unavailable or outright forbidden — in a sandboxed iframe
// without `allow-same-origin` (an opaque origin, i.e. this bundler in
// production) even *reading* `window.caches` throws. Cache failures must
// degrade to a plain network fetch, never break the request itself.
const openImmutableCache = async (): Promise<Cache | undefined> => {
  try {
    return await caches.open(IMMUTABLE_CACHE_NAME);
  } catch {
    return undefined;
  }
};

/**
 * The result of a parent-side immutable fetch (see `handleImmutableFetch` in
 * sandpack-client). The body is structured-cloned across the iframe boundary.
 */
export interface ParentImmutableFetchResult {
  status: number;
  contentType: string;
  body: ArrayBuffer;
}

type ParentImmutableFetch = (url: string, integrity?: string) => Promise<ParentImmutableFetchResult>;

// In the production iframe (opaque origin) there is no local CacheStorage at
// all, so immutable fetches are forwarded to the parent window, which serves
// them from its own persistent cache. Registered by SandpackInstance (which
// owns the message bus) to avoid an import cycle into the protocol layer.
let parentImmutableFetch: ParentImmutableFetch | undefined;

// Whether the parent implements the bridge: undefined until it has answered
// anything (true) or stayed silent through the probe (false). A parent that
// predates the protocol never replies at all, so a reply of any kind, however
// late, settles it as true — a slow reply says nothing about support.
let parentAnswers: boolean | undefined;
let parentProbe: Promise<boolean> | undefined;

export const registerParentImmutableFetch = (fn: ParentImmutableFetch): void => {
  parentImmutableFetch = fn;
  parentAnswers = undefined;
  parentProbe = undefined;
};

// Never fetchable, so a parent that implements the protocol refuses it at once
// without touching the network; one that predates it stays silent.
const PARENT_PROBE_URL = 'about:blank';
const PARENT_PROBE_TIMEOUT_MS = 3000;

const askParent = (fn: ParentImmutableFetch, url: string, integrity?: string): Promise<ParentImmutableFetchResult> => {
  try {
    return fn(url, integrity);
  } catch (err) {
    return Promise.reject(err);
  }
};

/** Asked once per registration, alongside the first bridged request. */
const probeParent = (fn: ParentImmutableFetch): Promise<boolean> => {
  parentProbe ??= new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      if (fn === parentImmutableFetch && parentAnswers === undefined) parentAnswers = false;
      resolve(parentAnswers === true);
    }, PARENT_PROBE_TIMEOUT_MS);
    const answered = () => {
      clearTimeout(timer);
      if (fn === parentImmutableFetch) parentAnswers = true;
      resolve(true);
    };
    askParent(fn, PARENT_PROBE_URL).then(answered, answered);
  });
  return parentProbe;
};

interface Payload {
  body: ArrayBuffer;
  contentType: string;
}

interface Problem {
  failure: FetchFailure;
  status: number;
  statusText: string;
  text: string;
  timeoutMs?: number;
  cause?: unknown;
}

type Attempt<T> = { ok: true; value: T; payload: Payload } | { ok: false; problem: Problem };

const decodePayload = async <T>(payload: Payload, decode: BodyDecoder<T>): Promise<Attempt<T>> => {
  try {
    return { ok: true, value: await decode(payload.body, payload.contentType), payload };
  } catch (cause) {
    return { ok: false, problem: { failure: 'body', status: 200, statusText: '', text: '', cause } };
  }
};

/**
 * One request through the parent's persistent cache. Resolves undefined when
 * this request has to go direct instead: the parent does not implement the
 * bridge, refused or failed, took longer than `timeoutMs`, or sent a body the
 * caller cannot use. None of those says anything about the next request.
 */
const fetchViaParent = <T>(
  url: string,
  integrity: string | undefined,
  timeoutMs: number,
  decode: BodyDecoder<T>,
): Promise<{ value: T } | undefined> => {
  const fn = parentImmutableFetch;
  if (!fn || parentAnswers === false) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    let waiting = true;
    const settle = (result?: Attempt<T>) => {
      waiting = false;
      clearTimeout(timer);
      resolve(result?.ok ? result : undefined);
    };
    const timer = setTimeout(() => settle(), timeoutMs);
    const replied = () => {
      if (fn === parentImmutableFetch) parentAnswers = true;
    };
    if (parentAnswers === undefined) {
      void probeParent(fn).then((supported) => {
        if (!supported) settle();
      });
    }
    askParent(fn, url, integrity).then(
      (result) => {
        replied();
        // Too late for this request: it went direct, so do not decode for nothing.
        if (!waiting) return undefined;
        const usable = result != null && result.status >= 200 && result.status <= 299 && result.body != null;
        if (!usable) return settle();
        return decodePayload({ body: result.body, contentType: result.contentType ?? '' }, decode).then(settle);
      },
      () => {
        // Refused (URL outside its allowlist) or its own fetch failed.
        replied();
        settle();
      },
    );
  });
};

/** One direct attempt: fetch → read the whole body → decode, under one timer. */
const fetchOnce = async <T>(
  input: RequestInfo,
  requestInit: RequestInit,
  timeoutMs: number,
  decode: BodyDecoder<T>,
): Promise<Attempt<T>> => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const outer = requestInit.signal ?? undefined;
  const forwardAbort = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener('abort', forwardAbort, { once: true });
  let payload: Payload;
  try {
    const res = await window.fetch(input, { ...requestInit, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, problem: { failure: 'http', status: res.status, statusText: res.statusText, text } };
    }
    payload = { body: await res.arrayBuffer(), contentType: res.headers.get('content-type') ?? '' };
  } catch (cause) {
    // The caller cancelled: not a failure of the request, so neither retried nor relabelled.
    if (outer?.aborted) throw cause;
    const failure = timedOut ? 'timeout' : 'network';
    return { ok: false, problem: { failure, status: 0, statusText: '', text: '', timeoutMs, cause } };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', forwardAbort);
  }
  return decodePayload(payload, decode);
};

/** A request someone has been waiting on for at least a reporting interval. */
export interface SlowRequest {
  url: string;
  subject?: string;
  elapsedMs: number;
}

export type SlowRequestListener = (waiting: SlowRequest[]) => void;

interface InFlightRequest {
  url: string;
  subject?: string;
  startedAt: number;
}

interface SlowRequestWatcher {
  listener: SlowRequestListener;
  intervalMs: number;
  timer?: ReturnType<typeof setTimeout>;
}

const inFlight = new Set<InFlightRequest>();
const slowRequestWatchers = new Set<SlowRequestWatcher>();

const armWatcher = (watcher: SlowRequestWatcher): void => {
  if (watcher.timer !== undefined || inFlight.size === 0) return;
  // The Set iterates in insertion order, so the first entry is the oldest.
  const [oldest] = inFlight;
  const untilSlow = oldest.startedAt + watcher.intervalMs - Date.now();
  watcher.timer = setTimeout(
    () => {
      watcher.timer = undefined;
      const now = Date.now();
      const waiting: SlowRequest[] = [];
      for (const { url, subject, startedAt } of inFlight) {
        if (now - startedAt >= watcher.intervalMs) waiting.push({ url, subject, elapsedMs: now - startedAt });
      }
      if (waiting.length > 0) {
        try {
          watcher.listener(waiting);
        } catch {
          // A reporting failure must not disturb the requests it reports on.
        }
      }
      armWatcher(watcher);
    },
    untilSlow > 0 ? untilSlow : watcher.intervalMs,
  );
};

const disarmWatcher = (watcher: SlowRequestWatcher): void => {
  clearTimeout(watcher.timer);
  watcher.timer = undefined;
};

const trackRequest = (url: string, subject: string | undefined): (() => void) => {
  const request: InFlightRequest = { url, subject, startedAt: Date.now() };
  inFlight.add(request);
  for (const watcher of slowRequestWatchers) armWatcher(watcher);
  return () => {
    inFlight.delete(request);
    if (inFlight.size === 0) {
      for (const watcher of slowRequestWatchers) disarmWatcher(watcher);
    }
  };
};

/**
 * Calls `listener` every `intervalMs` for as long as some request (retries and
 * the waits between them included) has been in flight at least that long,
 * with the requests being waited on. Its only timer runs while a request is in
 * flight, so requests that finish sooner are never reported. Returns the
 * unsubscribe.
 */
export const onSlowRequests = (listener: SlowRequestListener, intervalMs = 3000): (() => void) => {
  const watcher: SlowRequestWatcher = { listener, intervalMs };
  slowRequestWatchers.add(watcher);
  armWatcher(watcher);
  return () => {
    slowRequestWatchers.delete(watcher);
    disarmWatcher(watcher);
  };
};

/**
 * Fetches `input` and decodes its body as one unit: fetch → read the whole
 * body → `decode`. A failure anywhere in the unit — no connection, a reset
 * mid-body, a timeout, 408/425/429/5xx, a body that does not decode — is
 * retried with backoff; any other 4xx is final. Immutable URLs are served
 * cache-first, and only a body that decoded is ever stored.
 */
export async function fetchDecoded<T>(
  input: RequestInfo,
  init: RequestInitWithRetry,
  decode: BodyDecoder<T>,
): Promise<T> {
  const {
    maxRetries = 0,
    retryDelay = 500,
    attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
    totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
    subject,
    pinnedSri,
    ...requestInit
  } = init;
  const url = typeof input === 'string' ? input : input.url;
  const immutable = typeof input === 'string' && immutableUrlPrefixes.some((prefix) => input.startsWith(prefix));
  const cache = immutable ? await openImmutableCache() : undefined;
  if (cache) {
    const hit = await cache.match(url).catch(() => undefined);
    if (hit) {
      // verify-on-read: serve a hit only if it still matches the pin and still
      // decodes; anything else is evicted + refetched (self-heal).
      const body = await hit.arrayBuffer().catch(() => undefined);
      if (body && (await bodyMatchesSri(body, pinnedSri))) {
        const cached = await decodePayload({ body, contentType: hit.headers.get('content-type') ?? '' }, decode);
        if (cached.ok) return cached.value;
      }
      await cache.delete(url).catch(() => {});
    }
  }

  const finished = trackRequest(url, subject);
  try {
    const deadline = Date.now() + totalTimeoutMs;
    if (immutable && !cache) {
      // No local CacheStorage (opaque origin): use the parent's persistent
      // cache over the message bus, falling back to a direct fetch.
      const bridged = await fetchViaParent(url, pinnedSri, Math.min(attemptTimeoutMs, totalTimeoutMs), decode);
      if (bridged) return bridged.value;
    }
    for (let attempt = 0; ; attempt++) {
      const budget = Math.min(attemptTimeoutMs, deadline - Date.now());
      const result: Attempt<T> =
        budget > 0
          ? await fetchOnce(input, requestInit, budget, decode)
          : {
              ok: false,
              problem: { failure: 'timeout', status: 0, statusText: '', text: '', timeoutMs: totalTimeoutMs },
            };
      if (result.ok) {
        // verify-before-cache: only persist bytes that decoded and match the
        // pin, so a bad upstream window can't poison the cache. Mismatching
        // bytes are still returned — the caller's own integrity check fails
        // closed precisely. A failed put (e.g. quota) only costs the entry.
        if (cache && (await bodyMatchesSri(result.payload.body, pinnedSri))) {
          const { body, contentType } = result.payload;
          await cache
            .put(url, new Response(body, contentType ? { headers: { 'content-type': contentType } } : {}))
            .catch(() => {});
        }
        return result.value;
      }

      const { problem } = result;
      const retryable = problem.failure !== 'http' || isRetryableStatus(problem.status);
      const delay = backoffDelay(retryDelay, attempt);
      if (!retryable || attempt >= maxRetries || Date.now() + delay >= deadline) {
        throw new FetchError({ status: problem.status, statusText: problem.statusText, url }, problem.text, {
          failure: problem.failure,
          subject,
          attempts: attempt + 1,
          timeoutMs: problem.timeoutMs,
          cause: problem.cause,
        });
      }
      await sleep(delay);
    }
  } finally {
    finished();
  }
}

/**
 * `fetchDecoded` for callers that want a Response. The body is already read
 * (inside the retried unit), so reading it again cannot fail on the network.
 *
 * @param {RequestInfo} input: request info for fetch
 * @param {RequestInit} init: request options for fetch, plus the retry options
 * @returns {Response}
 */
export function retryFetch(input: RequestInfo, init: RequestInitWithRetry = {}): Promise<Response> {
  return fetchDecoded(
    input,
    init,
    (body, contentType) => new Response(body, contentType ? { headers: { 'content-type': contentType } } : {}),
  );
}

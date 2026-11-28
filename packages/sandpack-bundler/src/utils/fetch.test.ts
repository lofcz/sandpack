import type { Mock } from '@rstest/core';
import type { FetchError as FetchErrorClass } from '../errors/FetchError';
import type * as FetchModule from './fetch';

// Backoff waits are asserted on, not waited out.
rs.mock('./sleep', () => ({ sleep: rs.fn(() => Promise.resolve()) }));

type Body = string | Uint8Array | ArrayBuffer | FakeBlob;

class FakeBlob {
  constructor(readonly parts: ArrayBuffer[], readonly options: { type?: string } = {}) {}
}

const bytesOf = (body: Body): Uint8Array => {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof FakeBlob) return new Uint8Array(body.parts[0]);
  return ArrayBuffer.isView(body) ? (body as Uint8Array) : new Uint8Array(body);
};

/** The parts of a Response the fetch layer and its callers read. */
class FakeResponse {
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly url = '';
  readonly headers: { get(name: string): string | null };
  private readonly bytes: Uint8Array;

  constructor(body: Body = '', init: { status?: number; statusText?: string; headers?: Record<string, string> } = {}) {
    this.bytes = bytesOf(body);
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? '';
    this.ok = this.status >= 200 && this.status <= 299;
    const contentType = init.headers?.['content-type'] ?? (body instanceof FakeBlob ? body.options.type : undefined);
    this.headers = { get: (name) => (name.toLowerCase() === 'content-type' ? contentType ?? null : null) };
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.slice().buffer;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this.bytes);
  }

  clone(): FakeResponse {
    return this;
  }
}

const network = rs.fn();
let api: typeof FetchModule;
let FetchError: typeof FetchErrorClass;
let sleep: Mock;

beforeEach(() => {
  // fetch.ts keeps its prefixes, bridge state and in-flight set at module level.
  rs.resetModules();
  network.mockReset();
  Object.assign(globalThis, { window: { fetch: network }, Response: FakeResponse, Blob: FakeBlob, caches: undefined });
  api = require('./fetch');
  FetchError = require('../errors/FetchError').FetchError;
  sleep = require('./sleep').sleep;
});

afterEach(() => {
  rs.useRealTimers();
  rs.restoreAllMocks();
});

const URL_A = 'https://service.example/dep_tree';
const text = (body: ArrayBuffer): string => new TextDecoder().decode(body);
const flush = async (): Promise<void> => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
const failure = async (promise: Promise<unknown>): Promise<FetchErrorClass> => {
  const error = await promise.then(
    () => undefined,
    (err) => err,
  );
  expect(error).toBeInstanceOf(FetchError);
  return error;
};
/** A request that never answers: it ends only when its signal aborts. */
const hang = (_input: unknown, init: RequestInit): Promise<never> =>
  new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () =>
      reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })),
    );
  });

describe('retry policy', () => {
  it.each([400, 401, 403, 404, 405, 422])('does not retry deterministic HTTP %s failures', async (status) => {
    network.mockResolvedValue({ ok: false, status, statusText: 'Failure', url: URL_A, text: async () => 'detail' });
    await expect(api.retryFetch(URL_A, { maxRetries: 5, retryDelay: 0 })).rejects.toBeInstanceOf(FetchError);
    expect(network).toHaveBeenCalledTimes(1);
  });

  it.each([410, 424, 444, 451, 499])(
    'does not retry HTTP %s either: only 408, 425 and 429 are transient 4xx',
    async (status) => {
      network.mockResolvedValue(new FakeResponse('', { status }));
      await failure(api.retryFetch(URL_A, { maxRetries: 5, retryDelay: 0 }));
      expect(network).toHaveBeenCalledTimes(1);
    },
  );

  it.each([408, 425, 429, 500, 502, 503, 504])('retries a transient HTTP %s', async (status) => {
    network.mockResolvedValueOnce(new FakeResponse('', { status })).mockResolvedValueOnce(new FakeResponse('fine'));
    const response = await api.retryFetch(URL_A, { maxRetries: 2, retryDelay: 0 });
    expect(await response.text()).toBe('fine');
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('retries when no connection could be made', async () => {
    network.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new FakeResponse('fine'));
    expect(await (await api.retryFetch(URL_A, { maxRetries: 1, retryDelay: 0 })).text()).toBe('fine');
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('gives up on an attempt that does not answer in time and tries again', async () => {
    network.mockImplementationOnce(hang).mockResolvedValueOnce(new FakeResponse('fine'));
    const response = await api.retryFetch(URL_A, { maxRetries: 1, retryDelay: 0, attemptTimeoutMs: 20 });
    expect(await response.text()).toBe('fine');
    expect(network.mock.calls[0][1].signal.aborted).toBe(true);
    expect(network.mock.calls[1][1].signal.aborted).toBe(false);
  });

  it('bounds a body that stops arriving, not only the headers', async () => {
    const stalled = (_input: unknown, init: RequestInit) =>
      Promise.resolve(Object.assign(new FakeResponse(), { arrayBuffer: () => hang(_input, init) }));
    network.mockImplementationOnce(stalled).mockResolvedValueOnce(new FakeResponse('fine'));
    const response = await api.retryFetch(URL_A, { maxRetries: 1, retryDelay: 0, attemptTimeoutMs: 20 });
    expect(await response.text()).toBe('fine');
  });

  it('fails with a timeout that names the URL when no attempt answers', async () => {
    network.mockImplementation(hang);
    const error = await failure(api.retryFetch(URL_A, { maxRetries: 1, retryDelay: 0, attemptTimeoutMs: 20 }));
    expect(error.failure).toBe('timeout');
    expect(error.message).toBe('Request timed out after 20 ms for ' + URL_A + ' (after 2 attempts)');
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('waits exponentially longer between attempts, jittered and capped', async () => {
    network.mockImplementation(async () => new FakeResponse('', { status: 503 }));
    const random = rs.spyOn(Math, 'random').mockReturnValue(0);
    await failure(api.retryFetch(URL_A, { maxRetries: 5, retryDelay: 1000 }));
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000, 4000, 4000]);

    sleep.mockClear();
    random.mockReturnValue(0.5);
    await failure(api.retryFetch(URL_A, { maxRetries: 5, retryDelay: 1000 }));
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([750, 1500, 3000, 6000, 6000]);
    expect(network).toHaveBeenCalledTimes(12);
  });

  it('stops at the total bound even with retries left', async () => {
    network.mockImplementation(async () => new FakeResponse('', { status: 503 }));
    rs.spyOn(Math, 'random').mockReturnValue(0);
    // Waits of 500 and 1000 fit into 2000 ms; the third (2000) would not.
    const error = await failure(api.retryFetch(URL_A, { maxRetries: 5, retryDelay: 1000, totalTimeoutMs: 2000 }));
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
    expect(error.attempts).toBe(3);
    expect(error.status).toBe(503);
  });

  it('leaves a request its caller cancelled alone', async () => {
    const caller = new AbortController();
    network.mockImplementation(hang);
    const pending = api.retryFetch(URL_A, { maxRetries: 5, retryDelay: 0, signal: caller.signal });
    await flush();
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(network).toHaveBeenCalledTimes(1);
  });
});

describe('fetch → read → decode as one unit', () => {
  it('retries when the connection drops while the body is read', async () => {
    const dropped = Object.assign(new FakeResponse(), {
      arrayBuffer: () => Promise.reject(new TypeError('network error')),
    });
    network.mockResolvedValueOnce(dropped).mockResolvedValueOnce(new FakeResponse('whole'));
    const response = await api.retryFetch(URL_A, { maxRetries: 1, retryDelay: 0 });
    expect(await response.text()).toBe('whole');
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('retries a body that does not decode', async () => {
    network.mockResolvedValueOnce(new FakeResponse('{"cut')).mockResolvedValueOnce(new FakeResponse('{"whole":true}'));
    const value = await api.fetchDecoded(URL_A, { maxRetries: 1, retryDelay: 0 }, (body) => JSON.parse(text(body)));
    expect(value).toEqual({ whole: true });
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('says which body could not be decoded once the retries are spent', async () => {
    network.mockImplementation(async () => new FakeResponse('<!doctype html>'));
    const decode = (): never => {
      throw new RangeError('Extra 14 of 15 byte(s) found at buffer[1]');
    };
    const error = await failure(
      api.fetchDecoded(URL_A, { maxRetries: 2, retryDelay: 0, subject: 'react@19.1.0' }, decode),
    );
    expect(error.failure).toBe('body');
    expect(error.message).toBe(
      'Unreadable response body for react@19.1.0 (' +
        URL_A +
        '): Extra 14 of 15 byte(s) found at buffer[1] (after 3 attempts)',
    );
    expect(network).toHaveBeenCalledTimes(3);
  });
});

describe('errors', () => {
  it('carry the URL, the subject and the service’s own message', async () => {
    const body = JSON.stringify({
      status: 404,
      message: 'Package version not found react@99.0.0',
      details: 'PackageVersionNotFound',
    });
    network.mockResolvedValue(new FakeResponse(body, { status: 404 }));
    const error = await failure(api.retryFetch(URL_A, { maxRetries: 5, retryDelay: 0, subject: 'react@99.0.0' }));
    expect(error.message).toBe(
      'Fetch failed with status 404 for react@99.0.0 (' + URL_A + '): Package version not found react@99.0.0',
    );
    expect(error).toMatchObject({
      status: 404,
      url: URL_A,
      text: body,
      subject: 'react@99.0.0',
      failure: 'http',
      attempts: 1,
    });
    expect(error.serviceMessage).toBe('Package version not found react@99.0.0');
  });

  it('never surface a bare "Failed to fetch"', async () => {
    const cause = new TypeError('Failed to fetch');
    network.mockRejectedValue(cause);
    const error = await failure(api.retryFetch(URL_A, { maxRetries: 2, retryDelay: 0, subject: 'react@19.1.0' }));
    expect(error.message).toBe(
      'Network request failed for react@19.1.0 (' + URL_A + '): Failed to fetch (after 3 attempts)',
    );
    expect(error).toMatchObject({ failure: 'network', status: 0, url: URL_A, cause });
  });
});

describe('immutable cache', () => {
  const PREFIX = 'https://cdn.example/package/';
  let entries: Map<string, FakeResponse>;
  let cache: { match: Mock; put: Mock; delete: Mock };

  beforeEach(() => {
    entries = new Map();
    cache = {
      match: rs.fn(async (url: string) => entries.get(url)),
      put: rs.fn(async (url: string, response: FakeResponse) => void entries.set(url, response)),
      delete: rs.fn(async (url: string) => entries.delete(url)),
    };
    Object.assign(globalThis, { caches: { open: async () => cache } });
    api.registerImmutableUrlPrefix(PREFIX);
  });

  const json = (body: ArrayBuffer): unknown => JSON.parse(text(body));

  it('stores a body that decoded and serves it without the network afterwards', async () => {
    network.mockResolvedValue(new FakeResponse('{"f":{}}', { headers: { 'content-type': 'application/json' } }));
    expect(await api.fetchDecoded(PREFIX + 'a', {}, json)).toEqual({ f: {} });
    expect(await api.fetchDecoded(PREFIX + 'a', {}, json)).toEqual({ f: {} });
    expect(network).toHaveBeenCalledTimes(1);
    expect(entries.get(PREFIX + 'a')!.headers.get('content-type')).toBe('application/json');
  });

  it('does not store a 200 body that is not what was asked for', async () => {
    network.mockImplementation(async () => new FakeResponse('<!doctype html><title>Maintenance</title>'));
    const error = await failure(api.fetchDecoded(PREFIX + 'a', { maxRetries: 1, retryDelay: 0 }, json));
    expect(error.failure).toBe('body');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('drops a stored body that does not decode and fetches it again', async () => {
    entries.set(PREFIX + 'a', new FakeResponse('<!doctype html><title>Maintenance</title>'));
    network.mockResolvedValue(new FakeResponse('{"f":{}}'));
    expect(await api.fetchDecoded(PREFIX + 'a', {}, json)).toEqual({ f: {} });
    expect(cache.delete).toHaveBeenCalledWith(PREFIX + 'a');
    expect(await entries.get(PREFIX + 'a')!.text()).toBe('{"f":{}}');
  });

  it('does not store error replies', async () => {
    network.mockImplementation(async () => new FakeResponse('{"message":"upstream"}', { status: 502 }));
    await failure(api.fetchDecoded(PREFIX + 'a', { maxRetries: 1, retryDelay: 0 }, json));
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('still returns bytes that miss their pin, without storing them', async () => {
    network.mockImplementation(async () => new FakeResponse('tampered'));
    const response = await api.retryFetch(PREFIX + 'a', { pinnedSri: 'sha384-somethingelse' });
    expect(await response.text()).toBe('tampered');
    expect(cache.put).not.toHaveBeenCalled();
  });
});

describe('parent bridge', () => {
  const PREFIX = 'https://cdn.example/package/';
  let parent: Mock;

  const bridged = (body: string, status = 200) => ({
    status,
    contentType: 'text/plain',
    body: bytesOf(body).slice().buffer,
  });
  const never = (): Promise<never> => new Promise(() => {});
  // What a parent that implements the protocol does with a URL outside its allowlist.
  const refuse = (url: string) => Promise.reject(new Error('URL not allowed for immutable fetch: ' + url));
  /** A parent implementing the protocol: answers each allowlisted URL with what `replies` holds for it. */
  const parentServing = (replies: Record<string, () => Promise<unknown>>) =>
    parent.mockImplementation((url: string) => (replies[url] ?? (() => refuse(url)))());
  const readDirect = async (url: string, init: FetchModule.RequestInitWithRetry = {}): Promise<string> =>
    (await api.retryFetch(url, init)).text();

  beforeEach(() => {
    rs.useFakeTimers();
    api.registerImmutableUrlPrefix(PREFIX);
    parent = rs.fn();
    api.registerParentImmutableFetch(parent);
    network.mockImplementation(async (url: string) => new FakeResponse('direct ' + url.slice(PREFIX.length)));
  });

  it('keeps the bridge after a reply slower than any support check', async () => {
    let resolveSlow!: (value: unknown) => void;
    parentServing({
      [PREFIX + 'a']: () => new Promise((resolve) => (resolveSlow = resolve)),
      [PREFIX + 'b']: async () => bridged('cached b'),
    });
    const a = readDirect(PREFIX + 'a');
    await flush();
    rs.advanceTimersByTime(10_000);
    await flush();
    resolveSlow(bridged('cached a'));
    expect(await a).toBe('cached a');
    expect(await readDirect(PREFIX + 'b')).toBe('cached b');
    expect(network).not.toHaveBeenCalled();
  });

  it('sends only the request that outlasted its bound direct', async () => {
    parentServing({ [PREFIX + 'a']: never, [PREFIX + 'b']: async () => bridged('cached b') });
    const a = readDirect(PREFIX + 'a', { attemptTimeoutMs: 5000 });
    await flush();
    rs.advanceTimersByTime(5000);
    await flush();
    expect(await a).toBe('direct a');
    expect(await readDirect(PREFIX + 'b')).toBe('cached b');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('sends only the request the parent failed direct', async () => {
    parentServing({
      [PREFIX + 'a']: () => Promise.reject(new Error('Immutable fetch failed with status 503')),
      [PREFIX + 'b']: async () => bridged('cached b'),
    });
    expect(await readDirect(PREFIX + 'a')).toBe('direct a');
    expect(await readDirect(PREFIX + 'b')).toBe('cached b');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('does not pass a bridged error status off as the response', async () => {
    parentServing({ [PREFIX + 'a']: async () => bridged('upstream is down', 502) });
    expect(await readDirect(PREFIX + 'a')).toBe('direct a');
  });

  it('fetches directly when the bridged body is not what was asked for', async () => {
    parentServing({ [PREFIX + 'a']: async () => bridged('<!doctype html>') });
    network.mockImplementation(async () => new FakeResponse('{"f":{}}'));
    expect(await api.fetchDecoded(PREFIX + 'a', {}, (body) => JSON.parse(text(body)))).toEqual({ f: {} });
  });

  it('gives up on a parent that answers nothing, once, and stops asking it', async () => {
    parent.mockImplementation(never);
    const first = [readDirect(PREFIX + 'a'), readDirect(PREFIX + 'b')];
    await flush();
    expect(network).not.toHaveBeenCalled();
    rs.advanceTimersByTime(3000);
    expect(await Promise.all(first)).toEqual(['direct a', 'direct b']);

    parent.mockClear();
    expect(await readDirect(PREFIX + 'c')).toBe('direct c');
    expect(parent).not.toHaveBeenCalled();
  });

  it('takes a late answer as proof that the parent implements the bridge after all', async () => {
    let resolveLate!: (value: unknown) => void;
    parent.mockImplementation((url: string) =>
      url === PREFIX + 'a' ? new Promise((resolve) => (resolveLate = resolve)) : never(),
    );
    const a = readDirect(PREFIX + 'a');
    await flush();
    rs.advanceTimersByTime(3000);
    expect(await a).toBe('direct a');

    resolveLate(bridged('cached a'));
    await flush();
    parentServing({ [PREFIX + 'c']: async () => bridged('cached c') });
    expect(await readDirect(PREFIX + 'c')).toBe('cached c');
    expect(network).toHaveBeenCalledTimes(1);
  });
});

describe('onSlowRequests', () => {
  const pendingReplies: Array<(response: FakeResponse) => void> = [];
  const listener = rs.fn();

  beforeEach(() => {
    rs.useFakeTimers();
    pendingReplies.length = 0;
    listener.mockReset();
    network.mockImplementation(() => new Promise((resolve) => pendingReplies.push(resolve)));
  });

  it('reports what is still being waited on every interval, and stops when nothing is', async () => {
    api.onSlowRequests(listener, 3000);
    expect(rs.getTimerCount()).toBe(0);

    const a = api.retryFetch('https://cdn.example/a', { subject: 'pkg-a@1.0.0' });
    rs.advanceTimersByTime(2999);
    expect(listener).not.toHaveBeenCalled();
    rs.advanceTimersByTime(1);
    expect(listener.mock.calls).toEqual([
      [[{ url: 'https://cdn.example/a', subject: 'pkg-a@1.0.0', elapsedMs: 3000 }]],
    ]);

    rs.advanceTimersByTime(1000);
    const b = api.retryFetch('https://cdn.example/b');
    rs.advanceTimersByTime(2000);
    // b has been in flight for 2 s only.
    expect(listener.mock.calls[1]).toEqual([
      [{ url: 'https://cdn.example/a', subject: 'pkg-a@1.0.0', elapsedMs: 6000 }],
    ]);
    rs.advanceTimersByTime(3000);
    expect(
      listener.mock.calls[2][0].map((request: FetchModule.SlowRequest) => [request.url, request.elapsedMs]),
    ).toEqual([
      ['https://cdn.example/a', 9000],
      ['https://cdn.example/b', 5000],
    ]);

    pendingReplies[0](new FakeResponse('a'));
    await a;
    rs.advanceTimersByTime(3000);
    expect(listener.mock.calls[3][0].map((request: FetchModule.SlowRequest) => request.url)).toEqual([
      'https://cdn.example/b',
    ]);

    pendingReplies[1](new FakeResponse('b'));
    await b;
    expect(rs.getTimerCount()).toBe(0);
    rs.advanceTimersByTime(60_000);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('never fires, and leaves no timer behind, for requests that finish sooner', async () => {
    api.onSlowRequests(listener, 3000);
    for (let i = 0; i < 3; i++) {
      const request = api.retryFetch('https://cdn.example/quick');
      rs.advanceTimersByTime(2000);
      pendingReplies[i](new FakeResponse('quick'));
      await request;
      expect(rs.getTimerCount()).toBe(0);
    }
    rs.advanceTimersByTime(60_000);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps reporting a request through its retries', async () => {
    api.onSlowRequests(listener, 3000);
    network.mockReset();
    network.mockImplementation(hang);
    const request = api
      .retryFetch('https://cdn.example/a', { maxRetries: 1, retryDelay: 0, attemptTimeoutMs: 2000 })
      .catch(() => undefined);
    rs.advanceTimersByTime(2000);
    await flush();
    expect(network).toHaveBeenCalledTimes(2);
    rs.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledWith([{ url: 'https://cdn.example/a', subject: undefined, elapsedMs: 3000 }]);
    rs.advanceTimersByTime(1000);
    await request;
    expect(rs.getTimerCount()).toBe(0);
  });

  it('stops reporting to a listener that unsubscribed', async () => {
    const unsubscribe = api.onSlowRequests(listener, 3000);
    const request = api.retryFetch('https://cdn.example/a');
    rs.advanceTimersByTime(3000);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    rs.advanceTimersByTime(9000);
    expect(listener).toHaveBeenCalledTimes(1);
    pendingReplies[0](new FakeResponse('a'));
    await request;
  });
});

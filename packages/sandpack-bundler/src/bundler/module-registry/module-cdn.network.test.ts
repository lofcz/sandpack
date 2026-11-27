import { encode } from '@msgpack/msgpack';

import { FetchError } from '../../errors/FetchError';
import { fetchManifest, fetchModuleEntries, setCdnRoot } from './module-cdn';

// Backoff waits are not what these tests are about.
jest.mock('../../utils/sleep', () => ({ sleep: () => Promise.resolve() }));

const ROOT = 'https://preview.example/sandpack-cdn/';
const network = jest.fn();

/** The parts of a Response the fetch layer reads. */
const reply = (body: Uint8Array | string, status = 200) => {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    ok: status >= 200 && status <= 299,
    status,
    statusText: '',
    headers: { get: () => null },
    arrayBuffer: async () => bytes.slice().buffer,
    text: async () => new TextDecoder().decode(bytes),
  };
};

const part = encode({ f: { 'index.js': { c: 'module.exports = 1', d: [], t: true } }, m: [] });
const page = '<!doctype html><html><body>Maintenance</body></html>';

const failure = async (promise: Promise<unknown>): Promise<FetchError> => {
  const error = await promise.then(
    () => undefined,
    (err) => err,
  );
  expect(error).toBeInstanceOf(FetchError);
  return error;
};

beforeEach(() => {
  network.mockReset();
  Object.assign(globalThis, { window: { fetch: network }, caches: undefined });
  setCdnRoot(ROOT);
});

it('fetches a package part again when its body arrives cut off', async () => {
  network.mockResolvedValueOnce(reply(part.slice(0, part.length - 4))).mockResolvedValueOnce(reply(part));
  const module = await fetchModuleEntries('left-pad', '1.3.0', ['.']);
  expect(module.f['index.js']).toEqual({ c: 'module.exports = 1', d: [], t: true });
  expect(network).toHaveBeenCalledTimes(2);
});

it('fetches the dependency tree again when the connection drops mid-body', async () => {
  const dropped = { ...reply(''), arrayBuffer: () => Promise.reject(new TypeError('network error')) };
  network.mockResolvedValueOnce(dropped).mockResolvedValueOnce(reply(encode([{ n: 'left-pad', v: '1.3.0', d: 0 }])));
  expect(await fetchManifest({ 'left-pad': '^1.3.0' })).toEqual([{ n: 'left-pad', v: '1.3.0', d: 0 }]);
  expect(network).toHaveBeenCalledTimes(2);
});

it.each([
  ['a proxy page', page],
  ['an empty body', ''],
  // Decodes as msgpack (a string), but a package part is a map of files.
  ['another payload', encode('ok')],
])('does not take %s served with 200 for a package, and names the package', async (_what, body) => {
  network.mockImplementation(async () => reply(body));
  const error = await failure(fetchModuleEntries('left-pad', '1.3.0', ['./lib']));
  expect(error.failure).toBe('body');
  expect(error.message).toContain('left-pad@1.3.0 (entry ./lib)');
  expect(error.message).toContain(ROOT + 'package/');
  expect(network).toHaveBeenCalledTimes(6);
});

it('never stores a page served in a package’s place', async () => {
  const cache = {
    match: jest.fn(async () => undefined),
    put: jest.fn(async () => undefined),
    delete: jest.fn(async () => true),
  };
  Object.assign(globalThis, { caches: { open: async () => cache } });
  network.mockImplementation(async () => reply(page));
  await failure(fetchModuleEntries('left-pad', '1.3.0', ['.']));
  expect(cache.match).toHaveBeenCalled();
  expect(cache.put).not.toHaveBeenCalled();
});

it('reports a version that does not exist with the CDN’s message, without retrying', async () => {
  const body = JSON.stringify({
    status: 404,
    message: 'Package version not found left-pad@99.0.0',
    details: 'PackageVersionNotFound',
  });
  network.mockImplementation(async () => reply(body, 404));
  const error = await failure(fetchManifest({ 'left-pad': '99.0.0', react: '19.1.0' }));
  expect(error.message).toMatch(
    /^Fetch failed with status 404 for the dependency tree of left-pad@99\.0\.0, react@19\.1\.0 \(https:\/\/preview\.example\/sandpack-cdn\/dep_tree\/[^)]+\): Package version not found left-pad@99\.0\.0$/,
  );
  expect(network).toHaveBeenCalledTimes(1);
});

it('names the packages when the CDN cannot be reached at all', async () => {
  network.mockRejectedValue(new TypeError('Failed to fetch'));
  const error = await failure(fetchManifest({ 'left-pad': '^1.3.0' }));
  expect(error.message).not.toBe('Failed to fetch');
  expect(error.message).toContain(
    'Network request failed for the dependency tree of left-pad@^1.3.0 (' + ROOT + 'dep_tree/',
  );
  expect(error.message).toContain('Failed to fetch (after 6 attempts)');
});

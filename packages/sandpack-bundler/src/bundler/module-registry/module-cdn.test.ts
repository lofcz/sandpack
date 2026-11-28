import type { Mock } from '@rstest/core';
import { encode } from '@msgpack/msgpack';
import { fetchDecoded } from '../../utils/fetch';
import { fetchManifest, fetchModule, fetchModuleEntries, setCdnRoot } from './module-cdn';

rs.mock('../../utils/fetch', () => ({
  fetchDecoded: rs.fn(),
  registerImmutableUrlPrefix: rs.fn(),
}));

const fetchMock = fetchDecoded as Mock;
type Decode = (body: Uint8Array) => unknown;
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, _init: unknown, decode: Decode) =>
    decode(encode(url.includes('/dep_tree') ? [] : { f: {}, m: [] })),
  );
  setCdnRoot('https://preview.example/sandpack-cdn/');
});

const payload = (url: string, init?: { body?: string }) =>
  atob(init?.body ?? decodeURIComponent(url.split('/').pop()!));

it('sends the packages, their entries and the version pins as one v7 query', async () => {
  await fetchManifest({ react: '19.1.0' }, { react: '19.1.0', scheduler: '0.27.0' }, { react: ['.', './jsx-runtime'] });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/dep_tree\/[^/]+$/);
  expect(payload(url)).toBe(
    '7({"deps":{"react":"19.1.0"},"pins":{"react":"19.1.0","scheduler":"0.27.0"},"entries":{"react":[".","./jsx-runtime"]}})',
  );
  expect(init.method).toBeUndefined();
});

it('resolves a large dependency graph in one body without long URL segments', async () => {
  const deps = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`@scope/module-${i}`, '^1.0.0']));
  await fetchManifest(deps);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://preview.example/sandpack-cdn/dep_tree');
  expect(init.method).toBe('POST');
  expect(init.headers['Content-Type']).toBe('text/plain');
  expect(atob(init.body)).toBe(`7(${JSON.stringify({ deps, pins: {}, entries: {} })})`);
});

it('installs a release as its listing plus one cacheable GET per entry, inlined over the listing', async () => {
  const parts: Record<string, unknown> = {
    null: { f: { 'package.json': { c: '{}', d: [], t: false }, 'index.js': 10, 'client.js': 20 }, m: [] },
    '.': { f: { 'index.js': { c: 'root', d: ['scheduler'], t: true } }, m: ['scheduler'] },
    './client': { f: { 'client.js': { c: 'client', d: ['./index.js'], t: true } }, m: [] },
  };
  fetchMock.mockImplementation(async (url: string, _init: unknown, decode: Decode) =>
    decode(encode(parts[String(JSON.parse(payload(url).slice(2, -1)).entry)])),
  );
  const module = await fetchModule('react-dom', '19.1.0', ['.', './client']);
  expect(fetchMock.mock.calls.map(([url, init]) => [payload(url, init), init?.method])).toEqual([
    ['7({"name":"react-dom","version":"19.1.0","entry":null})', undefined],
    ['7({"name":"react-dom","version":"19.1.0","entry":"."})', undefined],
    ['7({"name":"react-dom","version":"19.1.0","entry":"./client"})', undefined],
  ]);
  expect(module.f['index.js']).toEqual({ c: 'root', d: ['scheduler'], t: true });
  expect(module.f['client.js']).toEqual({ c: 'client', d: ['./index.js'], t: true });
  expect(module.f['package.json']).toEqual({ c: '{}', d: [], t: false });
  expect(module.m).toEqual(['scheduler']);

  fetchMock.mockClear();
  const added = await fetchModuleEntries('react-dom', '19.1.0', ['./client']);
  expect(fetchMock).toHaveBeenCalledTimes(1); // no second listing
  expect(Object.keys(added.f)).toEqual(['client.js']);
});

it('also transports long scoped package specifiers in the body', async () => {
  const name = `@scope/${'a'.repeat(200)}`;
  await fetchModule(name, '1.2.3', ['.']);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://preview.example/sandpack-cdn/package');
  expect(init.method).toBe('POST');
  expect(atob(init.body)).toBe(`7(${JSON.stringify({ name, version: '1.2.3', entry: null })})`);
});

it('surfaces service errors as-is, without retrying another transport', async () => {
  const { FetchError } = await import('../../errors/FetchError');
  const body = JSON.stringify({ status: 404, message: 'Package version not found react@99.0.0', details: 'PackageVersionNotFound' });
  const error = new FetchError({ status: 404, statusText: 'Not Found', url: 'https://preview.example/sandpack-cdn/dep_tree' } as Response, body);
  fetchMock.mockRejectedValue(error);
  await expect(fetchManifest({ ['a'.repeat(200)]: '1.0.0' })).rejects.toBe(error);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

// A /package answer is cached for a year under its address, here and by every
// proxy on the way. The CDN's dependency tree says which generation of payloads
// it serves, and each query carries it: what the CDN transforms differently
// tomorrow is asked for under a new address.
it('asks for a package under the payload generation its dependency tree reported', async () => {
  fetchMock.mockImplementation(async (url: string, _init: unknown, decode: Decode) =>
    decode(encode(url.includes('/dep_tree')
      ? [{ n: 'gen-pkg', v: '1.0.0', d: 0, e: ['.'], g: 5 }, { n: 'gen-alias', v: '2.0.0', d: 0, s: 'gen-target', g: 5 }, { n: 'old-cdn-pkg', v: '3.0.0', d: 0 }]
      : { f: {}, m: [] })),
  );
  await fetchManifest({ 'gen-pkg': '^1.0.0', 'gen-alias': 'npm:gen-target@^2.0.0', 'old-cdn-pkg': '^3.0.0' });
  fetchMock.mockClear();

  await fetchModule('gen-pkg', '1.0.0', ['.']);
  // An alias's files are asked for under the package they come from.
  await fetchModuleEntries('gen-target', '2.0.0', ['./sub']);
  // A CDN that reports no generation is asked as before, under the addresses already cached.
  await fetchModuleEntries('old-cdn-pkg', '3.0.0', ['.']);
  await fetchModuleEntries('gen-pkg', '1.0.1', ['.']);

  expect(fetchMock.mock.calls.map(([url, init]) => payload(url, init))).toEqual([
    '7({"name":"gen-pkg","version":"1.0.0","entry":null,"g":5})',
    '7({"name":"gen-pkg","version":"1.0.0","entry":".","g":5})',
    '7({"name":"gen-target","version":"2.0.0","entry":"./sub","g":5})',
    '7({"name":"old-cdn-pkg","version":"3.0.0","entry":"."})',
    '7({"name":"gen-pkg","version":"1.0.1","entry":"."})',
  ]);
});

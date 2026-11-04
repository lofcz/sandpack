import { encode } from '@msgpack/msgpack';
import { retryFetch } from '../../utils/fetch';
import { fetchManifest, fetchModule, fetchModuleEntries, setCdnRoot } from './module-cdn';

jest.mock('../../utils/fetch', () => ({
  retryFetch: jest.fn(),
  registerImmutableUrlPrefix: jest.fn(),
}));

const fetchMock = retryFetch as jest.Mock;
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => ({
    arrayBuffer: async () => encode(url.includes('/dep_tree') ? [] : { f: {}, m: [] }),
  }));
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
  fetchMock.mockImplementation(async (url: string) => ({
    arrayBuffer: async () => encode(parts[String(JSON.parse(payload(url).slice(2, -1)).entry)]),
  }));
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

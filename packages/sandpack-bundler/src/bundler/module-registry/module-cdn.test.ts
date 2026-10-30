import { encode } from '@msgpack/msgpack';
import { retryFetch } from '../../utils/fetch';
import { fetchManifest, fetchModule, setCdnRoot } from './module-cdn';

jest.mock('../../utils/fetch', () => ({
  retryFetch: jest.fn(),
  registerImmutableUrlPrefix: jest.fn(),
}));

const fetchMock = retryFetch as jest.Mock;
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ arrayBuffer: async () => encode([]) });
  setCdnRoot('https://preview.example/sandpack-cdn/');
});

it('keeps short requests compatible with existing CDN deployments', async () => {
  await fetchManifest({ react: '19.1.0' });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/dep_tree\/[^/]+$/);
  expect(atob(decodeURIComponent(url.split('/').pop()))).toBe('5({"react":"19.1.0"})');
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
  expect(atob(init.body)).toBe(`5(${JSON.stringify(deps)})`);
});

it('also transports long scoped package specifiers in the body', async () => {
  const name = `@scope/${'a'.repeat(200)}`;
  await fetchModule(name, '1.2.3');
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://preview.example/sandpack-cdn/package');
  expect(init.method).toBe('POST');
  expect(atob(init.body)).toBe(`5(${name}@1.2.3)`);
});

it('falls back as one graph when an older service lacks the POST route', async () => {
  const { FetchError } = await import('../../errors/FetchError');
  const deps = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`module-${i}`, '1.0.0']));
  fetchMock.mockRejectedValueOnce(new FetchError({ status: 404, statusText: 'Not found', url: 'https://preview.example/sandpack-cdn/dep_tree' } as Response, 'Not found'));
  await fetchManifest(deps);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const [url, init] = fetchMock.mock.calls[1];
  expect(init).toBeUndefined();
  expect(atob(decodeURIComponent(url.split('/').pop()))).toBe(`5(${JSON.stringify(deps)})`);
});

it('reports transport skew without suggesting source edits if neither route works', async () => {
  const { FetchError } = await import('../../errors/FetchError');
  fetchMock.mockRejectedValue(new FetchError({ status: 404, statusText: 'Not found', url: 'https://preview.example/sandpack-cdn/dep_tree' } as Response, 'Not found'));
  await expect(fetchManifest({ ['a'.repeat(200)]: '1.0.0' })).rejects.toThrow('Keep the saved source and dependencies');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not reinterpret package resolution failures as missing transport routes', async () => {
  const { FetchError } = await import('../../errors/FetchError');
  const error = new FetchError({ status: 422, statusText: 'Invalid dependency', url: 'https://preview.example/sandpack-cdn/dep_tree' } as Response, 'Invalid dependency');
  fetchMock.mockRejectedValue(error);
  await expect(fetchManifest({ ['a'.repeat(200)]: '1.0.0' })).rejects.toBe(error);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

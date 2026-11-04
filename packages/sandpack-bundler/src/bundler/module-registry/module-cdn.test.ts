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

it('sends the packages to install and the version pins as one v6 query', async () => {
  await fetchManifest({ react: '19.1.0' }, { react: '19.1.0', scheduler: '0.27.0' });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/dep_tree\/[^/]+$/);
  expect(atob(decodeURIComponent(url.split('/').pop()))).toBe(
    '6({"deps":{"react":"19.1.0"},"pins":{"react":"19.1.0","scheduler":"0.27.0"}})',
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
  expect(atob(init.body)).toBe(`6(${JSON.stringify({ deps, pins: {} })})`);
});

it('also transports long scoped package specifiers in the body', async () => {
  const name = `@scope/${'a'.repeat(200)}`;
  await fetchModule(name, '1.2.3');
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://preview.example/sandpack-cdn/package');
  expect(init.method).toBe('POST');
  expect(atob(init.body)).toBe(`6(${name}@1.2.3)`);
});

it('surfaces service errors as-is, without retrying another transport', async () => {
  const { FetchError } = await import('../../errors/FetchError');
  const body = JSON.stringify({ status: 404, message: 'Package version not found react@99.0.0', details: 'PackageVersionNotFound' });
  const error = new FetchError({ status: 404, statusText: 'Not Found', url: 'https://preview.example/sandpack-cdn/dep_tree' } as Response, body);
  fetchMock.mockRejectedValue(error);
  await expect(fetchManifest({ ['a'.repeat(200)]: '1.0.0' })).rejects.toBe(error);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

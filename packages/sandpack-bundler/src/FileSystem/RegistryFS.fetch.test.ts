import { ModuleRegistry } from '../bundler/module-registry';
import { NodeModule } from '../bundler/module-registry/NodeModule';
import { FetchError } from '../errors/FetchError';
import { RegistryFS } from './RegistryFS';

// Backoff waits are not what these tests are about.
jest.mock('../utils/sleep', () => ({ sleep: () => Promise.resolve() }));

const FILE_URL = 'https://unpkg.com/react@18.3.1/cjs/react.production.js';
const network = jest.fn();

/** The parts of a Response the fetch layer reads. */
const reply = (body: string, status = 200) => ({
  ok: status >= 200 && status <= 299,
  status,
  statusText: '',
  headers: { get: () => null },
  arrayBuffer: async () => new TextEncoder().encode(body).slice().buffer,
  text: async () => body,
});

/** A RegistryFS with its default (network) fetcher over one listed-but-not-inlined file. */
function registryFs(): RegistryFS {
  const react = new NodeModule('react', '18.3.1', { 'cjs/react.production.js': 1234 }, [], {
    name: 'react',
    version: '18.3.1',
  });
  return new RegistryFS({ modules: new Map([[react.name, react]]) } as unknown as ModuleRegistry);
}

async function readAll(regfs: RegistryFS, path: string): Promise<string> {
  const inode = await regfs.stat(path);
  const buffer = new Uint8Array(inode.size);
  await regfs.read(path, buffer, 0, inode.size);
  return new TextDecoder().decode(buffer);
}

beforeEach(() => {
  network.mockReset();
  Object.assign(globalThis, { window: { fetch: network }, caches: undefined });
});

it('reads a listed file again when the connection drops mid-file', async () => {
  const dropped = { ...reply(''), arrayBuffer: () => Promise.reject(new TypeError('network error')) };
  network.mockResolvedValueOnce(dropped).mockResolvedValueOnce(reply('module.exports = React;'));
  expect(await readAll(registryFs(), '/react/cjs/react.production.js')).toBe('module.exports = React;');
  expect(network.mock.calls.map(([url]) => url)).toEqual([FILE_URL, FILE_URL]);
});

it('says which file of which release could not be read', async () => {
  network.mockRejectedValue(new TypeError('Failed to fetch'));
  const error = await registryFs()
    .stat('/react/cjs/react.production.js')
    .then(
      () => undefined,
      (err) => err,
    );
  expect(error).toBeInstanceOf(FetchError);
  expect(error.message).toBe(
    'Network request failed for react@18.3.1/cjs/react.production.js (' +
      FILE_URL +
      '): Failed to fetch (after 6 attempts)',
  );
});

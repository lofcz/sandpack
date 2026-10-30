import { retryFetch } from './fetch';
import { FetchError } from '../errors/FetchError';
const network = jest.fn();
beforeEach(() => { network.mockReset(); (globalThis as any).window = { fetch: network }; });
it.each([400, 401, 403, 404, 405, 422])('does not retry deterministic HTTP %s failures', async status => {
  network.mockResolvedValue({ ok: false, status, statusText: 'Failure', url: 'https://service.example/dep_tree', text: async () => 'detail' });
  await expect(retryFetch('https://service.example/dep_tree', { maxRetries: 5, retryDelay: 0 })).rejects.toBeInstanceOf(FetchError);
  expect(network).toHaveBeenCalledTimes(1);
});
it('still retries transient service failures', async () => {
  const success = { ok: true, status: 200 };
  network.mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce(success);
  await expect(retryFetch('https://service.example/dep_tree', { maxRetries: 2, retryDelay: 0 })).resolves.toBe(success);
  expect(network).toHaveBeenCalledTimes(2);
});

jest.mock('url:lightningcss-wasm/lightningcss_node.wasm', () => ({ __esModule: true, default: 'https://fixture.test/lightningcss.wasm' }), { virtual: true });
jest.mock('lightningcss-wasm', () => ({ __esModule: true, default: jest.fn(), bundleAsync: jest.fn() }));

import initLightningcss, { bundleAsync } from 'lightningcss-wasm';
import cssLoader from './css-loader';
import { ITranspilationContext } from '../Transformer';

it('retries CSS engine initialization after a network failure and shares successful initialization', async () => {
  (initLightningcss as jest.Mock).mockRejectedValueOnce(new Error('network interrupted')).mockResolvedValue(undefined);
  (bundleAsync as jest.Mock).mockResolvedValue({ code: new TextEncoder().encode('body {}') });
  const ctx = { module: { filepath: '/app/style.css' }, code: 'body {}' } as ITranspilationContext;
  expect(await cssLoader(ctx)).toBeInstanceOf(Error);
  const results = await Promise.all([cssLoader(ctx), cssLoader(ctx)]);
  for (const result of results) expect(result).toMatchObject({ code: 'body {}' });
  expect(initLightningcss).toHaveBeenCalledTimes(2);
});

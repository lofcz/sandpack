import type { Mock } from '@rstest/core';
rs.mock('lightningcss-wasm', () => ({ __esModule: true, default: rs.fn(), bundleAsync: rs.fn() }));

import initLightningcss, { bundleAsync } from 'lightningcss-wasm';
import cssLoader from './css-loader';
import { ITranspilationContext } from '../Transformer';

it('retries CSS engine initialization after a network failure and shares successful initialization', async () => {
  (initLightningcss as Mock).mockRejectedValueOnce(new Error('network interrupted')).mockResolvedValue(undefined);
  (bundleAsync as Mock).mockResolvedValue({ code: new TextEncoder().encode('body {}') });
  const ctx = { module: { filepath: '/app/style.css' }, code: 'body {}' } as ITranspilationContext;
  expect(await cssLoader(ctx)).toBeInstanceOf(Error);
  const results = await Promise.all([cssLoader(ctx), cssLoader(ctx)]);
  for (const result of results) expect(result).toMatchObject({ code: 'body {}' });
  expect(initLightningcss).toHaveBeenCalledTimes(2);
});

import { Bundler } from '../bundler';
import { createBundlerHarness } from './bundlerHarness';

it('loads the platform SDK only when reached, shares concurrent loads and retries failures', async () => {
  const h = await createBundlerHarness({
    'package.json': JSON.stringify({ main: 'index.ts', dependencies: {} }),
    'index.ts': 'export const value = 1;',
  });
  const bundler = h.bundler;
  const register = () => Bundler.prototype.addLocalModules.call(bundler);
  const vendorTarget = bundler as unknown as { vendorModuleFrom(name: string, baseUrl: string): Promise<void> };
  const vendor = jest.spyOn(vendorTarget, 'vendorModuleFrom').mockImplementation(async (name) => {
    await bundler.addPreloadedModule(name, 'module.exports = 42;');
  });
  try {
    await register();
    await bundler.resolveInstalled('./index.ts', '/app/main.ts');
    expect(vendor).not.toHaveBeenCalled();
    const paths = await Promise.all([
      bundler.resolveInstalled('@immediately-run/sdk', '/app/index.ts'),
      bundler.resolveInstalled('@immediately-run/sdk/index.js', '/app/other.ts'),
    ]);
    expect(paths).toEqual(['/node_modules/@immediately-run/sdk/index.js', '/node_modules/@immediately-run/sdk/index.js']);
    expect(vendor).toHaveBeenCalledTimes(1);
    await bundler.resolveInstalled('@immediately-run/sdk', '/app/index.ts');
    expect(vendor).toHaveBeenCalledTimes(1);

    await register();
    vendor.mockRejectedValueOnce(new Error('temporary network failure'));
    await expect(bundler.resolveInstalled('@immediately-run/sdk', '/app/index.ts')).rejects.toThrow('temporary network failure');
    await expect(bundler.resolveInstalled('@immediately-run/sdk', '/app/index.ts')).resolves.toBe(paths[0]);
    expect(vendor).toHaveBeenCalledTimes(3);

    await bundler.fs.writeFile('/app/package.json', JSON.stringify({ dependencies: { '@immediately-run/sdk': '0.2.7' } }));
    await expect(register()).rejects.toThrow();
    expect(vendor).toHaveBeenCalledTimes(3);
  } finally {
    await h.teardown();
  }
});

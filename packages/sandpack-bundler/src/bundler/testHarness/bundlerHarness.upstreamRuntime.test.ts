import { fetchManifest, fetchModule } from '../module-registry/module-cdn';
import { createBundlerHarness, installEvalGlobals } from './bundlerHarness';

jest.mock('../module-registry/module-cdn', () => ({
  ...jest.requireActual('../module-registry/module-cdn'),
  fetchManifest: jest.fn(), fetchModule: jest.fn(),
}));

it('runs upstream import.meta and non-optional root peers through the real transform and evaluator', async () => {
  const restore = installEvalGlobals();
  (fetchManifest as jest.Mock).mockImplementation(async deps => Object.keys(deps).map(n => ({ n, v: '1.0.0', d: 0 })));
  (fetchModule as jest.Mock).mockImplementation(async name => ({ f: {
    'package.json': { c: JSON.stringify({ name, main: 'index.js' }), d: [], t: true },
    'index.js': { c: 'module.exports = 42;', d: [], t: true },
  }, m: [] }));
  const h = await createBundlerHarness({
    'package.json': JSON.stringify({ main: 'src/main.ts', peerDependencies: {
      state: '1.0.0', optional: '1.0.0',
    }, peerDependenciesMeta: { optional: { optional: true } } }),
    'index.html': '<!doctype html><div id="root"></div>',
    'src/main.ts': `import value from 'state'; globalThis.__upstreamResult = {
      value, url: import.meta.url, frozen: Object.isFrozen(import.meta),
      sibling: new URL('./add.wasm', import.meta.url).href, env: import.meta.env,
    };`,
  }, { forCompile: true });
  try {
    const evaluate = await h.bundler.compile();
    expect(evaluate).not.toBeNull();
    evaluate!();
    expect((globalThis as any).__upstreamResult).toEqual({
      value: 42, url: 'http://localhost/app/src/main.ts', frozen: true,
      sibling: 'http://localhost/app/src/add.wasm', env: undefined,
    });
    expect(h.bundler.moduleRegistry.isDeclared('optional')).toBe(false);
  } finally {
    await h.teardown();
    restore();
    delete (globalThis as any).__upstreamResult;
  }
});

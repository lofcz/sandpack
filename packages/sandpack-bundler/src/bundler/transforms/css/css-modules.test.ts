jest.mock('url:lightningcss-wasm/lightningcss_node.wasm', () => ({ __esModule: true, default: 'https://fixture.test/lightningcss.wasm' }), { virtual: true });
jest.mock('lightningcss-wasm', () => ({ __esModule: true, default: jest.fn(async () => undefined), bundleAsync: jest.fn() }));

import { bundleAsync } from 'lightningcss-wasm';

import { createBundlerHarness, installEvalGlobals } from '../../testHarness/bundlerHarness';

// What lightningcss returns for a CSS module (shape checked against lightningcss-wasm 1.33):
// the stylesheet with its class names renamed, and the map of the names.
const engine = (bundleAsync as jest.Mock).mockImplementation(async ({ filename, cssModules }) => {
  const css = cssModules ? '.h4sh_box { color: red } .h4sh_base { margin: 0 }' : '.box { color: red }';
  return {
    code: new TextEncoder().encode(css),
    exports: cssModules
      ? {
          box: { name: 'h4sh_box', isReferenced: false, composes: [{ type: 'local', name: 'h4sh_base' }, { type: 'dependency', name: 'far', specifier: './other.module.css' }] },
          base: { name: 'h4sh_base', isReferenced: false, composes: [] },
        }
      : undefined,
    filename,
  };
});

it('exports the class names of a *.module.css import, and nothing from a plain stylesheet', async () => {
  const restore = installEvalGlobals();
  const inserted: string[] = [];
  (globalThis as any).document.createTextNode = (text: string) => (inserted.push(text), {});
  const silenced = (['log', 'info', 'warn', 'error', 'groupCollapsed'] as const).map((method) =>
    jest.spyOn(console, method).mockImplementation(() => {}),
  );
  const h = await createBundlerHarness(
    {
      'package.json': JSON.stringify({ main: 'src/main' }),
      'index.html': '<!doctype html><div id="root"></div>',
      'src/main.ts': `import styles from './box.module.css'; import plain from './plain.css';
        (globalThis as any).__cssModules = { box: styles.box, base: styles.base, keys: Object.keys(styles), plain: Object.keys(plain) };`,
      'src/box.module.css': '.box { color: red; composes: base; } .base { margin: 0 }',
      'src/plain.css': '.box { color: red }',
    },
    { forCompile: true },
  );
  try {
    const evaluate = await h.bundler.compile();
    evaluate!();
    expect((globalThis as any).__cssModules).toEqual({
      // The class it was renamed to, then the classes of this file it composes.
      box: 'h4sh_box h4sh_base',
      base: 'h4sh_base',
      keys: ['box', 'base'],
      plain: [],
    });
    // The engine renames the classes of the module only; the renamed stylesheet is what is inserted.
    expect(engine.mock.calls.map(([options]) => [options.filename, options.cssModules])).toEqual([['/app/src/box.module.css', true]]);
    expect(inserted).toContain('.h4sh_box { color: red } .h4sh_base { margin: 0 }');
    expect(inserted).toContain('.box { color: red }');
  } finally {
    for (const spy of silenced) spy.mockRestore();
    await h.teardown();
    restore();
    delete (globalThis as any).__cssModules;
  }
});

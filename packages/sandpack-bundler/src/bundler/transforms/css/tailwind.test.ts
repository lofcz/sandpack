// Adapt only browser asset loading for Node; run the real CSS loader and WASM resolver.
jest.mock('url:lightningcss-wasm/lightningcss_node.wasm', () => ({ __esModule: true, default: 'https://fixture.test/lightningcss.wasm' }), { virtual: true });
jest.mock('lightningcss-wasm', () => {
  const { dirname, join } = require('path');
  return jest.requireActual(join(dirname(require.resolve('lightningcss-wasm')), 'wasm-node.cjs'));
});

import { CSSTransformer } from './index';
import { StyleTransformer } from '../style';
import { cssNeedsTailwind } from '@lofcz/transpiler/css';
import { ITranspilationContext } from '../Transformer';

it.each([
  '@import "tailwindcss"; .label { @apply font-bold text-blue-600; }',
  '@tailwind base; @tailwind components; @tailwind utilities; .label { @apply p-4; }',
  '@theme { --color-brand: #123456; }',
])('compiles framework styles through the installed browser runtime: %s', async (source) => {
  const ctx = { module: { id: 'styles', filepath: '/app/styles.css' }, code: source } as ITranspilationContext;
  const css = new CSSTransformer();
  const loader = jest.spyOn(css, 'getLoader');
  const result = await css.transform(ctx, {});
  expect(result).not.toBeInstanceOf(Error);
  if (result instanceof Error) throw result;
  expect(loader).not.toHaveBeenCalled();
  expect(result.code.match(/@import "tailwindcss";/g)).toHaveLength(1);
  expect(result.code).not.toMatch(/@tailwind (base|components|utilities)/);
  const js = await new StyleTransformer().transform({ ...ctx, code: result.code }, {});
  if (js instanceof Error) throw js;
  expect(js.dependencies.has('@tailwindcss/browser')).toBe(true);
  expect(js.code).toContain('require("@tailwindcss/browser")');
  expect(js.code).toContain('text/tailwindcss');
  if (source.includes('@apply')) expect(js.code).toContain('@apply');
});

it('leaves ordinary CSS and code in comments on the normal style path', async () => {
  const source = '/* @apply p-4; */ @layer base { body { margin: 0; } }';
  expect(cssNeedsTailwind(source)).toBe(false);
  const result = await new StyleTransformer().transform({ module: { id: 'plain' }, code: source } as ITranspilationContext, {});
  if (result instanceof Error) throw result;
  expect(result.dependencies.size).toBe(0);
  expect(result.code).toContain('text/css');
});

it('preserves framework import options instead of silently enabling preflight', async () => {
  const source = '@import "tailwindcss/utilities" layer(utilities);';
  const result = await new CSSTransformer().transform({ module: { filepath: '/app/styles.css' }, code: source } as ITranspilationContext, {});
  if (result instanceof Error) throw result;
  expect(result.code.trim()).toBe(source);
});

it('does not load the CSS resolver or compiler for directive examples in strings', async () => {
  const source = '/* url(example) */ a::after { content: \'@import "tailwindcss"; @apply p-4;\'; }';
  const ctx = { module: { id: 'literal', filepath: '/literal.css' }, code: source } as ITranspilationContext;
  const css = new CSSTransformer();
  const loader = jest.spyOn(css, 'getLoader');
  const result = await css.transform(ctx, {});
  if (result instanceof Error) throw result;
  expect(result.code).toBe(source);
  expect(loader).not.toHaveBeenCalled();
  const js = await new StyleTransformer().transform({ ...ctx, code: result.code }, {});
  if (js instanceof Error) throw js;
  expect(js.dependencies.size).toBe(0);
  expect(js.code).toContain('text/css');
});

it('preserves layer order and framework options through the real CSS resolver', async () => {
  const source = '@layer overrides, theme;\n@import "tailwindcss/theme" layer(theme);\n@import "./extra.css";';
  const result = await new CSSTransformer().transform({
    code: source,
    module: { filepath: '/styles.css', bundler: {
      resolveAsync: async () => '/extra.css',
      fs: { readFileAsync: async () => '@layer overrides { h1 { color: red; } }' },
    } },
  } as unknown as ITranspilationContext, {});
  if (result instanceof Error) throw result;
  expect(result.code.indexOf('@layer overrides, theme;')).toBeLessThan(result.code.indexOf('@import "tailwindcss/theme" layer(theme);'));
  expect(result.code.indexOf('@import "tailwindcss/theme" layer(theme);')).toBeLessThan(result.code.indexOf('@layer overrides {'));
  expect(result.code).not.toContain('data:text/css,sandpack-tailwind-');
  expect(result.dependencies.has('/extra.css')).toBe(true);
});


it.each([
  '@import "tailwindcss"; .label { @apply p-4; }',
  '.label { @apply p-4; }',
])('discovers compiler syntax in imported CSS: %s', async (imported) => {
  const resolve = jest.fn(async () => '/theme.css');
  const ctx = {
    code: '@import "./theme.css";',
    module: { id: 'entry', filepath: '/styles.css', bundler: {
      resolveAsync: resolve,
      fs: { readFileAsync: async () => imported },
    } },
  } as unknown as ITranspilationContext;
  const result = await new CSSTransformer().transform(ctx, {});
  if (result instanceof Error) throw result;
  expect(result.code).toContain('@import "tailwindcss";');
  expect(result.code).toContain('@apply p-4');
  expect(result.code).not.toContain('data:text/css,sandpack-tailwind-');
  expect(result.dependencies.has('/theme.css')).toBe(true);
  const js = await new StyleTransformer().transform({ ...ctx, code: result.code }, {});
  if (js instanceof Error) throw js;
  expect(js.dependencies.has('@tailwindcss/browser')).toBe(true);
  expect(resolve.mock.calls).toHaveLength(1);
});

it('keeps inherited layer and media scope around imported compiler CSS', async () => {
  const ctx = {
    code: '@import "./theme.css" layer(shell) print;',
    module: { id: 'entry', filepath: '/styles.css', bundler: {
      resolveAsync: async () => '/theme.css',
      fs: { readFileAsync: async () => '@import "tailwindcss/utilities" source(none);' },
    } },
  } as unknown as ITranspilationContext;
  const result = await new CSSTransformer().transform(ctx, {});
  if (result instanceof Error) throw result;
  expect(result.code).toContain('@layer shell {');
  expect(result.code).toContain('@media print {');
  expect(result.code).toContain('@import "tailwindcss/utilities" source(none);');
});

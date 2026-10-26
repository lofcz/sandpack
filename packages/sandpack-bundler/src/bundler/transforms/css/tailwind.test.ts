import { CSSTransformer } from './index';
import { StyleTransformer } from '../style';
import { usesTailwind } from './tailwind';
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
  expect(usesTailwind(source)).toBe(false);
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

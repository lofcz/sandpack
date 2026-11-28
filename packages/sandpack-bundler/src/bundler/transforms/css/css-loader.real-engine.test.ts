// The real CSS engine (under Node, lightningcss-wasm resolves to its Node build,
// which suspends a bundle the same way the browser build does).
import cssLoader from './css-loader';
import { ITranspilationContext } from '../Transformer';

const files: Record<string, string> = {
  '/app/src/styles.css': '@import "./base.css"; .styles { color: red }',
  '/app/src/base.css': '.base { color: blue }',
  '/app/src/pages/page.css': '@import "../base.css"; @import "./part.css"; .page { margin: 2px }',
  '/app/src/pages/part.css': '.part { margin: 1px }',
  '/app/src/box.module.css': '@import "./base.css"; .box { padding: 7px }',
  '/app/src/card.module.css': '.card { padding: 3px; composes: frame; } .frame { border: 0 }',
};

const later = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

/** `delay` is how long each read and each resolution of this bundle takes. */
function compile(entry: string, delay: number) {
  const asked: Array<[specifier: string, importer: string]> = [];
  const bundler = {
    fs: { readFileAsync: (path: string) => later(files[path], delay) },
    // What Bundler.resolveAsync does with a relative specifier: relative to the importing FILE.
    resolveAsync: (specifier: string, importer: string) => {
      asked.push([specifier, importer]);
      const resolved = new URL(specifier, `file://${importer}`).pathname;
      return later(resolved, delay).then((path) => {
        if (!(path in files)) throw new Error(`not found: ${path}`);
        return path;
      });
    },
    moduleRegistry: { modules: new Map() },
  };
  const ctx = { module: { filepath: entry, bundler }, code: files[entry] } as unknown as ITranspilationContext;
  return cssLoader(ctx).then((result) => ({ result, asked }));
}

const entries = ['/app/src/styles.css', '/app/src/pages/page.css', '/app/src/box.module.css', '/app/src/card.module.css'];

it('resolves a relative @import against the stylesheet it is written in', async () => {
  const { result, asked } = await compile('/app/src/pages/page.css', 0);
  if (result instanceof Error) throw result;
  expect(asked).toEqual([
    ['../base.css', '/app/src/pages/page.css'],
    ['./part.css', '/app/src/pages/page.css'],
  ]);
  expect([...result.dependencies].sort()).toEqual(['/app/src/base.css', '/app/src/pages/part.css']);
  for (const rule of ['.base', '.part', '.page']) expect(result.code).toContain(rule);
});

it('gives a CSS module its class names', async () => {
  const { result } = await compile('/app/src/card.module.css', 0);
  if (result instanceof Error) throw result;
  const names = (result as { exports?: Record<string, string> }).exports!;
  expect(Object.keys(names).sort()).toEqual(['card', 'frame']);
  // The renamed class, then the class of the same file it composes.
  expect(names.card.split(' ')).toEqual([expect.stringMatching(/card$/), names.frame]);
  expect(result.code).toContain(`.${names.frame}`);
  expect(result.code).not.toContain('.card {');
});

it('compiles stylesheets requested at the same time as it compiles each alone', async () => {
  const alone: Record<string, unknown> = {};
  for (const entry of entries) alone[entry] = (await compile(entry, 0)).result;
  for (const result of Object.values(alone)) expect(result).not.toBeInstanceOf(Error);

  // An app's stylesheets are requested together, and their reads come back in any order.
  for (let round = 0; round < 12; round++) {
    const together = await Promise.all(entries.map((entry, i) => compile(entry, 1 + ((round * 7 + i * 13) % 11))));
    together.forEach(({ result }, i) => expect(result).toEqual(alone[entries[i]]));
  }
});

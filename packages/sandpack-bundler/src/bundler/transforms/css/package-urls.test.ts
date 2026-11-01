// Run the real CSS loader and WASM engine; only browser asset loading is adapted for Node.
jest.mock('url:lightningcss-wasm/lightningcss_node.wasm', () => ({ __esModule: true, default: 'https://fixture.test/lightningcss.wasm' }), { virtual: true });
jest.mock('lightningcss-wasm', () => {
  const { dirname, join } = require('path');
  return jest.requireActual(join(dirname(require.resolve('lightningcss-wasm')), 'wasm-node.cjs'));
});

import { CSSTransformer } from './index';
import { packageCssBase, rebasePackageCssUrls, rebasePackageUrl } from './package-urls';
import { ITranspilationContext } from '../Transformer';

const registry = {
  modules: new Map([
    ['@fontsource/unifrakturmaguntia', { version: '5.2.8', pinned: true }],
    ['katex', { version: '0.16.22', pinned: true }],
    // esm.sh fallback: the registry holds the requested range, not a release.
    ['ranged', { version: '^1.0.0', pinned: false }],
    ['prerelease', { version: '19.0.0-rc.1+build.5', pinned: true }],
  ]),
};

const FONTSOURCE = `@font-face {
  font-family: 'UnifrakturMaguntia';
  font-display: swap;
  src: url(./files/unifrakturmaguntia-latin-400-normal.woff2) format('woff2'), url(./files/unifrakturmaguntia-latin-400-normal.woff) format('woff');
}`;

function context(filepath: string, code: string, files: Record<string, string> = {}): ITranspilationContext {
  return {
    code,
    module: {
      id: filepath,
      filepath,
      bundler: {
        moduleRegistry: registry,
        fs: { readFileAsync: async (path: string) => files[path] },
        resolveAsync: async (specifier: string, base: string) =>
          specifier.startsWith('/') ? specifier : new URL(specifier, `file://${base}/`).pathname,
      },
    },
  } as unknown as ITranspilationContext;
}

async function compile(ctx: ITranspilationContext): Promise<string> {
  const result = await new CSSTransformer().transform(ctx, {});
  if (result instanceof Error) throw result;
  return result.code;
}

it('points fontsource url()s at the resolved package version (prod chat 1a119235)', async () => {
  const code = await compile(context('/node_modules/@fontsource/unifrakturmaguntia/400.css', FONTSOURCE));
  const base = 'https://unpkg.com/@fontsource/unifrakturmaguntia@5.2.8/files/unifrakturmaguntia-latin-400-normal';
  expect(code).toContain(`url("${base}.woff2") format("woff2")`);
  expect(code).toContain(`url("${base}.woff") format("woff")`);
  expect(code).not.toContain('url("./files');
});

it('rebases package stylesheets imported from app CSS against their own directory', async () => {
  const files = {
    '/node_modules/katex/dist/katex.css': '@import "./fonts.css"; .katex { cursor: url(cursor.cur), auto; }',
    '/node_modules/katex/dist/fonts.css':
      '@font-face { font-family: KaTeX_Main; src: url(fonts/KaTeX_Main-Regular.woff2) format("woff2"); }' +
      '.k { background: image-set("img/a.png" 1x, url(img/b.png) 2x); filter: url(#glow); mask: url(data:image/png;base64,AA==); }',
  };
  const code = await compile(context('/src/app.css', '@import "/node_modules/katex/dist/katex.css"; .app { background: url(./bg.png); }', files));
  const root = 'https://unpkg.com/katex@0.16.22/dist/';
  expect(code).toContain(`url("${root}fonts/KaTeX_Main-Regular.woff2")`);
  expect(code).toContain(`url("${root}cursor.cur")`);
  expect(code).toContain(`"${root}img/a.png" 1x`);
  expect(code).toContain(`"${root}img/b.png" 2x`);
  expect(code).toContain('url("#glow")');
  expect(code).toContain('url("data:image/png;base64,AA==")');
  // App files are not package files: their references stay as written.
  expect(code).toContain('url("./bg.png")');
});

it('only rebases relative references that stay inside a pinned package', () => {
  const base = packageCssBase('/node_modules/katex/dist/katex.css', registry)!;
  expect(base).toEqual({ root: 'https://unpkg.com/katex@0.16.22/', base: 'https://unpkg.com/katex@0.16.22/dist/' });
  expect(rebasePackageUrl('../fonts/a.woff2?#iefix', base)).toBe('https://unpkg.com/katex@0.16.22/fonts/a.woff2?#iefix');
  expect(rebasePackageUrl('../../react/x.png', base)).toBe('../../react/x.png');
  for (const url of ['https://cdn.test/a.png', '//cdn.test/a.png', '/a.png', '#a', 'data:,x', '']) {
    expect(rebasePackageUrl(url, base)).toBe(url);
  }
  expect(packageCssBase('/src/app.css', registry)).toBeNull();
  expect(packageCssBase('/node_modules/ranged/a.css', registry)).toBeNull();
  expect(packageCssBase('/node_modules/katex/a #b?/c.css', registry)?.base).toBe('https://unpkg.com/katex@0.16.22/a%20%23b%3F/');
  expect(packageCssBase('/node_modules/katex/a.css', undefined)).toBeNull();
  expect(packageCssBase('/node_modules/prerelease/a.css', registry)?.root).toBe('https://unpkg.com/prerelease@19.0.0-rc.1+build.5/');
  expect(packageCssBase('/node_modules/missing/a.css', registry)).toBeNull();
});

it('edits only reference tokens and keeps every other source byte', () => {
  const base = packageCssBase('/node_modules/@scope/kit/dist/css/kit.css', {
    modules: new Map([['@scope/kit', { version: '2.1.0', pinned: true }]]),
  })!;
  const lines = (urls: string[]) => [
    '/* Žluťoučký kůň url(./comment.png) */\r',
    '@import url(./other.css) layer(base);',
    '@namespace svg url(http://www.w3.org/2000/svg);',
    '@custom-variant dark (&:where(.dark, .dark *));',
    `@theme { --font-x: "Inter"; --bg: ${urls[0]}; }`,
    `.a { @apply px-2; background: ${urls[1]} no-repeat; }`,
    `.b { cursor: ${urls[2]}, auto; content: "url(./not.png)"; }`,
    `.c { mask: ${urls[3]}; filter: url(#glow); --icon: ${urls[4]}; }`,
    `.d { background-image: image-set(${urls[5]} type("image/avif") 1x, ${urls[6]} 2x); }`,
    `@font-face { font-family: K; src: ${urls[7]} format("woff2"), url(data:font/woff2;base64,AA==); }`,
    '.e { background: url(../../../escape.png); }',
    `.broken { color: ; background: ${urls[8]} }}} .x{`,
  ].join('\n');
  const css = 'https://unpkg.com/@scope/kit@2.1.0/dist/css/';
  const source = lines([
    'url(../img/bg.png)', 'url( "./a b.png" )', "url('./q\\'s.cur')", 'url(./x.svg#frag)', 'url(./i.svg)',
    '"./a.avif"', 'url(./b.png)', 'url(../fonts/k.woff2?v=1#iefix)', 'url(./ok.png)',
  ]);
  expect(rebasePackageCssUrls(source, base)).toBe(lines([
    'url(https://unpkg.com/@scope/kit@2.1.0/dist/img/bg.png)', `url(${css}a%20b.png)`, `url(${css}q\\'s.cur)`,
    `url(${css}x.svg#frag)`, `url(${css}i.svg)`, `"${css}a.avif"`, `url(${css}b.png)`,
    'url(https://unpkg.com/@scope/kit@2.1.0/dist/fonts/k.woff2?v=1#iefix)', `url(${css}ok.png)`,
  ]));
});

it('leaves stylesheets without relative references untouched', () => {
  const base = packageCssBase('/node_modules/katex/dist/katex.css', registry)!;
  for (const source of ['', '.a{color:red}', '@import "tailwindcss";', '.a{background:url(https://cdn.test/a.png)}']) {
    expect(rebasePackageCssUrls(source, base)).toBe(source);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCss, cssNeedsTailwind } from '../dist/css.js';

for (const css of [
  '@import "tailwindcss";',
  "@import 'tailwindcss/utilities' layer(utilities);",
  '@import /* between tokens */ url( "tailwindcss" ) layer(utilities);',
  '@import url(tailwindcss);',
  String.raw`@import "\74 ailwindcss";`,
  String.raw`@import url(tailwind\63ss);`,
  String.raw`@import u\72l("tailwindcss");`,
  String.raw`@\69mport "tailwindcss";`,
  '@import "tailwindcss" source(none) prefix(tw);',
  '@import "tailwindcss" supports(display:grid) source(none);',
  '@import "tailwindcss" source("./folder;with-semicolon");',
  '@tailwind /* layer */ utilities;',
  '.label { @apply font-bold; }',
  '@media print { .label { @apply p-4; } }',
  '@theme { --color-brand: #123456; }',
  '@custom-variant dark (&:where(.dark, .dark *));',
  '@reference "tailwindcss";',
]) {
  test(`recognizes parsed compiler syntax: ${css}`, () => assert.equal(cssNeedsTailwind(css), true));
}

for (const css of [
  '/* @import "tailwindcss"; @apply font-bold; */',
  '.example::after { content: "@apply font-bold;"; }',
  '.example::after { content: \'@import "tailwindcss";\'; }',
  '[data-example="@theme"] { color: red; }',
  ':root { --example: { @apply font-bold; }; }',
  ':root { --example: "@import tailwindcss"; }',
  'a { background: url("data:image/svg+xml,<svg><!-- @apply p-4; --></svg>"); }',
  '@import "tailwindcss-other";',
  '@import "./tailwindcss.css";',
  '@import "https://example.com/tailwindcss";',
  '@tailwind unknown;',
  '@theme-extra { color: red; }',
  '@layer utilities { .bold { font-weight: 700; } }',
]) {
  test(`ignores non-directive text: ${css}`, () => {
    const result = analyzeCss(css);
    assert.equal(result.requiresTailwind, false);
    assert.equal(result.css, css);
    assert.deepEqual(result.tailwindImports, []);
  });
}

test('removes only parsed framework nodes and preserves every other byte', () => {
  const before = '/* license @apply p-4; */\r\n';
  const between = '\r\n/* keep this */\r\n';
  const after = '\r\n.example { content: \'@import "tailwindcss";\'; --demo: { @apply p-4; }; }\r\n';
  const first = '@import /* framework */ "tailwindcss/utilities" layer(utilities);';
  const second = '@tailwind /* legacy */ utilities;';
  const result = analyzeCss(before + first + between + second + after);
  assert.equal(result.css, before + first + between + after);
  assert.equal(result.restoreImports(result.resolverCss), result.css);
  assert.deepEqual(result.tailwindImports, [first]);
});

test('preserves every import option, including semicolons inside strings', () => {
  const imports = [
    '@import "tailwindcss/theme" layer(theme);',
    '@import "tailwindcss/utilities" source("./a;b") prefix(tw);',
  ];
  const result = analyzeCss(imports.join('\n'));
  assert.deepEqual(result.tailwindImports, imports);
  assert.equal(result.css, imports.join('\n'));
  assert.equal(result.restoreImports(result.resolverCss), result.css);
});

test('does not remove modern @tailwind options or an unknown layer', () => {
  const css = '@tailwind utilities source(none); @tailwind unknown;';
  assert.equal(analyzeCss(css).css, css);
});

test('only actual resource syntax invokes CSS resolution', () => {
  for (const css of ['/* @import "a.css"; url(x) */', 'a{content:"url(x) @import"}', '[data-x="url(x)"]{}', '@import url(tailwindcss);']) {
    assert.equal(analyzeCss(css).requiresResolution, false, css);
  }
  for (const css of ['@import "./a.css";', String.raw`@\69mport "./a.css";`, 'a{background:url(x.png)}', ':root{--image:url(x.png)}', String.raw`a{background:u\72l("x.png")}`]) {
    assert.equal(analyzeCss(css).requiresResolution, true, css);
  }
});

test('normalizes parsed escaped imports and directives for the browser compiler', () => {
  const result = analyzeCss(String.raw`@\69mport url(\74 ailwindcss) layer(utilities); a{ @\61pply p-4; }`);
  assert.equal(result.css, '@import "tailwindcss" layer(utilities); a{ @apply p-4; }');
});

test('preserves layer declaration and import positions through CSS resolution', () => {
  const source = '@layer overrides, theme;\n@import "tailwindcss/theme" layer(theme);\n@import "./extra.css";';
  const result = analyzeCss(source);
  const resolved = result.resolverCss.replace('@import "./extra.css";', '.extra{color:red}');
  assert.equal(result.restoreImports(resolved), source.replace('@import "./extra.css";', '.extra{color:red}'));
});

test('import placeholders cannot replace authored at-rules or string examples', () => {
  const source = '@--sandpack-tailwind-import-0; @import "tailwindcss"; a{content:"@--sandpack-tailwind-import-1;"}';
  const result = analyzeCss(source);
  assert.equal(result.restoreImports(result.resolverCss), source);
});

test('restores inherited import conditions without dropping compiler options', () => {
  const result = analyzeCss('@import "tailwindcss/utilities" source(none);');
  const resolved = result.resolverCss.slice(0, -1) + ' layer(shell) supports(display:grid) print;';
  assert.equal(result.restoreImports(resolved), '@layer shell {@supports (display:grid) {@media print {@import "tailwindcss/utilities" source(none);}}}');
});

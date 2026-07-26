import test from 'node:test';
import assert from 'node:assert/strict';

import { transformFile, isTransformable, selectReactChain } from '../dist/index.js';

test('returns code+deps for a covered app-root file', async () => {
  const result = await transformFile({ path: '/app/src/x.tsx', code: 'export default () => <div/>;' });
  assert.ok(!('error' in result));
  assert.equal(typeof result.code, 'string');
  assert.ok(Array.isArray(result.deps));
});

test('error-omission: a Babel error returns { error }, never throws', async () => {
  const result = await transformFile({ path: '/app/src/bad.tsx', code: 'const = =;' });
  assert.ok('error' in result, 'expected an error result');
  assert.equal(result.error.filepath, '/app/src/bad.tsx');
  assert.equal(typeof result.error.message, 'string');
  assert.ok(!('code' in result), 'a failure result omits code');
});

test('error-omission: an unsupported extension returns { error }', async () => {
  const result = await transformFile({ path: '/app/src/styles.css', code: 'a{}' });
  assert.ok('error' in result);
  assert.match(result.error.message, /No transformer/);
});

test('chain selection mirrors ReactPreset.mapTransformers', () => {
  // app-root jsx/tsx/js -> react-refresh
  assert.equal(selectReactChain('/app/src/App.tsx').variant, 'react-refresh');
  assert.equal(selectReactChain('/app/a.jsx').variant, 'react-refresh');
  assert.equal(selectReactChain('/app/a.js').variant, 'react-refresh');
  // app-root .md/.mdx -> react-refresh + MDX precompile flag
  assert.equal(selectReactChain('/app/content/post.mdx').variant, 'react-refresh');
  assert.equal(selectReactChain('/app/content/post.mdx').mdx, true);
  assert.equal(selectReactChain('/app/content/post.md').mdx, true);
  // bare .ts -> plain (not in the app-root refresh extension set), no mdx flag
  assert.equal(selectReactChain('/app/a.ts').variant, 'plain');
  assert.equal(selectReactChain('/app/a.tsx').mdx, undefined);
  // anything under /node_modules/ -> plain; .mdx under node_modules is owned by no branch
  assert.equal(selectReactChain('/node_modules/pkg/index.js').variant, 'plain');
  assert.equal(selectReactChain('/node_modules/pkg/index.tsx').variant, 'plain');
  assert.equal(selectReactChain('/node_modules/pkg/readme.mdx'), null);
  // .d.ts and non-source -> not owned
  assert.equal(selectReactChain('/app/types.d.ts'), null);
  assert.equal(selectReactChain('/app/styles.css'), null);
});

test('isTransformable matches the covered source extensions (incl. app-root .md/.mdx)', () => {
  for (const p of ['/app/a.ts', '/app/a.tsx', '/app/a.js', '/app/a.jsx', '/app/a.mjs', '/app/a.cts', '/app/a.mdx', '/app/a.md']) {
    assert.equal(isTransformable(p), true, p);
  }
  for (const p of ['/app/a.d.ts', '/app/a.css', '/app/a.json', '/node_modules/p/r.mdx']) {
    assert.equal(isTransformable(p), false, p);
  }
});

test('transforms an .mdx file: code + provider dep, react-refresh wrapped', async () => {
  const code = '---\ntitle: Hi\n---\n\n# Hello\n\nSome **text**.\n';
  const result = await transformFile({ path: '/app/content/post.mdx', code });
  assert.ok(!('error' in result), 'mdx should transform without error');
  assert.equal(typeof result.code, 'string');
  // The MDX compile injects the provider import; Babel lowers it to a require the
  // dep-collector records (MDX_CONTENT_COLLECTIONS_SPEC §1.2).
  assert.ok(
    result.deps.includes('@immediately-run/sdk/MDXProvider'),
    `expected provider dep, got ${JSON.stringify(result.deps)}`,
  );
  // app-root .mdx is HMR-instrumented like a .tsx: the react-refresh wrap adds the
  // HMR helper module (an absolute `/…` specifier) to deps.
  assert.ok(
    result.deps.some((d) => d.startsWith('/')),
    `expected the react-refresh HMR helper dep, got ${JSON.stringify(result.deps)}`,
  );
});

test('frontmatter is stripped before MDX compile (no YAML leaks into output)', async () => {
  const code = '---\nsecretKey: do-not-render\n---\n\n# Title\n';
  const result = await transformFile({ path: '/app/content/fm.mdx', code });
  assert.ok(!('error' in result));
  assert.ok(!result.code.includes('secretKey'), 'frontmatter must not appear in compiled output');
});

test('error-omission: malformed MDX returns { error }, never throws', async () => {
  // An unterminated JSX expression is an MDX compile error.
  const result = await transformFile({ path: '/app/content/bad.mdx', code: '# Hi\n\n<Unclosed\n' });
  assert.ok('error' in result, 'expected an error result');
  assert.equal(result.error.filepath, '/app/content/bad.mdx');
  assert.equal(typeof result.error.message, 'string');
  assert.ok(!('code' in result));
});

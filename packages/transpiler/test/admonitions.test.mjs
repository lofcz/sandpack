// GitHub-style admonitions (MARKDOWN_SYNTAX_SPEC §12, R3-152).
//
// The in-house remark plugin rewrites `> [!TYPE]` blockquotes into
// `<Admonition type="…">` — a component (§11), NOT intrinsic HTML — so a plain
// repo renders the SDK's default `Admonition` (shipped by R3-151) with no throw.
// These assertions exercise `compileMdx` directly (the MDX→JSX stage both the
// browser sandbox and the CLI share); byte-identity of the whole chain is pinned
// separately by the parity corpus (`admonition-mdx` in parity.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';

import { compileMdx } from '../dist/index.js';

const compile = (src) => compileMdx(src, '/app/content/t.mdx');

// `compileMdx` emits JSX (pre-Babel): a provider component is a bare capitalized
// tag (`<Admonition …>`, destructured from `_components`), an intrinsic element
// is `<_components.blockquote>`. (The full Babel chain later lowers these to
// `_jsxDEV(_components.X, …)`; that form is pinned by the parity corpus instead.)
const asAdmonition = (out) => /<Admonition\b/.test(out);
const asBlockquote = (out) => /<_components\.blockquote\b/.test(out);
const typeAttr = (out) => {
  const m = out.match(/<Admonition type="([a-z]+)"/);
  return m ? m[1] : null;
};

test('§12: each GitHub alert type compiles to <Admonition type="…">', async () => {
  const types = [
    ['NOTE', 'note'],
    ['TIP', 'tip'],
    ['IMPORTANT', 'important'],
    ['WARNING', 'warning'],
    ['CAUTION', 'caution'],
  ];
  for (const [marker, expected] of types) {
    const out = await compile(`> [!${marker}]\n> Body text.`);
    assert.ok(asAdmonition(out), `${marker} should compile to an Admonition`);
    assert.ok(!asBlockquote(out), `${marker} should not stay a blockquote`);
    assert.equal(typeAttr(out), expected, `${marker} → type="${expected}"`);
  }
});

test('§12: an ordinary blockquote is unchanged (no Admonition)', async () => {
  const out = await compile(`> Just a normal quote.\n> Second line.`);
  assert.ok(asBlockquote(out), 'ordinary blockquote stays a blockquote');
  assert.ok(!asAdmonition(out), 'ordinary blockquote is not an Admonition');
});

test('§12: an unrecognized marker type stays a blockquote', async () => {
  const out = await compile(`> [!FOOBAR]\n> nope.`);
  assert.ok(asBlockquote(out));
  assert.ok(!asAdmonition(out));
});

test('§12: a marker not alone on its line stays a blockquote (GitHub semantics)', async () => {
  const out = await compile(`> [!NOTE] inline text on the same line.`);
  assert.ok(asBlockquote(out), 'marker + inline content on one line is an ordinary quote');
  assert.ok(!asAdmonition(out));
});

test('§12: a marker-only blockquote yields an Admonition with no body', async () => {
  const out = await compile(`> [!NOTE]`);
  assert.ok(asAdmonition(out));
  assert.equal(typeAttr(out), 'note');
});

test('§12: matching is case-insensitive (per GitHub), type is lower-cased', async () => {
  const out = await compile(`> [!Note]\n> mixed case marker.`);
  assert.ok(asAdmonition(out));
  assert.equal(typeAttr(out), 'note');
});

test('§12: inline formatting in the admonition body is preserved', async () => {
  const out = await compile(`> [!WARNING]\n> **Bold** body with a [link](https://x.com).`);
  assert.ok(asAdmonition(out));
  assert.equal(typeAttr(out), 'warning');
  assert.ok(/<_components\.strong\b/.test(out), 'strong survives');
  assert.ok(/https:\/\/x\.com/.test(out), 'link survives');
});

test('§12: a plain repo renders without a missing-reference throw at compile', async () => {
  // The compile stage must not itself throw on platform-emitted components; the
  // phantom default (R3-151) makes render-time safe, but compile is unconditional.
  await assert.doesNotReject(compile(`> [!TIP]\n> works with zero app cooperation.`));
});

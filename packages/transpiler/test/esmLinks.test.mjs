// ESM expressions in links (MARKDOWN_SYNTAX_SPEC §14, R3-154).
//
// No compiler change: link DESTINATIONS stay literal (a dynamic URL uses JSX
// `<a href={fn()}>`). These tests LOCK the four established behaviors so a future
// `@mdx-js/mdx` bump can't silently regress them (byte-identity of the whole chain
// is additionally pinned by the `esm-links-mdx` parity fixture).
import test from 'node:test';
import assert from 'node:assert/strict';

import { compileMdx } from '../dist/index.js';

const compile = (src) => compileMdx(src, '/app/content/t.mdx');

test('§14.1: a link LABEL expression is evaluated — [{fn()}](url) → <a href="url">{fn()}</a>', async () => {
  const out = await compile(`[{dynamicLinkLabel()}](http://mysite.com)`);
  // The href is the literal URL; the label is the live expression.
  assert.match(out, /href="http:\/\/mysite\.com"/);
  assert.match(out, /\{dynamicLinkLabel\(\)\}/);
  // The expression is NOT stringified/escaped into the label text.
  assert.doesNotMatch(out, /"\{dynamicLinkLabel/);
});

test('§14.2: a link DESTINATION expression is NOT evaluated — it is literal, URL-encoded', async () => {
  const out = await compile(`[Click here]({dynamicUrl()})`);
  // `{dynamicUrl()}` is treated as literal URL text and percent-encoded, never run.
  assert.match(out, /href="%7BdynamicUrl\(\)%7D"/);
  assert.doesNotMatch(out, /href=\{dynamicUrl/); // not an expression
});

test('§14.2: the supported dynamic-URL form is JSX — <a href={fn()}> keeps the expression', async () => {
  const out = await compile(`<a href={dynamicUrl()}>Click here</a>`);
  assert.match(out, /href=\{dynamicUrl\(\)\}/); // href is a live expression
});

test('§14.3: a dynamic wiki target is NOT supported — [[{fn()}]] is not a <WikiLink>', async () => {
  const out = await compile(`[[{someFilename()}]]`);
  assert.doesNotMatch(out, /<WikiLink\b/); // no wiki-link element
  // The `{…}` splits the text node, so the plugin never matches `[[ … ]]`; the
  // literal brackets survive around the (ordinary MDX) expression.
  assert.match(out, /\{someFilename\(\)\}/);
});

test('§14.3: the supported dynamic-target form is JSX — <WikiLink target={fn()} /> compiles', async () => {
  const out = await compile(`<WikiLink target={someFilename()} />`);
  assert.match(out, /target=\{someFilename\(\)\}/);
});

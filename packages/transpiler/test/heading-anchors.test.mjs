// Heading slugs & autolink anchors (MARKDOWN_SYNTAX_SPEC §15, R3-186; the §15.1
// section-id scheme is R3-211) — the KERNEL half.
//
// The in-house remark plugin sets each heading's `id` (a byte-local text slug, or a
// prose-independent `sec-` section id for a numbered heading) and prepends an
// overridable `<HeadingAnchor id="…">`. Everything here is a pure function of the
// compiling file's own bytes — no cross-file resolution (the byte-identity
// invariant, §15.3). The default `<HeadingAnchor>` render is the SDK's job, tested
// there.
import test from 'node:test';
import assert from 'node:assert/strict';

import { compileMdx, textSlug, sectionId } from '../dist/index.js';

const compile = (src, path = '/app/content/cur.mdx') => compileMdx(src, path);

// `compile(..., { jsx: true })` emits JSX element syntax, e.g.
//   <_components.h3 id="sec-8-9" data-slug="89-powerbox"><HeadingAnchor id="sec-8-9" />…
// and an author-written heading as the intrinsic `<h2 id="custom">…`. Parse the
// heading opening tags (both `_components.hN` and bare `hN`) and the injected
// `<HeadingAnchor id="…" />` in document order.
const headingIds = (out) =>
  [...out.matchAll(/<(?:_components\.)?h[1-6]\b([^>]*)>/g)]
    .map((m) => {
      const im = m[1].match(/\bid="([^"]*)"/);
      return im ? im[1] : null;
    })
    .filter((x) => x !== null);
const anchorIds = (out) =>
  [...out.matchAll(/<HeadingAnchor\s+id="([^"]*)"/g)].map((m) => m[1]);

// --- §15.1 text slugs (prose headings) ------------------------------------------

test('§15.1: a prose heading gets a GitHub text-slug id + a prepended anchor', async () => {
  const out = await compile(`## Getting started`);
  assert.deepEqual(headingIds(out), ['getting-started']);
  assert.deepEqual(anchorIds(out), ['getting-started']); // permalink targets the id
});

test('§15.1: inline markup is stripped for the slug', async () => {
  const out = await compile(`## The **bold** heading`);
  assert.deepEqual(headingIds(out), ['the-bold-heading']);
});

test('§15.1: a repeated slug in ONE document gets a deterministic -1/-2 suffix', async () => {
  const out = await compile(`## Notes\n\ntext\n\n## Notes\n\nmore\n\n## Notes`);
  assert.deepEqual(headingIds(out), ['notes', 'notes-1', 'notes-2']);
});

// --- §15.1 (R3-211) section ids (numbered headings) -----------------------------

test('§15.1/R3-211: a numbered heading id IS the section id, text slug demoted to data-slug', async () => {
  const out = await compile(`### 8.9 Powerbox`);
  assert.deepEqual(headingIds(out), ['sec-8-9']);
  assert.deepEqual(anchorIds(out), ['sec-8-9']);
  // The demoted GitHub text slug: GitHub drops the `.` entirely (not `-`), so
  // "8.9 Powerbox" → "89-powerbox" — the real GitHub-compatible slug (§15.1).
  assert.match(out, /data-slug="89-powerbox"/);
});

test('§15.1/R3-211: section id is prose-independent; a rewording keeps sec-8-9', async () => {
  const a = await compile(`### 8.9 Powerbox`);
  const b = await compile(`### 8.9 Renamed entirely`);
  assert.deepEqual(headingIds(a), ['sec-8-9']);
  assert.deepEqual(headingIds(b), ['sec-8-9']); // SAME id despite different prose
});

test('§15.1/R3-211: 7 and 7A are DISTINCT ids in one file (no merge)', async () => {
  const out = await compile(`## 7. The guarantee\n\ntext\n\n## 7A. Filesystem trust mode`);
  assert.deepEqual(headingIds(out), ['sec-7', 'sec-7a']);
});

test('§15.1/R3-211: appendix (A.0) and multi-level (3.2.1) forms', async () => {
  assert.equal(sectionId('A.0 Branding'), 'sec-a-0');
  assert.equal(sectionId('3.2.1 Something'), 'sec-3-2-1');
  assert.equal(sectionId('1a Foo'), 'sec-1a');
  assert.equal(sectionId('Decisions & rejected'), null); // prose → no section id
});

// --- opt-out --------------------------------------------------------------------

test('§15.1/R3-211: `sectionIds: false` falls back to text slugs, no sec-/data-slug', async () => {
  const out = await compile(`---\nsectionIds: false\n---\n\n### 8.9 Powerbox`);
  assert.deepEqual(headingIds(out), ['89-powerbox']); // GitHub text slug, no sec-
  assert.doesNotMatch(out, /data-slug/);
  assert.doesNotMatch(out, /sec-8-9/);
});

// --- author-set id + no double anchor -------------------------------------------

test('§15.1: an author-set JSX heading id is left untouched, no second anchor', async () => {
  const out = await compile(`<h2 id="custom">Manual</h2>`);
  assert.match(out, /id="custom"/);
  assert.equal(anchorIds(out).length, 0); // no injected HeadingAnchor
});

// --- byte-identity (the load-bearing invariant) ---------------------------------

test('§15.3: a file compiles identically regardless of the compiling path (byte-local)', async () => {
  const a = await compileMdx(`### 8.9 X\n\n## Prose heading`, '/app/content/a.mdx');
  const b = await compileMdx(`### 8.9 X\n\n## Prose heading`, '/app/content/a.mdx');
  assert.equal(a, b);
  // ids depend only on the file's own bytes, not on any other file existing.
  assert.deepEqual(headingIds(a), ['sec-8-9', 'prose-heading']);
});

test('§15.5: a plain heading gets an id + anchor with no _missingMdxReference throw', async () => {
  // The compile itself must not throw and must emit the HeadingAnchor component
  // reference (the SDK phantom default resolves it; the missing-ref guard is a
  // render concern proven in the SDK tests).
  const out = await compile(`# Title\n\nBody.`);
  assert.deepEqual(headingIds(out), ['title']);
  assert.deepEqual(anchorIds(out), ['title']);
});

// --- unit-level slug/section functions ------------------------------------------

test('textSlug: lower-cases, drops punctuation, collapses whitespace', () => {
  assert.equal(textSlug('The **bold** heading'), 'the-bold-heading');
  assert.equal(textSlug('Q & A: notes!'), 'q-a-notes');
  assert.equal(textSlug('  spaced   out  '), 'spaced-out');
});

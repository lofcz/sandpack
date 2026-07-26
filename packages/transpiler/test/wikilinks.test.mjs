// WikiLinks (MARKDOWN_SYNTAX_SPEC §13, R3-153) — the KERNEL half.
//
// The in-house remark plugin turns `[[target]]` / `[[label|target]]` into a
// `<WikiLink target="…" label="…">` node carrying the RAW target/label — it
// resolves NOTHING against other files, so a file's compiled output depends only
// on its own bytes (the byte-identity invariant, §13.2). Existence-driven
// resolved/broken/self state is the SDK component's job (§13.3), tested there.
import test from 'node:test';
import assert from 'node:assert/strict';

import { compileMdx } from '../dist/index.js';

const compile = (src) => compileMdx(src, '/app/content/cur.mdx');

const wikiLinks = (out) => [...out.matchAll(/<WikiLink\s([^>]*?)\s*\/>/g)].map((m) => m[1]);
const attr = (frag, name) => {
  const m = frag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
};

test('§13: `[[target]]` → <WikiLink target="…"> with the raw target, no label', async () => {
  const out = await compile(`[[another.mdx]]`);
  const links = wikiLinks(out);
  assert.equal(links.length, 1);
  assert.equal(attr(links[0], 'target'), 'another.mdx');
  assert.equal(attr(links[0], 'label'), null);
});

test('§13.2: the kernel carries only target/label — no resolution, no file path', async () => {
  // Resolution (incl. the current-file base) is the SDK component's job, derived
  // from routing context — the kernel emits only the raw target/label.
  const a = await compileMdx(`[[rel.mdx]]`, '/app/content/sub/here.mdx');
  const b = await compileMdx(`[[rel.mdx]]`, '/app/other/place.mdx');
  const fragA = wikiLinks(a)[0];
  assert.equal(attr(fragA, 'target'), 'rel.mdx');
  assert.equal(attr(fragA, 'from'), null); // no file-path attribute is emitted
  // The emitted <WikiLink> is identical regardless of the compiling path.
  assert.equal(wikiLinks(a)[0], wikiLinks(b)[0]);
});

test('§13: `[[label|target]]` carries label (first) and target (second) verbatim', async () => {
  const out = await compile(`[[My Favorite Link|target.mdx]]`);
  const [frag] = wikiLinks(out);
  assert.equal(attr(frag, 'label'), 'My Favorite Link');
  assert.equal(attr(frag, 'target'), 'target.mdx');
});

test('§13: an absolute target is carried verbatim (no resolution)', async () => {
  const out = await compile(`[[/app/docs/x.mdx]]`);
  const [frag] = wikiLinks(out);
  assert.equal(attr(frag, 'target'), '/app/docs/x.mdx');
});

test('§13: multiple `[[…]]` in one line each become a WikiLink, text preserved', async () => {
  const out = await compile(`See [[a.mdx]] and [[b.mdx]] here.`);
  const links = wikiLinks(out);
  assert.deepEqual(
    links.map((f) => attr(f, 'target')),
    ['a.mdx', 'b.mdx'],
  );
  assert.match(out, /"See "/);
  assert.match(out, /" and "/);
  assert.match(out, /" here\."/);
});

test('§13.4: `[[a|b.mdx]]` yields the SAME WikiLink in and out of a GFM table', async () => {
  const inPara = await compile(`[[a|b.mdx]]`);
  // Inside a table the pipe is escaped (standard GFM literal-pipe escape); by the
  // time the plugin runs the cell text is a plain `[[a|b.mdx]]` again.
  const inTable = await compile(`| h |\n| - |\n| [[a\\|b.mdx]] |`);
  const p = wikiLinks(inPara)[0];
  const t = wikiLinks(inTable)[0];
  assert.equal(attr(p, 'label'), 'a');
  assert.equal(attr(p, 'target'), 'b.mdx');
  assert.equal(attr(t, 'label'), 'a');
  assert.equal(attr(t, 'target'), 'b.mdx');
});

test('§13.2: byte-locality — output depends only on the file, not on other files', async () => {
  // compileMdx takes only (code, path); it has no filesystem access, so a link to
  // a non-existent target compiles identically to any run — "file A compiles the
  // same whether or not file B exists". Determinism across calls is the proxy.
  const src = `[[does/not/exist.mdx]] and [[neither.mdx]]`;
  const a = await compile(src);
  const b = await compile(src);
  assert.equal(a, b);
  assert.equal(wikiLinks(a).length, 2);
});

test('§13: an ordinary markdown link is untouched', async () => {
  const out = await compile(`An [ordinary link](https://example.com).`);
  assert.equal(wikiLinks(out).length, 0);
  assert.match(out, /https:\/\/example\.com/);
});

test('§13: `[[…]]` inside an inline code span stays literal', async () => {
  const out = await compile('inline `[[code]]` span');
  assert.equal(wikiLinks(out).length, 0);
});

test('§13: `[[]]` with no target is left as literal text', async () => {
  const out = await compile(`empty [[]] stays literal`);
  assert.equal(wikiLinks(out).length, 0);
});

test('§13: a plain repo renders wiki-links with no compile throw', async () => {
  await assert.doesNotReject(compile(`[[works.mdx]] with zero app cooperation`));
});

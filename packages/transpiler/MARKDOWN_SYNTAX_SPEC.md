# immediately.run Markdown / MDX syntax — the v1 authoring target

**Status:** draft — the v1 MDX support target (built surface + v1 proposals) · **Updated:** 2026-07-05

> **This document is now two things at once.** §1–§9 are `reference` — hand-mirrored
> from the shipped compile chain (`src/mdx/`), describing what the code compiles
> *today*. §11 (the component-resolution model) is now also `reference` — the
> phantom-defaults + `boot()` merge mechanism it describes shipped in the SDK
> (R3-151, `@immediately-run/sdk` ≥ 0.23.0). §12 (admonitions) is `reference` too —
> the in-house remark plugin it describes shipped in this package (R3-152,
> `src/mdx/remarkAdmonitions.ts`). §13 (wiki-links) is `reference` too — the kernel
> `[[…]]` plugin shipped here (R3-153, `src/mdx/remarkWikiLinks.ts`) and the default
> resolving `<WikiLink>` shipped in the SDK. §14 (ESM-in-links) is `reference` too —
> its supported/rejected forms are confirmed and locked by a golden test (R3-154);
> no compiler change was needed (link destinations stay literal; dynamic URLs/targets
> use JSX). §11–§15 have all landed and are `reference`. **§15 (heading slugs &
> autolinks) SHIPPED 2026-07-10 (R3-186 + R3-211, `src/mdx/remarkHeadingAnchors.ts`
> + the SDK default `<HeadingAnchor>`)** — it *reversed* the earlier "no heading
> anchors / slugs, no v1 change planned" call recorded in §7 and Decisions (see that
> reversal for the rationale), and §15.1 carries the R3-211 section-id scheme. Every §-block carries a *(reference)* or
> *(proposal — …)* label; **never read a proposal block as describing shipped
> behavior.** When a proposal lands, its block flips to *(reference)* in the same edit
> that ships it.

> **Reads first:** `src/mdx/compile.ts` (the `@mdx-js/mdx` compile call §1 describes),
> `src/mdx/frontmatter.ts` (the frontmatter/excerpt parser), `src/presets/react.ts`
> (which paths are treated as MDX). For the v1 proposals also read:
> `BOOT_SCAFFOLDING_SPEC.md §4` (the read-only boot-defaults layer the phantom-component
> model in §11 extends), `MDX_CONTENT_COLLECTIONS_SPEC.md §1.1` (the byte-identity
> constraint every new remark plugin must preserve), and `core_concepts.md §8` (content
> trust — MDX content is executable code). For the *pipeline* that consumes this output —
> the cache-zip artifact, the frontmatter sidecar, the boot snapshot — see the docs-repo
> `MDX_CONTENT_COLLECTIONS_SPEC.md`; **this document is only the author-facing syntax
> surface**, not the caching machinery.

The syntax an immediately.run app may use is what this package's `compileMdx` accepts.
Because the browser sandbox and the CLI both call `compileMdx`, the surface is identical
whether a file is transpiled live in the sandbox or pre-transpiled into a cache zip
(byte-identity is the whole point of the shared package — README,
`MDX_CONTENT_COLLECTIONS_SPEC §1.1`). The v1 proposals in this document are written to
**preserve that byte-identity** and the "a repo of plain markdown just works" guarantee
(`product_values.md` value 3); the invariants that protect both are stated inline and
gated in §10.

---

## 1. The compiler and what it implies  *(reference)*

Every `.md` / `.mdx` file is compiled by **[MDX](https://mdxjs.com) v3** (`@mdx-js/mdx`,
pinned in `package.json`) with the **GFM** remark plugin (`remark-gfm`). The exact call
(`src/mdx/compile.ts`):

```ts
compile(
  { path, value: content },      // `content` = source with frontmatter stripped (§3)
  {
    development: true,           // embeds the source path in jsxDEV debug info
    jsx: true,                   // emit JSX (Babel lowers it afterwards)
    providerImportSource: '@immediately-run/sdk/MDXProvider',  // component resolution (§6, §11)
    outputFormat: 'program',     // a module: `export default MDXContent`
    remarkPlugins: [[remarkGfm]],// GFM (§5); the v1 proposals add pinned plugins here (§12, §13)
    recmaPlugins: [],            // none
    rehypePlugins: [],           // none
  },
)
```

The consequences an author must know follow directly from these choices:

- The base grammar is **CommonMark** (§4), because that is what MDX parses.
- **GFM** is on (§5), because `remark-gfm` is in `remarkPlugins`.
- **JSX, `{expression}`, and ESM `import`/`export` are on** (§6), because the input is MDX,
  not plain Markdown. This is true for `.md` **and** `.mdx` — see §2.
- **No rehype/recma plugins are configured** (§7): there is *no* automatic heading-slug/anchor
  generation, *no* syntax highlighting, *no* raw-HTML re-parsing, and *no* smart-typography.
  Anything of that kind is the app's job (a component, or a plugin added in a fork).
- Components are resolved through the SDK **MDXProvider** (`providerImportSource`), so an
  undefined component is a **runtime error**, and Markdown links are routed through the SDK's
  in-app navigation by default (§6, generalized in §11).

---

## 2. Which files are MDX  *(reference)*

`src/presets/react.ts` routes a file to the MDX compile stage when its path matches
`MDX_APP_ROOT_RE = /^(?!\/node_modules\/).*\.mdx?$/i`:

- **Extensions:** `.md` **and** `.mdx`, matched **case-insensitively** (`.MD`, `.Mdx` work).
- **App-root only:** a `.md`/`.mdx` under `/node_modules/` is owned by **no** transform and is
  not compiled — content collections live in the app tree, not in dependencies.

> **`.md` is not plain CommonMark — it is full MDX.** There is no separate "plain Markdown"
> mode. A `.md` file goes through the exact same MDX compiler as `.mdx`. So a bare `<` or `{`
> in a `.md` file is interpreted as JSX / an expression, and the deviations in §8 apply to
> `.md` too. Author `.md` files as MDX.

---

## 3. Frontmatter  *(reference)*

Before compilation, a leading YAML **frontmatter** block is stripped by
`parseFrontmatter` (`src/mdx/frontmatter.ts`) and **never reaches the MDX compiler**:

````markdown
---
title: Hello MDX
tags:
  - intro
  - demo
draft: false
---

# The body starts here
````

- **Delimiters:** a first line of `---` (a leading BOM and trailing spaces/tabs on the fence
  are tolerated), closed by a line that is exactly `---`. The block must be at the very top of
  the file. `FRONTMATTER_RE` in `frontmatter.ts` is the exact matcher.
- **Grammar:** **YAML 1.2** (the `yaml` package), so nested maps, block/flow sequences, block
  scalars, and quoted strings all parse, and the "Norway problem" is avoided (`no` is the
  string `"no"`, **not** `false`). Only a top-level **map** is kept; a scalar/array/null
  document is ignored and the file is treated as having no frontmatter.
- **Malformed YAML throws.** The MDX compile path surfaces it as a compile error; the metadata
  scanners guard with try/catch and skip the file.

**Frontmatter is data, not props or exports.** It is **not** injected as `export const
frontmatter`, and it is **not** passed to the document as `props`. It is surfaced to the app
only through the SDK metadata hooks (`useFileMetadata`, `useMetadataQuery`, `useAllMetadata`).
Inside the body, `{props.title}` refers to whatever the renderer passed as `props` — which,
for a plain content page, does **not** include the frontmatter. Read frontmatter via the hooks.

### 3.1 The `<More />` excerpt marker

If the body contains the literal marker `<More />` after some non-empty leading text, that
leading text is lifted onto `data.excerpt` and, **together with the marker, removed from the
body that is compiled/rendered** (the following whitespace is trimmed). A `<More />` at the
very start of the body (offset 0) is left in place. This mirrors gray-matter's excerpt
behaviour and is implemented in `frontmatter.ts` (`EXCERPT_SEPARATOR = '<More />'`).

> **Honesty note:** because the prefix is *moved* to `excerpt` (not copied), text before
> `<More />` does not appear in the rendered document body — it lives only in the `excerpt`
> metadata field. Use `<More />` when you want a summary that is *distinct* from the body, not
> merely a "read more" fold of the same prose.

---

## 4. CommonMark (the base grammar)  *(reference)*

Everything CommonMark defines works, subject to the MDX deviations in §8:

| Construct | Syntax |
|---|---|
| Headings (ATX) | `# H1` … `###### H6` |
| Headings (Setext) | a line of text underlined by `===` (h1) or `---` (h2) |
| Bold / italic | `**bold**`, `*italic*` / `_italic_`, `***both***` |
| Inline code | `` `code` `` |
| Fenced code | ` ```lang ` … ` ``` ` (the info string is passed through; see §7 re: highlighting) |
| Blockquote | `> quoted` |
| Ordered / unordered list | `1. item` / `- item`, `* item`, `+ item` (nesting by indent) |
| Thematic break | `---`, `***`, or `___` on their own line |
| Link | `[text](https://example.com "title")` |
| Reference link | `[text][ref]` with `[ref]: https://example.com` |
| Image | `![alt](/path.png "title")` |
| Hard line break | two trailing spaces, or a backslash `\` at end of line |
| Character escape | `\*not italic\*` |

**Setext-vs-thematic-break caveat:** a `---` line *directly under* a non-blank line of text is
a Setext h2 underline, not a horizontal rule. Leave a blank line above `---` when you mean a
rule. (This is standard CommonMark, restated because it surprises authors.)

---

## 5. GFM extensions (`remark-gfm`)  *(reference)*

`remark-gfm` (in `remarkPlugins`) adds GitHub-Flavored Markdown on top of CommonMark:

- **Tables** —
  ```markdown
  | a | b |
  | - | - |
  | 1 | 2 |
  ```
  Column alignment via `:` in the delimiter row (`:-`, `-:`, `:-:`). Compiles to
  `<table><thead><tr><th>…</table>` (verified in this package's golden output).
- **Strikethrough** — `~~gone~~` → `<del>` (GFM single or double tilde).
- **Task lists** — `- [ ] todo` / `- [x] done` → checkbox list items.
- **Autolink literals** — bare `https://…`, `www.…`, and `name@example.com` become links
  without angle brackets. (This is the GFM-supported bare-URL form; the CommonMark
  `<https://…>` angle-bracket autolink is **not** reliable in MDX because `<` starts JSX —
  prefer the bare form or an explicit `[text](url)`.)
- **Footnotes** — `text[^1]` with a `[^1]: definition` block.

> **GFM admonitions are *not* part of GFM's remark plugin.** GitHub renders `> [!NOTE]`
> blockquote alerts on github.com, but `remark-gfm` does not implement them — today they
> render as a plain blockquote (§7). Adding them is the v1 target — see §12 (proposal).

---

## 6. MDX extensions — components, expressions, ESM  *(reference)*

Because the input is MDX, three non-Markdown constructs are available in the body.

### 6.1 JSX / components

Write JSX inline or as blocks:

```mdx
<Callout type="warn">Heads up.</Callout>

A self-closing component: <Hr />
```

- **Capitalized name → component; lowercase name → HTML element.** `<Callout>` is a component
  (resolved per §6.4 / §11); `<div>` is a literal `<div>`. This is JSX's rule, not a Markdown one.
- **Tags must be well-formed and closed.** MDX is XML-strict: `<br>` must be `<br/>`, every
  element must close, attributes are JSX (`className`, not `class`; `{expr}` for values).
- **Markdown inside a component's children is still parsed** when there is a blank line, per
  MDX's interleaving rules.

### 6.2 Expressions

`{ … }` embeds a JavaScript expression that is evaluated and rendered:

```mdx
# {props.title ?? 'Untitled'}

Two plus two is {2 + 2}.
```

`props` is the props object the renderer passes to the compiled `MDXContent` component. See
§3 — frontmatter is **not** in `props` by default. Expression support extends into link
*labels* (§14).

### 6.3 ESM `import` / `export`

Top-level `import` and `export` statements work and are hoisted to module scope:

```mdx
import Chart from './Chart';
export const columns = 3;

<Chart data={someData} />
```

`import`s become real module dependencies (the Babel dep-collector that runs after the MDX
stage records them, so a pre-transpiled artifact carries the right specifiers).

### 6.4 Component resolution via the MDXProvider

`providerImportSource: '@immediately-run/sdk/MDXProvider'` means a component that is used but
not `import`ed/`export`ed in the file is looked up from the surrounding **MDXProvider**
context (SDK `useMDXComponents`). Two consequences hold *today*:

- **A referenced-but-unprovided component is a runtime error** — MDX emits a
  `_missingMdxReference("Callout", …)` guard, so rendering `<Callout>` with no provider entry
  and no import throws *"Expected component `Callout` to be defined"*. Provide it (via the
  SDK `boot({ mdxComponents })` map) or `import` it.
- **Markdown links route in-app by default.** The SDK's `DEFAULT_MDX_COMPONENTS` overrides the
  `a` element with a `<Link>` that routes same-app hrefs through the sandbox router
  (`immediately-run-sdk/src/components/MDXComponents.tsx`). So `[docs](/guide)` navigates
  within the app instead of doing a full-page load; external hrefs render as a normal `<a>`.
  Any intrinsic element (`h1`, `p`, `td`, …) can likewise be overridden through the provider.

§11 generalizes this into the **component late-binding model** the v1 proposals build on.

### 6.5 Comments

Use an **expression comment**: `{/* this is a comment */}`. HTML comments (`<!-- … -->`) are
**not** valid MDX (§8).

---

## 7. What is *not* enabled in the built surface  *(reference)*

`recmaPlugins` and `rehypePlugins` are both empty and the only remark plugin is `remark-gfm`,
so none of the following happen at compile time *today* — provide them yourself (a component, a
fork adding a plugin, or app CSS/JS):

- **Heading anchors / slugs** — **SHIPPED (§15, R3-186 + R3-211)**: every heading gets an `id`
  (a GitHub text slug, or a `sec-…` section id for a numbered heading) plus an overridable autolink
  `<HeadingAnchor>`, added as an in-house remark plugin (like §12/§13), **not** via `rehype-slug` /
  `rehype-autolink-headings`. (This list otherwise enumerates what the kernel does *not* do; the
  §15 reversal moved heading anchors out of it.) Called out here so the
  reference surface stays honest about the current state. *(Reverses the former "no v1 change
  planned" call — see Decisions.)*
- **No syntax highlighting** — a fenced code block's info string (` ```ts `) is passed through
  as a `className` on `<code>`, but nothing tokenises it. Bring a highlighter component.
  *No v1 change planned.*
- **No raw-HTML re-parsing** — HTML in the source is JSX (§6.1), not run through
  `rehype-raw`. It must be valid JSX. *No v1 change planned.*
- **No smart typography** — plain text is rendered as written.
- **No GitHub-style admonitions and no `[[wiki-links]]`** — `> [!NOTE]` renders as a plain
  blockquote and `[[x]]` renders as literal text *today*. **These two are the v1 target** —
  see §12 and §13 (proposal). They are called out here so the reference surface stays honest
  about the current state.

---

## 8. Deviations from plain Markdown (the gotchas)  *(reference)*

These follow from compiling as MDX and bite authors migrating plain `.md`:

- **`{` and `<` are special.** A literal `<` or `{` in prose is read as the start of JSX or an
  expression. To render one literally, escape it (`\{`, `\<`) or use an HTML entity
  (`&#123;`, `&lt;`).
- **HTML comments don't work.** `<!-- … -->` is a syntax error in MDX. Use `{/* … */}` (§6.5).
- **Indented code blocks are unsupported.** A 4-space-indented block is *not* a code block in
  MDX (indentation is reserved for JSX). Use a **fenced** code block (` ``` `).
- **Raw HTML must be valid JSX.** Unclosed tags (`<br>`, `<img …>`), `class=` instead of
  `className=`, and unquoted attributes all fail. Close every tag and use JSX attribute names.
- **`.md` is MDX too** (§2) — all of the above apply to `.md`, not only `.mdx`.
- **`<More />` is reserved** as the excerpt marker (§3.1); using it as a normal component name
  will truncate your rendered body.
- **`[[…]]` renders as literal text today.** CommonMark treats `[[x]]` as bracketed text, not a
  link — so an Obsidian-style wiki-link is inert on the current surface. §13 (proposal) changes
  this; authors of existing content that contains literal `[[…]]` should note the planned
  behavior change.

---

## 9. Worked example  *(reference)*

The package's own fixture (`test/fixtures/post.mdx`) exercises the built surface end-to-end:

````mdx
---
title: Hello MDX
tags:
  - intro
  - demo
---

# {props.title ?? 'Hello'}

This is **MDX** with a [link](https://example.com) and GFM ~~strikethrough~~.

<Callout>Rendered through the provider.</Callout>

| a | b |
| - | - |
| 1 | 2 |
````

Compiling it yields (golden `test/golden/post-mdx.out.js`): frontmatter stripped; `**MDX**` →
`<strong>`; the `[link]` → the provider's `a` (in-app `<Link>`); `~~strikethrough~~` →
`<del>`; the table → `<table><thead>…`; and `<Callout>` resolved from the provider, guarded by
`_missingMdxReference` so an unprovided `Callout` throws at render.

---

## 10. Load-bearing assumptions & code anchors

### Depends-on-today (verified against code, 2026-07-02)

| Assumption (behavior this doc rests on) | Anchor (repo-relative file) | Token (grep-stable) |
|---|---|---|
| MDX compiled by `@mdx-js/mdx` with GFM, `jsx:true`, program output, the SDK provider source | `src/mdx/compile.ts` | `providerImportSource: '@immediately-run/sdk/MDXProvider'` |
| Only `remark-gfm` — no rehype/recma plugins | `src/mdx/compile.ts` | `const rehypePlugins: PluggableList = [];` |
| ESM-only remark deps are loaded via a memoised dynamic `import()` (the pattern any new plugin follows) | `src/mdx/compile.ts` | `function loadMdxDeps` |
| `.md` **and** `.mdx`, app-root only, case-insensitive, route to the MDX stage | `src/presets/react.ts` | `MDX_APP_ROOT_RE = /^(?!\/node_modules\/).*\.mdx?$/i` |
| Frontmatter is stripped before compile via the YAML-1.2 parser | `src/mdx/frontmatter.ts` | `FRONTMATTER_RE` |
| `<More />` lifts the prefix to `excerpt` and removes it from the body | `src/mdx/frontmatter.ts` | `EXCERPT_SEPARATOR = '<More />'` |
| The default `a` override routes same-app links through the sandbox router | `immediately-run-sdk/src/components/MDXComponents.tsx` | `DEFAULT_MDX_COMPONENTS` |
| `boot()` applies `DEFAULT_MDX_COMPONENTS` when the caller passes no `mdxComponents` | `immediately-run-sdk/src/boot.tsx` | `mdxComponents = DEFAULT_MDX_COMPONENTS` |
| `useMDXComponents` merges caller overrides onto the surrounding provider context | `immediately-run-sdk/src/MDXProvider.ts` | `useMDXComponents` |
| A code-less repo boots via a synthesized read-only `/index.tsx` = `boot()` (the phantom-defaults seam §11 extends) | `immediately-run-site-main/src/filesystem/bootDefaults.ts` | `BOOT_DEFAULT_FILES` |
| Runtime (not compile-time) wiki-link resolution against the metadata index is already viable (Grove's prototype) | `grove/src/components/WikiLink.tsx` | `useMetadataQuery` |
| An unprovided component throws via the missing-reference guard | `test/golden/post-mdx.out.js` | `_missingMdxReference("Callout"` |
| GFM strikethrough/table compile to `del`/`table` elements | `test/golden/post-mdx.out.js` | `del: "del"` |
| Verified probe: `[{fn()}](url)` → `<a href="url">{fn()}</a>` (label expressions evaluate) | `src/mdx/compile.ts` | `providerImportSource` (compile behavior; §14) |
| Verified probe: `[x]({fn()})` → `href="%7Bfn()%7D"` (URL braces are literal, URL-encoded, not evaluated) | `src/mdx/compile.ts` | `providerImportSource` (compile behavior; §14) |

Pinned dependency versions live in `package.json` (`@mdx-js/mdx`, `remark-gfm`, `yaml`); the
syntax surface changes only on a deliberate bump of those pins or the addition of a pinned
plugin (§12, §13).

### Must-establish (new invariants the v1 proposals create)

| New invariant | Proven by (gate test) |
|---|---|
| The admonition plugin is byte-identical across the sandbox (browser) and CLI (Node) paths | Golden-output test: `> [!NOTE]` compiles to the same bytes under both entry points |
| `> [!NOTE]` compiles to `<Admonition …>` **and** the SDK default is always present | Plain-repo render test: a code-less repo renders an admonition with **no** `_missingMdxReference` throw |
| The wiki-link plugin emits only the raw target/label — it resolves **nothing** against other files | Byte-identity test: file A's compiled output is identical whether or not file B exists |
| The default `<WikiLink>` resolves relative / absolute / bare-name targets at runtime; ambiguous or missing → broken-link state | SDK `WikiLink` unit tests over the three target forms + a missing target |
| A `\|` inside `[[label\|target]]` survives `remark-gfm`'s table parsing | Plugin-ordering test: `[[a\|b.mdx]]` in and out of a table context |
| `boot({ mdxComponents })` **merges** the app map over the defaults (override one, keep the rest) | `boot` test: an app that overrides only `WikiLink` still receives the default `a` + `Admonition` |
| The heading-slug plugin (§15) is byte-identical across the sandbox (browser) and CLI (Node) paths | Golden-output test: `## A heading` compiles to the same bytes (`id` + `<HeadingAnchor>`) under both entry points |
| A heading's slug depends only on that heading's own text — never on other files or other headings' *content* (the per-file, in-document dedup counter is still byte-local) | Byte-identity test: file A's compiled output is identical whether or not file B exists; a duplicate heading within one file gets a deterministic `-1`/`-2` suffix from that file's own bytes alone |
| `## H` compiles to `<h2 id="h">` **and** the default `<HeadingAnchor>` is always present (no `_missingMdxReference`) | Plain-repo render test: a code-less repo renders a heading with an `id` and a working `#` anchor with **no** throw |
| The autolink anchor is overridable per §11 without disturbing the heading's `id` | `boot` test: an app overriding only `HeadingAnchor` still receives every other default; the heading `id` is unchanged |

---

## 11. Component resolution & the phantom-default layer  *(reference — shipped by R3-151, `@immediately-run/sdk` ≥ 0.23.0)*

This section generalizes §6.4 into the mechanism the v1 syntax features (§12, §13) rely on. It
adds **no new transpiler machinery and no new host machinery** — it is a naming of, and a small
SDK change to, the provider path that already exists.

### 11.1 Components are the platform's late-binding seam

The kernel compiles certain markdown syntax to **components** rather than intrinsic HTML:
admonitions → `<Admonition>` (§12), wiki-links → `<WikiLink>` (§13), Markdown links already
→ the provider's `a` (§6.4), and heading autolink anchors →
`<HeadingAnchor>` (§15). Compiling to a component (resolved at render through the
MDXProvider) rather than to a fixed `<div class>`/`<a href>` is deliberate: it gives **late
binding**. A Grove wiki overrides `<WikiLink>` **once** in its `boot()` call and thereby changes
how *every* link in *every* content file renders — its resolved/broken/self states, its icons,
its routing — **without touching any content**. An intrinsic element with a class can be
*restyled* but not *re-behaviored*; a component can be both.

### 11.2 The phantom defaults keep "plain markdown just works"

Compiling to a component would normally reintroduce the §6.4 hazard: a plain-markdown repo that
never calls `boot({ mdxComponents })` would hit the `_missingMdxReference` guard and **throw**
on the first admonition or wiki-link. The phantom-default layer removes that hazard by reusing
scaffolding that already exists:

- `BootDefaultsFS` (BOOT_SCAFFOLDING_SPEC §4) serves a read-only `/index.tsx` =
  `import { boot } from "@immediately-run/sdk/boot"; boot();` for any repo that ships no entry of
  its own (`bootDefaults.ts` `BOOT_DEFAULT_FILES`).
- `boot()` called with no arguments applies `DEFAULT_MDX_COMPONENTS` (`boot.tsx`).

So the "phantom default components" are simply an **expanded `DEFAULT_MDX_COMPONENTS`** in the
SDK — it gains a default `Admonition` and a default `WikiLink` alongside the existing `a`
override. A code-less markdown repo therefore renders working admonitions and wiki-links with
**zero** app cooperation, and the missing-reference guard never fires for platform-emitted
components. No synthetic component file is written anywhere; the "phantom" is the SDK default
map, delivered through the already-synthesized `boot()` call.

### 11.3 Override semantics: `boot()` merges over the defaults

For the late-binding override in §11.1 to be ergonomic, an app must be able to override **one**
default component without re-declaring the rest. Historically `boot({ mdxComponents })` **replaced**
the default map (which is why Grove spread `...DEFAULT_MDX_COMPONENTS` by hand). As of
`@immediately-run/sdk` ≥ 0.23.0, `boot()` **merges** the caller's map over the defaults —
`{ ...DEFAULT_MDX_COMPONENTS, ...mdxComponents }` — so overriding `WikiLink` alone keeps the
default `a` and `Admonition`. The
function-form (`mdxComponents: (defaults) => …`, already supported by `useMDXComponents`) remains
the escape hatch for an app that wants full control.

> **Honesty note:** this was a behavior change from the previous replace semantics. It is
> backward-safe for the common case (an app that only *adds* components), and it makes Grove's
> explicit `...DEFAULT_MDX_COMPONENTS` spread unnecessary (though harmless). An app that
> deliberately *removed* the default `a` by passing a map without it would now keep the default;
> such an app uses the function-form instead.

### 11.4 What is unchanged

The missing-reference guard still applies to any component that is **neither** a platform default
(§11.2) **nor** imported **nor** provided by the app — e.g. a hand-authored `<Callout>` with no
provider entry still throws, exactly as §6.4 describes. Registering app-specific components remains
a `boot({ mdxComponents })` (or nested `<MDXProvider>` / `React.lazy`) concern; there is **no**
transpiler-level or post-boot imperative registration API — the provider *is* the registration
mechanism, and per-subtree component packs are already expressible declaratively.

---

## 12. GitHub-style admonitions  *(reference — shipped by R3-152, `src/mdx/remarkAdmonitions.ts`)*

### 12.1 Syntax

The GitHub blockquote-alert forms, on a blockquote whose first line is exactly the marker:

```markdown
> [!NOTE]
> Useful information the reader should know.

> [!WARNING]
> Something that could cause a problem.
```

Recognized types: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`. The type keyword is matched
**case-insensitively** (as GitHub's cmark-gfm alert extension does — `[!note]` works), and the
emitted `type` attribute is always lower-cased to match the SDK's `AdmonitionType` union. The
marker must occupy its **own line** — it is followed by a line break (the body starts on the next
line) or it is the blockquote's sole content (a title-only admonition). A blockquote whose first
line is not one of these markers — or whose marker shares its line with other content
(`> [!NOTE] text`) — stays an ordinary blockquote.

### 12.2 Implementation — an in-house plugin

The admonition transform is a **small in-house remark plugin defined in the transpiler package**,
not a third-party dependency (see Decisions). It is added to `remarkPlugins` in `compile.ts`; it
runs on the mdast tree the already-loaded `@mdx-js/mdx` provides, so it needs no ESM-only
dependency of its own (a hand-walk of the tree, no `unist-util-visit`) and rides the existing
`loadMdxDeps` load. The transform is **purely local** to the one file — it depends on no other
file — so per-file byte-identity and pre-transpile caching are preserved (§10 Must-establish).

It matches a blockquote whose first child paragraph begins with a `[!TYPE]` marker line, strips
that marker, and rewrites the blockquote into an `mdxJsxFlowElement` named `Admonition` with a
`type` attribute (`note` / `tip` / `important` / `warning` / `caution`) — i.e. it emits the
component form §12.3 renders, directly, rather than post-processing another plugin's HTML/class
output.

### 12.3 Compile target and default

An admonition compiles to `<Admonition type="note">…children…</Admonition>` (a component, per
§11.1). The SDK ships a **default `Admonition`** in `DEFAULT_MDX_COMPONENTS` (§11.2) so a plain
repo renders it without throwing. The default renders semantic, accessible markup (a labeled
container with the type as a role/heading) with **intentionally minimal** styling; rich styling
and icons are the app's job via CSS or an override — consistent with the "GFM on, presentation is
app-owned" stance (§5, Decisions). A Grove-class app overrides `<Admonition>` to match its design
system.

> **Honesty note (v1):** the default `Admonition` is structural, not visually rich. Apps that want
> GitHub's colored/iconed callouts either ship CSS targeting the default's classes or override the
> component.

---

## 13. WikiLinks  *(reference — shipped by R3-153: kernel `src/mdx/remarkWikiLinks.ts` + SDK default `<WikiLink>`)*

### 13.1 Syntax

A wiki-link target is **always a path** — relative to the current file, or absolute. A bare
filename is simply a relative path in the current directory; there is **no** vault-wide
name search (§13.3, Decisions).

```markdown
[[relative/path/to/another.mdx]]      → relative path, resolved against the current file's dir
[[another.mdx]]                       → a bare filename IS a relative path (current dir) — no search
[[/app/docs/absolute/link.mdx]]       → absolute sandbox path
[[My Favorite Link|another.mdx]]      → explicit label | target (target is a relative/absolute path)
```

### 13.2 The split: parse in the kernel, resolve in the component

The hard constraint is **byte-identity / per-file caching**: a file's compiled output must depend
only on that file's bytes, never on which *other* files exist. Because targets are paths (§13.1),
the **target-path computation** is pure arithmetic — a relative path against the current file's
own directory, or an absolute path taken verbatim — so it depends on nothing but the file itself.
The only part that needs the *set* of files is the **existence check** (is the target actually
there? → the resolved / broken / self visual state), and that is a **render** concern, never a
compile concern.

v1 therefore **splits parsing from resolution**:

- **Kernel (compile time):** a small in-house remark plugin (as §12.2) turns `[[target]]` and
  `[[label|target]]` into a `<WikiLink target="…" label="…">` node, carrying the **raw** target
  and label verbatim. It resolves **nothing** — keeping the plugin trivial and the output
  obviously byte-local (§10 Must-establish): the emitted node depends only on the `[[…]]` bytes,
  not on the compiling file's path or on which other files exist.
- **SDK component (runtime):** the default `<WikiLink>` computes the target path (relative→current
  dir, or absolute) and checks **existence** against the live metadata index (`filesMetadata`,
  keyed by absolute `/app/…` paths) for the resolved / broken / self state, routing resolved links
  through the existing `<Link>` in-app router. It learns the **current file** — the file the link is
  *authored in* — from the machinery that already exists: every MDX file is rendered through
  `<Include>` (`FileRouter` renders even the top-level file that way), and `Include` /
  `RenderExportedComponent` publish the rendered module's `EvaluationContext` to their subtree via
  `RenderExportedComponentContext`. The component reads the **nearest** such context, whose
  `evaluation.module.filepath` is the authoring file's own `/app/…` path — so a relative target
  resolves against *that* file's directory and the self-link check compares against it, with no
  per-node compile-time help. This matters for composition: if `MainPage.mdx` `<Include>`s
  `nav/NavSection.mdx` and the fragment contains `[[../demos.mdx]]`, the nearest context is
  `NavSection.mdx`, so the target resolves to `demos.mdx` **relative to the fragment**, not to the
  top-level page in the URL — because `RenderExportedComponentContext` nests with each `<Include>`.
  This is the pattern Grove's `WikiLink.tsx` already prototypes — and notably Grove already resolves
  only path-based hrefs and never does a name search, so the path-only rule (§13.3) matches the
  proven prototype — §10 anchors it. An app that renders MDX **without** `<Include>` overrides
  `<WikiLink>` (§11) for precise resolution; the default degrades gracefully (a relative target with
  no ambient render context routes optimistically).

### 13.3 Resolution rules (default `<WikiLink>`)

Targets are **paths only** — there is **no implicit search path and no vault-wide name lookup**:

- **Relative** (`a/b.mdx` or a bare `another.mdx`, no leading `/`): resolved against the current
  file's directory. A filename with no slash is a relative path in the current dir — *not* a name
  searched for across the collection.
- **Absolute** (`/app/docs/x.mdx` or a `/files/…`-prefixed href): taken verbatim.
- **Missing target** (the computed path has no existing file): renders the **broken-link** state
  (not a throw). There is no ambiguity to resolve — a path names exactly one location.
- **Label:** `[[label|target]]` uses `label` as the visible text; `[[target]]` uses a
  target-derived label (basename without extension).

The default `<WikiLink>` is overridable per §11 — a wiki app supplies its own resolution/states
(the headline late-binding capability). Because the emitted node is a `<WikiLink>` component
always present in the defaults, a plain repo renders wiki-links with no app cooperation.

> **Referring to a document by a short human name is deliberately *not* the wiki-link's job.**
> Resolving a name to a path via a search would make a link's target change when unrelated files
> are added (see Decisions). That convenience is a **separate, future initiative** — an explicit,
> opt-in component that resolves a document's `title` frontmatter attribute to a path — distinct
> from this link syntax and out of scope here.

### 13.4 Interaction notes

- **`|` vs GFM tables:** the pipe inside `[[label|target]]` must survive `remark-gfm`'s table
  tokenizer; plugin ordering is gated (§10 Must-establish).
- **Value-3 behavior change:** content that previously rendered literal `[[…]]` text (§8) now
  renders as wiki-links. This is within the existing MDX-deviation budget but is flagged for
  authors of pre-existing Obsidian-style content. (Literal `[[…]]` inside an inline code span or
  code block is untouched — the plugin only rewrites `text` nodes.)

### 13.5 Fragments — link-to-section  *(reference — shipped by R3-212, `@immediately-run/sdk` ≥ 0.31.0)*

A link target may carry a `#fragment` naming a **heading id** (§15) — the seam that joins
wiki-links (which resolve *file → file*, §13.3) to heading ids (which make sections
*addressable*, §15). It applies uniformly to both link forms: `[[FILE.mdx#sec-8-9]]` /
`[[#sec-8-9]]` and the equivalent markdown `[text](FILE.mdx#sec-8-9)` / `[text](#sec-8-9)`.
This is a **render-time** concern — the kernel plugin keeps carrying the raw target verbatim
(§13.2), so per-file byte-identity (§10) is untouched; the behavior lives entirely in the SDK
default `<WikiLink>` / `a` and router, so **every** immediately.run app inherits deep-linking
(not only a wiki app). It decomposes into three parts:

**(A) Split.** `splitHash(target)` divides the target at its **first** `#` into a *path part*
and a *fragment* (`FOO.mdx#sec-8-9` → `["FOO.mdx", "sec-8-9"]`; `#sec-8-9` → `["", "sec-8-9"]`;
`FOO.mdx` → `["FOO.mdx", ""]`). A fragment never contains a further `#`.

**(B) Resolve on the stripped path.** The §13.3 existence rules run on the **path part**, not
the whole `…#frag` string — so a section citation to an existing file resolves (**not** the
broken state). The states, refined:

- **path empty, fragment present** (`[[#sec-8-9]]`), or the path resolves to the **current
  file**: a **same-page anchor** — scroll to `#fragment` within the current document, **no route
  change**.
- **path resolves to another file:** in-app navigation (§13.3 `resolved`) to the path,
  **carrying the fragment** into part (C).
- **path is missing:** the **broken** state (file existence still wins — a fragment does not
  rescue a missing file).

**(C) Scroll after navigation.** In-app navigation swaps the rendered file *asynchronously*, so
the element the fragment addresses does not exist at click time. After the destination file's
tree mounts, the router scrolls to the target — trying the element's own `id` (a numbered
heading's `sec-…` id or a prose heading's text slug, §15.1), then the `[data-slug]` hook (a
citation that used the prose text slug still lands), then **top-of-page**. A missing or bogus
fragment on an otherwise-resolved page degrades to top-of-page and is **never** a hard failure.
The scroll retries on a short cadence (a `MutationObserver` over late-mounting subtrees plus a
few timed retries) until the target appears.

Overridable per §11 (an app may supply its own `<WikiLink>` / router behavior); the default
above is what a plain repo gets with no cooperation.

---

## 14. ESM expressions in link labels, URLs, and wiki targets  *(reference — confirmed + locked by R3-154, `test/esmLinks.test.mjs`)*

The four requested forms split three ways by feasibility (all verified against the real compiler —
§10):

### 14.1 Labels — supported today  *(reference)*

`[{dynamicLinkLabel()}](http://mysite.com)` compiles to `<a href="http://mysite.com">{dynamicLinkLabel()}</a>`
— a link whose **label** is an evaluated expression. This works now because a link label is
phrasing content and MDX evaluates `{…}` there. Documented as supported; needs only a test to
lock it.

### 14.2 URLs — use JSX, not markdown link syntax  *(reference — resolved: JSX)*

`[Click here]({dynamicUrl()})` does **not** evaluate — the CommonMark link *destination* is a
string grammar, so `{dynamicUrl()}` is treated as literal URL text and URL-encoded
(`href="%7BdynamicUrl()%7D"`, verified). The supported path for a dynamic URL is **JSX**, which
works today:

```mdx
<a href={dynamicUrl()}>Click here</a>
```

v1 does **not** add expression evaluation inside markdown link destinations: it would require a
fragile custom transform, is ambiguous (URLs legitimately contain `{`/`}`), and reinvents what
`<a href={…}>` already does cleanly (value 7 — don't reimplement). See Decisions.

### 14.3 Dynamic wiki targets — not supported  *(reference — resolved: use JSX)*

`[[{someFilename()}]]` is **not** supported: it does **not** produce a `<WikiLink>`. The wiki-link
plugin (§13.2) only rewrites `[[…]]` runs that live inside a single `text` node, and an MDX
`{…}` expression splits the paragraph into `text "[["` · the expression · `text "]]"` — so the
plugin never matches, and the brackets render literally around the (ordinary MDX) expression. The
plugin never evaluates anything in the target position; keeping `[[…]]` consistent with `[…](…)`
(where a `{…}` destination is likewise not a dynamic URL, §14.2) is the point (see Decisions). For
a dynamic target, use JSX with §13's component directly: `<WikiLink target={someFilename()} />`.

### 14.4 Content is code (content-trust note)

`{…}` is arbitrary JavaScript executed in the **app's** principal — this is already true for all
MDX and adds **no** new authority (`core_concepts.md §5`). It does reinforce that MDX content *is
code*: an app that renders **low-trust** MDX (a multi-writer space, a remote document — content
trust, `core_concepts.md §8`) is executing attacker-influenceable code in its own principal and
must treat the source accordingly. This is a property of MDX in general, not of these features.

---

## 15. Heading slugs & autolinks  *(reference — R3-186 + R3-211, shipped 2026-07-10)*

This section **reversed** the earlier decision (§7, Decisions) that heading anchors/slugs stay
off with no v1 change planned. Heading slugs and autolink anchors are a v1 feature, shipped as
`src/mdx/remarkHeadingAnchors.ts` + the SDK default `<HeadingAnchor>`. The design
follows the exact shape of §12/§13: an **in-house remark plugin** in the kernel chain, emitting an
**overridable component** backed by a **phantom default** (§11), so it preserves per-file
byte-identity and the "plain markdown just works" guarantee.

### 15.1 Behavior

Every ATX/Setext heading (`#` … `######`) gains:

- **An `id`.** Set as the heading's `id` via `data.hProperties.id`, so `## Getting started`
  compiles to `<h2 id="getting-started">`. Two schemes, chosen per heading:
  - **Prose heading** — a URL-safe **text slug** from the heading's rendered text content (inline
    markup stripped: `## The **bold** heading` → `the-bold-heading`): lower-cased, spaces→`-`,
    non-word characters dropped (a GitHub-compatible slugging, in-house — §15.2). Note GitHub drops
    a `.` entirely rather than hyphenating it (`8.9 X` → `89-x`).
  - **Numbered heading (R3-211).** When the heading's **leading token** `T` is a section number,
    the `id` **is the prose-independent section id** — the stable citation target, the agent-first
    choice (an agent computes `#sec-8-9` from a `§8.9` citation with zero lookup). `T` is the run of
    alphanumerics-and-dots before the first space/`—`/`:`; it is **section-like iff** its first
    dotted component contains a digit **or** `T` is an appendix form `^[A-Za-z]\.`, and
    `sectionId = "sec-" + T.toLowerCase().replace(/\./g,"-")`. So `8→sec-8`, `8.9→sec-8-9`,
    `3.2.1→sec-3-2-1`, `7A→sec-7a` (**distinct from** `7→sec-7`), `1a→sec-1a`, `A.0→sec-a-0`; a prose
    heading (`## Decisions …`) gets a text slug. The GitHub text slug is demoted to a **`data-slug`**
    attribute (a fallback hook). R3-186's autolink `<HeadingAnchor>` targets the **heading's own
    `id`**, so `#sec-8-9` is both the human permalink and the agent citation target. Grammar verified
    **collision-free** across the real spec corpus (56 files / 1334 headings / 1043 section-like / 0
    collisions, incl. the `7`/`7A` and `3.2`/`3.2.1` pairs a naive grammar would merge).
  - **Opt-out.** A `sectionIds: false` **frontmatter** flag falls the whole file back to plain
    text-slug ids (no `sec-`/`data-slug`); byte-local (frontmatter is part of the file's bytes);
    default **on**.
  - Within a **single document**, a repeated id is disambiguated with a numeric suffix
    (`-1`, `-2`, …) in document order — a per-file counter that stays byte-local (§15.3).
- **An autolink anchor.** An anchor pointing at `#<slug>` is **prepended** as the heading's first
  child, so a reader can link directly to the heading. It renders through a default
  `<HeadingAnchor>` component (§15.4), styled minimally (an `aria`-labeled `#`/link affordance apps
  typically reveal on hover) — presentation is app-owned, consistent with the "GFM on, presentation
  app-owned" stance (§5, §12.3).

A heading that already carries an explicit `id` (e.g. authored as JSX, `<h2 id="x">…`) is left
alone — the plugin never overwrites an author-set `id`, and emits no second anchor for it.

### 15.2 Implementation — an in-house remark plugin

Like the admonition (§12.2) and wiki-link (§13.2) transforms, this is a **small in-house remark
plugin defined in the transpiler package**, not `rehype-slug` / `rehype-autolink-headings`. Two
reasons, both matching the §12.2 admonition decision:

1. **Byte-identity is ours to keep.** The cached↔live byte-identity invariant (§10,
   `MDX_CONTENT_COLLECTIONS_SPEC §1.1`) requires that a heading's compiled bytes never change out
   from under us. A third-party slugger can change its algorithm on any version bump; an in-house
   slugger is pinned by our own source. The slug is part of the compiled output (`id` +
   `#`-anchor), so its stability is load-bearing.
2. **No new stage, no new ESM-only dep.** `rehypePlugins` is empty (§7) and stays empty — enabling
   the rehype (hast) stage just for slugs would pull two ESM-only deps and a second tree pass. The
   in-house plugin runs on the **mdast** the already-loaded `@mdx-js/mdx` provides (a hand-walk, no
   `unist-util-visit`), rides the existing `loadMdxDeps` load, and adds no dependency — exactly as
   §12.2 does.

The plugin walks the mdast, computes each heading's slug from its own text content, sets the `id`
via `data.hProperties.id` on the heading node, and prepends an `mdxJsxTextElement` named
`HeadingAnchor` (carrying the slug) as the heading's first child. It emits the component form
§15.4 renders, directly.

### 15.3 Byte-locality (why this is safe for caching)

Slug computation is **byte-local**: a heading's slug is a pure function of that heading's own text.
The only cross-heading state is the in-document **duplicate-slug counter**, and that depends only on
the *compiling file's own bytes* (the sequence of headings within it) — never on which **other
files** exist. So a file's compiled output still depends only on that file's bytes, and the
sandbox↔CLI / cached↔live byte-identity invariant holds (§10 Must-establish). This is a weaker
constraint than wiki-links faced (§13.2): slugs need **no** runtime resolution against the metadata
index at all — the whole feature is compile-time and self-contained per file.

### 15.4 Compile target and default

The heading stays an intrinsic `<h1>`…`<h6>` (already overridable through the provider, §6.4) — it
just gains an `id` prop. Only the **injected autolink anchor** is a new component: the SDK ships a
default `<HeadingAnchor>` in `DEFAULT_MDX_COMPONENTS` (§11.2) rendering semantic, accessible markup
(an `<a href="#slug">` with an accessible label, intentionally minimal styling). Because it is one
of the always-present phantom defaults, a code-less markdown repo renders heading anchors with
**zero** app cooperation and the missing-reference guard never fires (§11.2). A Grove-class app
overrides `<HeadingAnchor>` once (§11.1/§11.3) to change the icon, position, or behavior (e.g.
copy-permalink-to-clipboard) of *every* heading anchor in *every* content file — the same
late-binding win that motivated compiling admonitions/wiki-links to components.

> **Honesty note (v1):** the default `<HeadingAnchor>` is structural, not visually rich (no
> hover-reveal animation, no icon set). Apps that want GitHub-style hover anchors ship CSS targeting
> its `ir-heading-anchor` class or override the component. The autolink is emitted for **every**
> heading unconditionally; the `sectionIds: false` frontmatter flag (§15.1) is the file-level
> opt-out for the section-id scheme (not for the anchor itself).

### 15.5 Interaction notes

- **Grove `<Toc>` alignment.** Grove currently computes its own heading ids for its in-page TOC
  (`grove/src/lib/wiki.ts headingId`). Once the kernel emits `id`s, Grove's `<Toc>` should target
  the **kernel-emitted** ids so its links and the autolink anchors point at the same target;
  otherwise a TOC link and a heading anchor could disagree. The plugin's slugging is specified
  (§15.1) precisely so a consumer can reproduce it.
- **Headings inside `<Include>`d fragments.** Slugs are computed per compiled file, so a heading in
  an included fragment is slugged in the fragment's own document scope. Two fragments included into
  one page can therefore emit the same `id`; de-duplication across an assembled page is a **render**
  concern (as with any component-composed ids), out of scope for the compile-time plugin.
- **Non-heading `#` text is untouched.** The plugin only rewrites `heading` nodes; a literal `#` in
  prose or a code span is left alone.

## Decisions & rejected alternatives

- **`.md` and `.mdx` share one MDX pipeline** (no separate plain-CommonMark mode). *Rejected:*
  a second parser for `.md` — it would fork the toolchain, break byte-identity between the two
  extensions, and surprise authors whose `.md` used a component. The cost is that `.md` inherits
  the MDX deviations (§8); the benefit is one grammar, one compiler, one cached output.
- **GFM on; highlighting/raw-HTML stay off. Heading slugs/autolinks are ON (reversed 2026-07-05;
  SHIPPED 2026-07-10, R3-186 + R3-211).** `remark-gfm` is included because tables/task-lists/
  strikethrough are table stakes.
  **Heading slugs + autolink anchors were originally left off ("no v1 change planned") and are now
  shipped (§15, R3-186; the §15.1 section-id scheme R3-211).** *Reversal rationale:* linkable headings are table stakes for the
  docs/wiki content the platform is being built around (the roadmap-as-Grove-wiki dogfood needs
  in-page anchors and a TOC that agrees with them), and the original "one highlighter / one anchor
  style" objection **does not apply** — the anchor compiles to an overridable `<HeadingAnchor>`
  component (§15.4), so apps still choose the style/behavior, and the slug is a plain `id`. Crucially
  it is done as an **in-house remark plugin emitting a component**, *not* by enabling `rehype-slug` /
  `rehype-autolink-headings` — so byte-identity and the minimal toolchain are preserved exactly as
  for admonitions (§12.2, §15.2). Slug computation is byte-local (§15.3), so per-file caching is
  untouched. *Still rejected:* baking **syntax highlighting** or **raw-HTML re-parsing** into the
  shared chain (apps bring those). *Rejected for slugs specifically:* a third-party
  `rehype-slug`/`rehype-autolink-headings` (version-bump byte-identity risk; enabling the rehype
  stage) — in-house, like the admonition plugin. Admonitions, wiki-links, and now heading
  slugs/autolinks are the deliberate v1 *exceptions* to "everything else off."
- **Frontmatter is metadata, not props/exports.** Parsed out before the compiler sees it and
  exposed through the SDK metadata hooks. *Rejected:* auto-`export const frontmatter` / auto-props
  injection.
- **`<More />` as the excerpt marker.** Kept for gray-matter compatibility. *Rejected:* a
  frontmatter `excerpt:` field only. (Honesty note in §3.1: the prefix is moved, not copied.)
- **New syntax (admonitions, wiki-links) compiles to overridable components backed by phantom
  defaults — not to intrinsic HTML.** Chosen for **late binding**: an app overrides `<WikiLink>`
  / `<Admonition>` once and re-behaviors every occurrence in every content file (§11.1). Value 3
  ("plain markdown just works") is preserved because the SDK's expanded `DEFAULT_MDX_COMPONENTS`
  is already delivered through the synthesized `boot()` call (BootDefaultsFS), so the
  missing-reference guard never fires (§11.2). *Rejected:* compiling to intrinsic `<div class>` /
  `<a href>` — styleable but not re-behaviorable, losing the late-binding win that motivates the
  whole feature.
- **New syntax lives in the kernel remark chain — global, like GFM — not in a per-app plugin
  seam.** *Rejected (for v1):* a per-app rehype/remark layer. It threatens per-file byte-identity,
  adds a large new seam, and the hackability the platform cares about is already available at the
  **component** layer (override `<WikiLink>`/`<Admonition>`). This accepts a value-4 tension: the
  *syntax* is global and not per-app forkable, while the *rendering* is fully per-app forkable via
  components. GFM sets the precedent for global kernel syntax. The per-app plugin seam is kept as
  an Open question.
- **WikiLinks parse in the kernel, resolve at runtime.** The plugin emits a raw-target
  `<WikiLink>` node; existence/name→path resolution happens in the component against the live
  metadata index (§13.2). *Rejected:* compile-time resolution against the content index — it makes
  one file's compiled output depend on other files, breaking per-file caching and the
  sandbox↔CLI byte-identity invariant.
- **JSX is the supported dynamic path; markdown link *and* wiki-link destinations stay literal**
  (§14.2/§14.3). A dynamic URL uses `<a href={fn()}>` and a dynamic wiki target uses
  `<WikiLink target={fn()} />`; neither `[…]({fn()})` nor `[[{fn()}]]` evaluates. *Signed off
  2026-07-02* (the `[[{…}]]` half): keeping `[[…]]` literal is what makes it consistent with
  `[…](…)`. *Rejected:* a transform that evaluates `{…}` inside a link `(…)` or a `[[…]]` target —
  fragile, ambiguous (URLs/paths contain braces), and a reimplementation of what JSX already does
  (value 7). Don't relitigate.
- **Wiki-link targets are relative or absolute *paths* only — no implicit search-path / bare-name
  resolution** (§13.1/§13.3). *Signed off 2026-07-02.* A bare `[[name.mdx]]` is a relative path in
  the current directory, not a vault-wide name lookup. Chosen because a search-path resolver
  (Obsidian-style) makes a link's target **change surprisingly when unrelated files are added** to
  the collection — a silent content-correctness hazard; a path names exactly one location and is
  deterministic from the link text alone. This also **retires the former "bare-filename ambiguity
  rule" open question** — with paths there is no ambiguity to resolve. *Rejected:* Obsidian-style
  unique-basename / nearest-by-path / first-match resolution. *Deferred (separate initiative, not
  this spec):* referring to a document by a short human name is handled by a **future opt-in
  component that resolves a `title` frontmatter attribute** to a path — explicit, distinct from the
  link syntax.
- **The admonition transform is an in-house plugin, not a third-party package** (§12.2).
  *Signed off 2026-07-02.* Chosen because: (1) **byte-identity is ours to keep** — a third-party
  plugin can change its output on any version bump, silently breaking the cached↔live byte-identity
  the whole shared-package design rests on; an in-house transform is pinned by our own source. (2)
  We emit our **own `<Admonition>` component** directly (§12.3); an existing plugin
  (`remark-github-blockquote-alert`) emits its own HTML/class shape, so we'd be post-processing it
  anyway. (3) The transform is tiny (match `[!TYPE]`, rewrite the blockquote) and needs no ESM-only
  dependency, keeping the kernel toolchain minimal. *Rejected:* `remark-github-blockquote-alert` /
  any third-party admonition plugin. Don't relitigate.
- **`boot()` merges `mdxComponents` over the defaults** (§11.3), replacing today's replace
  semantics. Chosen so an app overrides one component without re-listing the rest; the
  function-form remains the full-replace escape hatch. *Rejected:* keeping replace semantics and
  requiring every app to spread `...DEFAULT_MDX_COMPONENTS` (the current Grove workaround).
  *(Signed off 2026-07-02 — the behavior change is approved, not merely recommended; R3-151b
  builds it. Don't relitigate.)*
- **No transpiler-level / post-boot imperative component registration.** The originally-explored
  "dynamic runtime component registration" reduces to the existing provider model: `boot()` for
  global defaults, nested `<MDXProvider>` + `React.lazy` for per-subtree/lazy packs (§11.4).
  *Rejected:* a new imperative `registerMdxComponents()` API — it adds a `_missingMdxReference`
  race (a component rendering before an async registration lands) for no capability the provider
  doesn't already give. (Grove's "load author components at boot from a frontmatter tag" is an
  app-level use of `boot({ mdxComponents })`, not a platform feature.)

## Open questions

- **Admonition default styling.** How much default CSS/icons ship in the SDK vs. are left to apps
  (§12.3). *(The plugin-choice half is settled — in-house, see Decisions.)*
- **HeadingAnchor default styling (§15).** How much default CSS/icon ships with the default
  `<HeadingAnchor>` vs. is left to apps (parallels the admonition question). *(Settled at build,
  R3-186/R3-211: in-house remark plugin, `id` on the heading + component anchor, autolink on for
  **every** heading, `sectionIds: false` frontmatter opt-out for the section-id scheme — see
  §15.1/§15.2/§15.4 and Decisions. The default anchor ships intentionally-minimal `ir-heading-anchor`
  markup; richer styling is app-owned.)*
- **The per-app plugin seam.** Keep new syntax kernel-only (current stance), or design an opt-in
  per-app rehype/remark layer that preserves per-file byte-identity? (Supersedes the prior
  "opt-in rehype layer" question.)
- **Roadmap items — assigned.** §11 → **R3-151** (foundational), §12 → **R3-152**, §13 → **R3-153**,
  §14 → **R3-154**, §15 → **R3-186** + **R3-211** (§15.1 section ids) — all landed (`docs/roadmap/ARCHIVE.md`).
  §12/§13 depend on §11; §14.3 depends on §13; §15 depends on §11 (it ships a new phantom default
  `<HeadingAnchor>`), otherwise independent.
- **Angle-bracket autolink.** Should the CommonMark `<https://…>` autolink be made to work under
  MDX (currently unreliable because `<` starts JSX), or is the GFM bare-URL form (§5) sufficient?

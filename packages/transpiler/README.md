# @lofcz/transpiler

The single source of truth for immediately.run's **per-file transform chain** —
Babel (with `react-refresh/babel` + explicit-resource-management) followed by the
react-refresh HMR wrapper. Both consumers depend on this one package so their
output is **byte-identical**:

- the **browser sandbox bundler** transpiles modules live;
- the **CLI** pre-transpiles modules into `.tinkerable/artifacts/` at cache-zip
  time.

If these two ever drift by a single byte, a pre-transpiled module can silently
lose its HMR instrumentation (or differ from the live transpile), breaking
editing parity invisibly. Keeping the chain in one versioned package — where
**the package version is the toolchain stamp** — is what makes byte-identity
enforceable. See `PRETRANSPILED_ARTIFACTS_SPEC.md` §4.4.

## Public API

```ts
import {
  transformFile,         // run the full chain for one module -> { code, deps } | { error }
  computeInputDepMap,    // the runtime's input DepMap derivation (augment → filter → sort)
  computeToolchainHash,  // canonical SHA-256 over the published tarball's bytes (§4.4)
  TRANSPILER_VERSION,    // the stamp (package version, baked at build)
  PRESET_NAME,           // 'react' (v1 covers the react preset only)
  isTransformable,       // which extensions this package owns
} from '@lofcz/transpiler';
```

`transformFile({ path, code })` picks the chain variant from the path, exactly as
the sandbox's `ReactPreset.mapTransformers` does:

| path | chain |
| --- | --- |
| app-root `.md .mdx` | MDX compile **+** Babel(react-refresh) **+ HMR wrapper** |
| app-root `.js .jsx .mjs .cjs .tsx` | Babel(react-refresh) **+ HMR wrapper** |
| app-root `.ts .mts .cts`, anything under `/node_modules/` | plain Babel(react) |
| `.d.ts`, `.css`, a `/node_modules/` `.md(x)`, … | not owned → `{ error }` |

It never throws: a Babel error or an unsupported path returns `{ error }` so a
caller can skip a single bad file.

For the **Markdown/MDX syntax** an app may use (what the `.md`/`.mdx` compile stage
parses — CommonMark + GFM + MDX components/expressions/ESM, frontmatter, and the
deviations from plain Markdown), see [`MARKDOWN_SYNTAX_SPEC.md`](MARKDOWN_SYNTAX_SPEC.md).

## The byte-identity gate

`test/parity.test.mjs` asserts `transformFile` reproduces the committed golden
corpus (`test/golden/`) byte-for-byte across both chain variants and the
react-refresh path. The goldens are regenerated **only** by a deliberate
toolchain change:

```bash
npm run build
npm run gen:golden   # then review the diff — it is what every cached repo executes
```

## Develop

```bash
npm run build       # tsup -> dist/ (esm + cjs + d.ts)
npm run typecheck    # tsc --noEmit
npm test            # build, then node --test (parity + unit)
```

The Babel toolchain (`@babel/standalone`, `@babel/plugin-proposal-explicit-resource-management`,
`react-refresh`) is pinned to exact versions: those versions *are* part of the
stamp, so a consumer must install the same ones for the bytes to match.

import { defineConfig } from 'tsup';

// Bundle the package into a single entry. Both consumers (the sandbox worker
// build and the CLI) import the public API from the package root, so unlike the
// SDK there is no per-file subpath contract to preserve. `@babel/standalone`,
// the babel plugins and `react-refresh/babel` stay external — they are heavy,
// versioned exactly (the version IS the toolchain stamp, §4.4), and must resolve
// to the consumer's installed copy so the produced bytes match.
export default defineConfig({
  // `src/index.ts` is the package root both the CLI and the sandbox iframe consume.
  // `src/babel/worker-api.ts` (→ `dist/babel/worker-api.js`) is the narrow
  // Babel-only surface the same-origin Babel worker bundles (R3-149) — a separate
  // entry so the worker never drags in the root's `compileMdx` / unified tree.
  // `splitting: false` keeps each entry a self-contained bundle, so adding the
  // second entry leaves `dist/index.js` AND `dist/index.cjs` byte-identical (the
  // PRETRANSPILED §4.4 contract, verified) instead of hoisting shared code into a chunk.
  entry: ['src/index.ts', 'src/babel/worker-api.ts'],
  format: ['esm', 'cjs'],
  splitting: false,
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2020',
  // The shared remark plugins (the safe subset, R3-213) are bundled (inlined) into
  // this dist rather than externalized, so the transpiler's consumers (sandbox, cli,
  // site-main) gain no new transitive runtime dependency and the compiled MDX bytes
  // stay identical to when the plugins lived in `src/mdx/`. The package is still the
  // ONE source both paths share — the SDK safe renderer imports the same source.
  noExternal: ['@immediately-run/mdx-plugins'],
  external: [
    '@babel/standalone',
    '@babel/plugin-proposal-explicit-resource-management',
    'react-refresh/babel',
    // ESM-only; loaded via a dynamic `import()` in src/mdx/compile.ts and kept
    // external so the CJS build never statically `require()`s them (and so the
    // resolved version — which affects the emitted MDX bytes — is the consumer's
    // installed copy, like the babel deps above).
    '@mdx-js/mdx',
    'remark-gfm',
  ],
});

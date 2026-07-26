import { transformBabel, type BabelTransformResult } from './babel/transform';
import { compileMdx } from './mdx/compile';
import { selectReactChain } from './presets/react';
import { getWrapperCode, HELPER_PATH } from './react-refresh/wrap';

export interface TransformInput {
  /** Absolute, sandbox-style module path (e.g. `/app/src/App.tsx`). */
  path: string;
  code: string;
}

export interface TransformSuccess {
  /** The transpiled module bytes — byte-identical to the sandbox bundler's output. */
  code: string;
  /** Module specifiers this file `require()`s, plus the HMR helper when wrapped. */
  deps: string[];
}

export interface TransformError {
  message: string;
  filepath: string;
}

export type TransformResult = TransformSuccess | { error: TransformError };

/**
 * Run the full per-file chain for one source module — the exact chain the
 * sandbox bundler runs live (`ReactPreset.mapTransformers` → [mdx-transformer →]
 * babel-transformer [→ react-refresh-transformer]). This is the single source of
 * truth both the CLI (pre-transpiling artifacts) and the sandbox (live transpile)
 * depend on, so the output is byte-identical across them
 * (PRETRANSPILED_ARTIFACTS_SPEC §4.4; MDX_CONTENT_COLLECTIONS_SPEC §1.1).
 *
 * For `.md`/`.mdx` the chain prepends an MDX compile stage; its emitted `import`s
 * (the `@immediately-run/sdk/MDXProvider` provider, the jsx runtime, any in-body
 * import) are collected as `deps[]` by the Babel stage's dependency collector
 * that runs over the compiled output — so a seeded MDX artifact carries its real
 * specifiers (§1.2).
 *
 * On success returns `{ code, deps }`; on an MDX/Babel error or an unsupported
 * path it returns `{ error }` (it never throws) so callers can skip a single bad
 * file.
 */
export async function transformFile({ path, code }: TransformInput): Promise<TransformResult> {
  const chain = selectReactChain(path);
  if (!chain) {
    return { error: { message: `No transformer for ${path}`, filepath: path } };
  }

  // `.md`/`.mdx`: compile MDX → JSX program first, then run the same Babel +
  // react-refresh chain an app-root `.tsx` gets. The Babel dep-collector picks up
  // the provider/jsx-runtime imports the compile emits.
  let source = code;
  if (chain.variant === 'react-refresh' && chain.mdx) {
    try {
      source = await compileMdx(code, path);
    } catch (err) {
      return {
        error: { message: err instanceof Error ? err.message : String(err), filepath: path },
      };
    }
  }

  let babelResult: BabelTransformResult;
  try {
    babelResult = await transformBabel({ code: source, filepath: path, config: chain.babelConfig });
  } catch (err) {
    return {
      error: { message: err instanceof Error ? err.message : String(err), filepath: path },
    };
  }

  let outCode = babelResult.code;
  const deps = new Set(babelResult.dependencies);

  if (chain.variant === 'react-refresh') {
    outCode = getWrapperCode(outCode);
    deps.add(HELPER_PATH);
  }

  return { code: outCode, deps: [...deps] };
}

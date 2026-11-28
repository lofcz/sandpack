import initLightningcss, { bundleAsync, type CSSModuleExports } from 'lightningcss-wasm';
import { analyzeCss, type CssAnalysis } from '@lofcz/transpiler/css';

import { CompilationError } from '../../../errors/CompilationError';
import { extractModuleSpecifierParts, isModuleSpecifier } from '../../../resolver/utils/module-specifier';
import { join as joinPaths } from '../../../utils/path';
import { ITranspilationContext, ITranspilationResult } from '../Transformer';
import { shapeCssEngineError } from './css-error';
import { packageCssBase, rebasePackageCssUrls } from './package-urls';

let initPromise: Promise<void> | null = null;

function ensureLightningcss(): Promise<void> {
  if (!initPromise) {
    // The build emits the .wasm as a file of its own and puts that file's URL
    // here; lightningcss-wasm then fetches and compiles it. Do NOT import the
    // .wasm as an ES module: from Sandpack's opaque-origin iframe that request
    // hits the host's SPA HTML fallback ("MIME type of text/html").
    const wasmUrl = new URL('lightningcss-wasm/lightningcss_node.wasm', import.meta.url).href;
    initPromise = initLightningcss(wasmUrl).catch(error => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

// lightningcss-wasm suspends a bundle while a read or a resolve is awaited, on
// one saved stack (Asyncify). A second bundle started meanwhile overwrites it:
// both come back failed, or with rules missing. So one bundle at a time; the
// work itself is synchronous, only the waiting was ever shared.
let bundling: Promise<unknown> = Promise.resolve();
function bundleInTurn<T>(bundle: () => Promise<T>): Promise<T> {
  const turn = bundling.then(bundle);
  bundling = turn.catch(() => undefined);
  return turn;
}

/** `importer` is the file the `@import` is written in. */
async function resolveCSSFile(
  ctx: ITranspilationContext,
  path: string,
  importer: string
): Promise<string> {
  const isDependency = isModuleSpecifier(path);

  if (isDependency) {
    const parts = extractModuleSpecifierParts(path);
    if (!parts.filepath.length) {
      // Prefer package.json "style" field when present.
      try {
        const pkgJsonPath = await ctx.module.bundler.resolveAsync(
          joinPaths(path, 'package.json'),
          importer,
          []
        );
        const content = await ctx.module.bundler.fs.readFileAsync(pkgJsonPath);
        const parsedPkg = JSON.parse(content);

        if (typeof parsedPkg.style === 'string' && parsedPkg.style.length > 0) {
          path = joinPaths(path, parsedPkg.style);
        }
      } catch {
        /* fall through to .css resolve */
      }
    }
  }

  return ctx.module.bundler.resolveAsync(path, importer, ['.css']);
}

/**
 * A stylesheet whose class names are local to it, by the file name convention
 * bundlers share (`x.module.css`): importing it gives the map from the names
 * written in the file to the names they were given.
 */
export function isCssModule(filepath: string): boolean {
  return filepath.endsWith('.module.css');
}

/** What `styles.name` is: the class it was renamed to, then the classes it composes. */
function classNames(exported: CSSModuleExports): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [name, { name: local, composes }] of Object.entries(exported)) {
    const classes = [local];
    // A class composed from another file is that file's export; only names of
    // this bundle are known here.
    for (const reference of composes) if (reference.type !== 'dependency') classes.push(reference.name);
    names[name] = classes.join(' ');
  }
  return names;
}

function toCompilationError(err: unknown, fallbackPath: string): CompilationError {
  const shaped = shapeCssEngineError(err, fallbackPath);
  return new CompilationError(shaped, shaped.path ?? fallbackPath);
}

/**
 * Bundle CSS with lightningcss-wasm: modern syntax + generic @import resolution
 * against the Sandpack FS/resolver. Failures become CompilationError (no crash).
 */
export default async function cssLoader(ctx: ITranspilationContext): Promise<ITranspilationResult> {
  const entryPath = ctx.module.filepath;
  const dependencies = new Set<string>();
  const analyses = new Map<string, CssAnalysis>();

  try {
    await ensureLightningcss();

    const cssModules = isCssModule(entryPath);
    const result = await bundleInTurn(() => bundleAsync({
      filename: entryPath,
      minify: false,
      cssModules,
      resolver: {
        read: async (filePath: string) => {
          if (filePath !== entryPath) dependencies.add(filePath);
          let source = filePath === entryPath ? ctx.code ?? '' : await ctx.module.bundler.fs.readFileAsync(filePath);
          // Each file's url()s are relative to that file; bundling keeps them verbatim.
          const packageBase = packageCssBase(filePath, ctx.module.bundler.moduleRegistry);
          if (packageBase) source = rebasePackageCssUrls(source, packageBase);
          const analysis = analyzeCss(source);
          analyses.set(filePath, analysis);
          return analysis.resolverCss;
        },
        resolve: async (specifier: string, originatingFile: string) => {
          if (/^https?:\/\//i.test(specifier) || specifier.startsWith('data:')) {
            return { external: specifier };
          }
          try {
            return await resolveCSSFile(ctx, specifier, originatingFile);
          } catch (resolveErr) {
            const msg =
              resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
            const err = new Error(
              `Cannot resolve CSS import ${JSON.stringify(specifier)} from ${originatingFile}: ${msg}`
            ) as Error & { loc?: { filename: string; line: number; column: number } };
            err.loc = { filename: originatingFile, line: 1, column: 0 };
            throw err;
          }
        },
      },
    }));

    let code = new TextDecoder().decode(result.code);
    for (const analysis of analyses.values()) code = analysis.restoreImports(code);
    const usesCompiler = [...analyses.values()].some(analysis => analysis.requiresTailwind);
    const hasFrameworkImport = [...analyses.values()].some(analysis => analysis.tailwindImports.length > 0);
    if (usesCompiler && !hasFrameworkImport) code = `@import "tailwindcss";\n${code}`;
    const transpiled: { code: string; dependencies: Set<string>; exports?: Record<string, string> } = { code, dependencies };
    // Module.transpile emits these as the module's exports.
    if (cssModules) transpiled.exports = classNames(result.exports ?? {});
    return transpiled;
  } catch (err) {
    return toCompilationError(err, entryPath);
  }
}

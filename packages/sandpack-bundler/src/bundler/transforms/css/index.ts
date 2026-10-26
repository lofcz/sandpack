import { CompilationError } from '../../../errors/CompilationError';
import { ITranspilationContext, ITranspilationResult, Transformer } from '../Transformer';
import type * as CssLoader from './css-loader';
import { analyzeCss } from '@lofcz/transpiler/css';

export class CSSTransformer extends Transformer {
  private _loader: null | Promise<typeof CssLoader> = null;

  constructor() {
    super('css-transformer');
  }

  getLoader(): Promise<typeof CssLoader> {
    if (this._loader) {
      return this._loader;
    }
    this._loader = import('./css-loader');
    return this._loader;
  }

  async transform(ctx: ITranspilationContext, _config: unknown): Promise<ITranspilationResult> {
    try {
      const analysis = analyzeCss(ctx.code ?? '');
      // The loader owns parsing the complete CSS import graph, including compiler
      // directives in imported stylesheets. Pass the original source into it.
      if (analysis.requiresResolution) return await (await this.getLoader()).default(ctx);
      const code = analysis.requiresTailwind && !analysis.tailwindImports.length
        ? `@import "tailwindcss";\n${analysis.css}`
        : analysis.css;
      return { code, dependencies: new Set<string>() };
    } catch (err) {
      // Loader already returns CompilationError; this covers init/import failures.
      return new CompilationError(err as Error, ctx.module.filepath);
    }
  }
}

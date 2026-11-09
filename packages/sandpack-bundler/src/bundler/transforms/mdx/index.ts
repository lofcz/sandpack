import { Bundler } from '../../bundler';
import { ITranspilationContext, ITranspilationResult, Transformer } from '../Transformer';

import { BundlerError } from '../../../errors/BundlerError';
import {VFileMessage} from 'vfile-message'
import type { PluggableList } from 'unified';
import { parseFrontmatter } from '../../frontmatter';

export class MDXTransformer extends Transformer {

  private recmaPlugins:PluggableList = [];
  private rehypePlugins:PluggableList = [];

  constructor() {
    super('mdx-transformer');
  }

  async init(bundler: Bundler): Promise<void> {

  }

  async transform(ctx: ITranspilationContext, config: any): Promise<ITranspilationResult> {
    const {content} = parseFrontmatter(ctx.code);
    const file = {
      path: ctx.module.filepath,
      value: content
    };
    try {
      const [{ compile }, { default: remarkGfm }] = await Promise.all([
        import('@mdx-js/mdx'), import('remark-gfm'),
      ]);
      const compilerOutput = await compile(file, {
        development: true,
        jsx: true,
        providerImportSource: '@immediately-run/sdk/MDXProvider',
        outputFormat: 'program',
        recmaPlugins: this.recmaPlugins,
        rehypePlugins: this.rehypePlugins,
        remarkPlugins: [[remarkGfm]]
      })

      return {
        code: String(compilerOutput.value),
        // TODO: get required modeuls
        dependencies: new Set([]),
      };
    } catch (e) {
      const err = new BundlerError(String(e), ctx.module.filepath)
      if (e instanceof VFileMessage) {
        err.line = e.line;
        err.column = e.column;
        err.message = e.message;
      }
      return err
    }
  }
}

import { ITranspilationContext, ITranspilationResult, Transformer } from '../Transformer';
import { insertCss } from './insert-css';
import { usesTailwind } from '../css/tailwind';

const getStyleId = (id: string) => id + '-css';

export class StyleTransformer extends Transformer {
  constructor() {
    super('style-transformer');
  }

  async transform(ctx: ITranspilationContext, config: any): Promise<ITranspilationResult> {
    const id = getStyleId(ctx.module.id);
    const tailwind = usesTailwind(ctx.code);
    const result = insertCss(id, ctx.code, true, tailwind);
    const dependencies = new Set<string>();
    if (tailwind) dependencies.add('@tailwindcss/browser');
    return { code: result, dependencies };
  }
}

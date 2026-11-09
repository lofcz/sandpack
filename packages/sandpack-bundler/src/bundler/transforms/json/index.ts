import { CompilationError } from '../../../errors/CompilationError';
import { ITranspilationContext, ITranspilationResult, Transformer } from '../Transformer';

export class JsonTransformer extends Transformer {
  constructor() { super('json-transformer'); }

  async transform(ctx: ITranspilationContext): Promise<ITranspilationResult> {
    const source = ctx.code.replace(/^\uFEFF/, '');
    try {
      JSON.parse(source);
      // Object-literal code would change the meaning of a JSON "__proto__" key.
      return { code: `module.exports = JSON.parse(${JSON.stringify(source)});`, dependencies: new Set() };
    } catch (error) {
      return new CompilationError(error as Error, ctx.module.filepath);
    }
  }
}

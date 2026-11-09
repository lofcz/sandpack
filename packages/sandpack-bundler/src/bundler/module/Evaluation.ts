import * as logger from '../../utils/logger';
import evaluate, { getExtendedSwcHelpers } from './eval';
import { HotContext } from './hot';
import { Module } from './Module';
import { IMPORT_META_GLOBAL } from '@lofcz/transpiler/runtime';

class EvaluationContext {

  exports: any;
  globals: any;
  hot: HotContext;
  id: string;
  evaluation: Evaluation;

  constructor(evaluation: Evaluation) {
    this.exports = {};
    this.globals = {};
    this.hot = evaluation.module.hot;
    this.id = evaluation.module.id;
    this.evaluation = evaluation;
  }

  async dynamicImport(moduleToImport: string, symbolToImport = 'default'): Promise<any> {
    const evaluationContext = await this.getModuleEvaluationContext(moduleToImport);
    return symbolToImport == '*' ? evaluationContext.exports : evaluationContext.exports[symbolToImport];
  }

  async getModuleEvaluationContext(moduleName: string): Promise<EvaluationContext> {
    const resolvedModuleName = await this.resolve(moduleName);
    const bundler = this.evaluation.module.bundler;
    await this.evaluation.module.addDependency(resolvedModuleName);
    const moduleToEvaluate = await bundler.transformModule(resolvedModuleName);
    await bundler.moduleFinishedPromise(resolvedModuleName);
    return moduleToEvaluate.evaluate().context;
  }

  async resolve(moduleName: string): Promise<string> {
    return await this.evaluation.module.bundler.resolveAsync(
      moduleName,
      this.evaluation.module.filepath
    );
  }
}

export class Evaluation {
  module: Module;
  context: EvaluationContext;

  constructor(module: Module) {
    this.module = module;
    this.context = new EvaluationContext(this);
  }

  run(): void {
    const module = this.module;
    const code = module.compiled + `\n//# sourceURL=${location.origin}${module.filepath}`;
    this.context.exports = evaluate(code, this.require.bind(this), this.context, {}, {
      [IMPORT_META_GLOBAL]: Object.freeze({ url: new URL(module.filepath, location.href).href }),
    });
  }

  require(specifier: string): any {
    // SWC external-helpers emit (`var swcHelpers = require("@swc/helpers")`)
    // expects camelCase helpers. The npm CJS build is snake_case — serve the
    // same mapped namespace the eval scope injects as the `swcHelpers` global.
    if (specifier === '@swc/helpers') {
      return getExtendedSwcHelpers();
    }

    const moduleFilePath = this.module.dependencyMap.get(specifier);
    if (!moduleFilePath) {
      logger.debug('Require', {
        dependencies: this.module.dependencyMap,
        specifier,
      });

      throw new Error(`Dependency "${specifier}" not collected from "${this.module.filepath}"`);
    }
    const module = this.module.bundler.getModule(moduleFilePath);
    if (!module) {
      // Backstop: reaching require() with a module absent from the map means its
      // source never entered the transpile pipeline — almost always a FAILED SOURCE
      // FETCH (network error, or a GitHub REST rate limit returning 403). The old
      // wording ("has not been transpiled") sent debugging down a transpile/mount
      // rabbit hole; the load path now fails fast, but keep this honest as a backstop.
      throw new Error(
        `Module "${moduleFilePath}" is unavailable — its source was not loaded ` +
          `(commonly a failed fetch: a network error or a GitHub API rate limit), so it ` +
          `was never transpiled. Required by "${this.module.filepath}".`
      );
    }
    return module.evaluate().context.exports;
  }
}

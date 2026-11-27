import * as logger from '../../utils/logger';
import evaluate, { getExtendedSwcHelpers } from './eval';
import { HotContext } from './hot';
import { Module } from './Module';
import { IMPORT_META_GLOBAL } from '@lofcz/transpiler/runtime';
import { moduleSourceURL } from '../../error-listener/source-url';
import { npmFileUrl } from '../../FileSystem/npmFileUrl';
import { parseNodeModulePath } from '../module-registry/cdnLayoutResolve';

// What Vite defines for a dev build; code written for it reads these unguarded.
const IMPORT_META_ENV = Object.freeze({ MODE: 'development', DEV: true, PROD: false, SSR: false, BASE_URL: '/' });

/** Node's shape for a module that is not there: `code` is what guarded requires test. */
function moduleNotFound(message: string, cause?: unknown): Error {
  const error = new Error(message) as Error & { code: string; cause?: unknown };
  error.code = 'MODULE_NOT_FOUND';
  if (cause !== undefined) error.cause = cause;
  return error;
}

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
    const code = module.compiled + `\n//# sourceURL=${moduleSourceURL(module.filepath)}`;
    const require = Object.assign(this.require.bind(this), {
      resolve: this.resolve.bind(this),
      // Nothing is cached under a key code can name: an entry it deletes was never there.
      cache: {},
    });
    this.context.exports = evaluate(code, require, this.context, {}, {
      [IMPORT_META_GLOBAL]: Object.freeze({ url: this.url(), env: IMPORT_META_ENV, hot: this.context.hot }),
    });
  }

  /**
   * `import.meta.url`. A package file has a real address, the npm release it
   * came from, so `new URL('./x.wasm', import.meta.url)` can be fetched; an app
   * file exists only in the workspace and keeps its path on the page's URL.
   */
  private url(): string {
    const filepath = this.module.filepath;
    const inPackage = parseNodeModulePath(filepath);
    const release = inPackage ? this.module.bundler.moduleRegistry.modules.get(inPackage.pkg)?.release : undefined;
    if (inPackage && release) return npmFileUrl(release.name, release.version, inPackage.rel);
    return new URL(filepath, location.href).href;
  }

  /** `require.resolve`: the id `require` would load, without loading it. */
  resolve(specifier: string): string {
    const moduleFilePath = this.module.dependencyMap.get(specifier);
    if (!moduleFilePath) throw this.notLinked(specifier);
    return moduleFilePath;
  }

  /** Why `specifier` has no module to load: the error `require()` throws for it. */
  private notLinked(specifier: unknown): Error {
    const from = this.module.filepath;
    if (typeof specifier === 'string' && this.module.dependencyErrors.has(specifier)) {
      const cause = this.module.dependencyErrors.get(specifier);
      const reason = cause instanceof Error ? cause.message : String(cause);
      return moduleNotFound(`Cannot load "${specifier}" required by "${from}": ${reason}`, cause);
    }
    return moduleNotFound(
      `Cannot load ${typeof specifier === 'string' ? `"${specifier}"` : `a module named by ${typeof specifier}`} required by "${from}": ` +
        'it was not resolved when the module was built. Only specifiers written as string literals are; one computed when the code runs is not part of the build.'
    );
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
      // A built-in the bundler provides needs no build step: a specifier that
      // was not collected (a computed one, or a `node:` one the CDN's
      // dependency list left out) still loads.
      const provided = typeof specifier === 'string' ? this.module.bundler.moduleRegistry.builtin(specifier)?.path : undefined;
      const builtin = provided === undefined ? undefined : this.module.bundler.providedModule(provided);
      if (builtin) return builtin.evaluate().context.exports;

      logger.debug('Require', {
        dependencies: this.module.dependencyMap,
        specifier,
      });

      throw this.notLinked(specifier);
    }
    const module = this.module.bundler.getModule(moduleFilePath);
    if (!module) {
      // Backstop: the load path fails fast, so a module absent from the map here
      // was dropped from the build after it compiled (its file was deleted, or
      // reading it failed). Say which read failed when one did.
      const failure = this.module.bundler.loadFailure(moduleFilePath);
      throw new Error(
        `Module "${moduleFilePath}" (required by "${this.module.filepath}") is not part of the build` +
          (failure ? `: ${failure.message}` : ': its source was never loaded.')
      );
    }
    return module.evaluate().context.exports;
  }
}

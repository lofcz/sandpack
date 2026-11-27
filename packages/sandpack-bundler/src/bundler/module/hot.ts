import HMR from './HMR';
import { Module } from './Module';

export class HotContext {
  hmrConfig: HMR | null = null;

  constructor(private module: Module) {}

  get data() {
    return this.hmrConfig?.data;
  }

  clone(): HotContext {
    const cloned = new HotContext(this.module);
    const data = this.data;
    if (data) {
      const hmrConfig = cloned.ensureHMRConfig();
      hmrConfig.data = data;
    }
    return cloned;
  }

  /** Get hmr config, if it does not exist it will be created and this module marked as hot */
  ensureHMRConfig(): HMR {
    this.hmrConfig = this.hmrConfig ?? new HMR();
    this.module.bundler.enableHMR();
    return this.hmrConfig;
  }

  accept(path: string | string[], cb: () => any) {
    if (typeof path === 'undefined' || (typeof path !== 'string' && !Array.isArray(path))) {
      // Self mark hot
      const hmrConfig = this.ensureHMRConfig();
      hmrConfig.setType('accept');
      hmrConfig.setSelfAccepted(true);
    } else {
      const paths = typeof path === 'string' ? [path] : path;

      paths.forEach(async (p) => {
        const resolvedPath = await this.module.bundler.resolveAsync(p, this.module.filepath);
        const module = this.module.bundler.getModule(resolvedPath);
        if (module) {
          const hmrConfig = module.hot.ensureHMRConfig();
          hmrConfig.setType('accept');
          hmrConfig.setAcceptCallback(cb);
        }
      });
    }
  }

  decline(path: string | string[]) {
    if (typeof path === 'undefined') {
      const hmrConfig = this.ensureHMRConfig();
      hmrConfig.setType('decline');
      this.module.resetCompilation();
    } else {
      const paths = typeof path === 'string' ? [path] : path;

      paths.forEach(async (p) => {
        const resolvedPath = await this.module.bundler.resolveAsync(p, this.module.filepath);
        const module = this.module.bundler.getModule(resolvedPath);
        if (module) {
          const hmrConfig = module.hot.ensureHMRConfig();
          hmrConfig.setType('decline');
          module.resetCompilation();
        }
      });
    }
  }

  dispose(cb: () => void) {
    const hmrConfig = this.ensureHMRConfig();
    hmrConfig.setDisposeHandler(cb);
  }

  // Vite's `import.meta.hot` also has an event channel to its dev server.
  // There is none here: listeners are never called, messages go nowhere.
  on(_event: string, _cb: (...args: unknown[]) => void): void {}
  off(_event: string, _cb: (...args: unknown[]) => void): void {}
  send(_event: string, _data?: unknown): void {}
  prune(_cb: () => void): void {}

  /**
   * This module cannot take the update itself. The hot pass creates it once
   * more and hands the update to the modules that import it
   * (Bundler.applyHotUpdate): only once the pass has run them is it known
   * which of them accept updates.
   */
  invalidate() {
    const hmrConfig = this.ensureHMRConfig();

    // The data this instance was handed describes the one before it; the
    // instance created next starts from what this one disposes.
    hmrConfig.data = {};
    hmrConfig.setInvalidated(true);
  }
}

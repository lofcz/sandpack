// @ts-ignore
import * as swcHelpers from '@swc/helpers';

/* eslint-disable no-eval */
// import buildProcess from "./utils/process";
import * as logger from '../../utils/logger';

const g = typeof window === 'undefined' ? self : window;

const uppercaseFirst = (s: string) => {
  if (s.length == 0) {
    return s;
  }
  return s.substring(0, 1).toUpperCase() + s.substring(1);
}

const extendedSWCHelpers = {...swcHelpers, interopRequireDefault: swcHelpers._interop_require_default }
for (let [snake_case, v] of Object.entries(swcHelpers)) {
  const parts = snake_case.split("_").filter(p => p.length > 0);
  if (parts.length > 0) {
    const camelCase = [parts[0], ...(parts.slice(1).map(part => uppercaseFirst(part)))].join('')
    extendedSWCHelpers[camelCase] = v
  }
}

/** CamelCase + snake_case namespace matching SWC's `require("@swc/helpers")` emit. */
export function getExtendedSwcHelpers(): typeof extendedSWCHelpers {
  return extendedSWCHelpers;
}

const hasGlobalDeclaration = /^const global/m;

const noop = () => {};

/**
 * The `process` a module sees: the browser shim bundlers provide (as
 * `process/browser` does), shared by every module so an `env` write is seen by
 * all. Packages call more than `process.env` in browser builds: three 0.187's
 * CommonJS entry calls `process.emitWarning`, and a missing method failed the
 * whole preview with "process.emitWarning is not a function".
 */
const browserProcess = {
  env: { NODE_ENV: 'development' } as Record<string, string>,
  browser: true,
  title: 'browser',
  version: '',
  versions: {} as Record<string, string>,
  platform: 'browser',
  argv: [] as string[],
  execArgv: [] as string[],
  pid: 1,
  exitCode: undefined as number | undefined,
  cwd: () => '/',
  chdir: () => {
    throw new Error('process.chdir is not supported');
  },
  umask: () => 0,
  uptime: () => (typeof performance === 'undefined' ? 0 : performance.now() / 1000),
  hrtime: Object.assign(
    (previous?: [number, number]) => {
      const now = typeof performance === 'undefined' ? Date.now() : performance.now();
      const seconds = Math.floor(now / 1000);
      const nanos = Math.floor((now % 1000) * 1e6);
      if (!previous) return [seconds, nanos];
      const diff = (seconds - previous[0]) * 1e9 + nanos - previous[1];
      return [Math.floor(diff / 1e9), diff % 1e9];
    },
    { bigint: () => BigInt(Math.round((typeof performance === 'undefined' ? Date.now() : performance.now()) * 1e6)) }
  ),
  memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => {
    queueMicrotask(() => callback(...args));
  },
  emitWarning: (warning: unknown, ...rest: unknown[]) => {
    const type = typeof rest[0] === 'string' ? rest[0] : (rest[0] as { type?: string } | undefined)?.type;
    const text = warning instanceof Error ? warning.message : String(warning);
    console.warn(type ? `${type}: ${text}` : text);
  },
  on: noop,
  once: noop,
  off: noop,
  addListener: noop,
  removeListener: noop,
  removeAllListeners: noop,
  prependListener: noop,
  prependOnceListener: noop,
  emit: () => false,
  listeners: () => [],
  binding: () => {
    throw new Error('process.binding is not supported');
  },
  exit: noop,
  abort: noop,
  kill: noop,
};

/** The shared browser `process` shim. */
export function getBrowserProcess(): typeof browserProcess {
  return browserProcess;
}

/* eslint-disable no-unused-vars */
export default function (
  code: string,
  require: Function,
  context: { id: string; exports: any; hot?: any },
  env: Object = {},
  globals: Object = {}
) {
  const global = g;
  const process = browserProcess;
  // @ts-ignore
  g.global = global;

  const allGlobals: { [key: string]: any } = {
    require,
    module: context,
    exports: context.exports,
    process,
    global,
    swcHelpers: extendedSWCHelpers,
    ...globals,
  };

  if (hasGlobalDeclaration.test(code)) {
    delete allGlobals.global;
  }

  const allGlobalKeys = Object.keys(allGlobals);
  const globalsCode = allGlobalKeys.length ? allGlobalKeys.join(', ') : '';
  const globalsValues = allGlobalKeys.map((k) => allGlobals[k]);
  try {
    const newCode = `(function $csb$eval(` + globalsCode + `) {` + code + `\n})`;
    // @ts-ignore
    (0, eval)(newCode).apply(allGlobals.global, globalsValues);

    return context.exports;
  } catch (err) {
    logger.error(err);
    // Never console.error the whole module body — agent problem collection
    // folds console errors into lint and would dump 100KB+ of minified source.
    if (typeof code === 'string' && code.length > 240) {
      logger.error(`${code.slice(0, 240)}… [eval source truncated, ${code.length} chars]`);
    } else {
      logger.error(code);
    }

    let error = err;
    if (typeof err === 'string') {
      error = new Error(err);
    }
    // @ts-ignore
    error.isEvalError = true;

    throw error;
  }
}

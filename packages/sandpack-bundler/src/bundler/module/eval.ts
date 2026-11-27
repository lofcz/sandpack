// @ts-ignore
import * as swcHelpers from '@swc/helpers';

/* eslint-disable no-eval */
// import buildProcess from "./utils/process";
import { BundlerError } from '../../errors/BundlerError';
import * as logger from '../../utils/logger';
import { awaitsAtTopLevel } from './topLevelAwait';

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

// Node's `setImmediate`: a task after the current one, cancellable. Browsers
// have none, and code written for Node calls it without checking.
const setImmediateShim = (callback: (...args: unknown[]) => void, ...args: unknown[]) =>
  setTimeout(callback, 0, ...args);
const clearImmediateShim = (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle);

// What Node's module wrapper passes a CommonJS module, in this order.
const MODULE_PARAMETERS = 'exports, require, module, __filename, __dirname';

/* eslint-disable no-unused-vars */
export default function (
  code: string,
  require: Function,
  context: { id: string; exports: any; hot?: any },
  env: Object = {},
  globals: Object = {}
) {
  const global = g;
  // @ts-ignore
  g.global = global;

  // Names that are globals in Node. The page has no such globals, so they are
  // the parameters of a function around the module's own.
  const ambient: { [key: string]: any } = {
    process: browserProcess,
    global,
    setImmediate: setImmediateShim,
    clearImmediate: clearImmediateShim,
    swcHelpers: extendedSWCHelpers,
    ...globals,
  };
  const ambientNames = Object.keys(ambient);

  let run: (this: unknown, ...parameters: unknown[]) => void;
  try {
    // The module is the body of the inner function, as it is the body of Node's
    // wrapper: its own `const process` or `class Buffer` shadows the ambient
    // name (in one function, a parameter and a `const` of the same name is a
    // SyntaxError). Nothing precedes the code on its first line, so line
    // numbers are the module's own.
    const source =
      '(function (' + ambientNames.join(', ') + ') { return function $csb$eval(' + MODULE_PARAMETERS + ') {' + code + '\n} })';
    // @ts-ignore
    run = (0, eval)(source).apply(undefined, ambientNames.map((name) => ambient[name]));
  } catch (err) {
    throw evalError(unsupportedSyntax(err, code, context.id) ?? err, code);
  }
  try {
    // Top-level `this` of a CommonJS module is `module.exports`. (A compiled
    // ES module has none: its top-level `this` is rewritten to `undefined`.)
    // `__filename` and `__dirname` are what webpack 5 gives a browser build.
    run.call(context.exports, context.exports, require, context, '/index.js', '/');

    return context.exports;
  } catch (err) {
    throw evalError(err, code);
  }
}

/**
 * Why code that does not parse as a module body is not supported, when the
 * reason is known. Only looked for once evaluation has failed.
 */
function unsupportedSyntax(err: unknown, code: string, path: string): BundlerError | null {
  if (!(err instanceof SyntaxError) || !awaitsAtTopLevel(code)) return null;
  const error = new BundlerError(
    `Top-level await is not supported: ${path} uses \`await\` outside a function. Move that code into an async function and call it.`,
    path
  );
  error.title = 'Top-level await is not supported';
  return error;
}

function evalError(err: unknown, code: string): unknown {
  // A module that could not be loaded is for the code that required it to
  // handle (a guarded require), as in Node; it is reported if nothing does.
  if ((err as { code?: unknown } | null)?.code === 'MODULE_NOT_FOUND') {
    logger.debug(err);
    (err as { isEvalError?: boolean }).isEvalError = true;
    return err;
  }
  {
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

    return error;
  }
}

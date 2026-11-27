import { EMPTY_SHIM } from '../resolver/utils/constants';

/**
 * Node's built-in modules in a browser build. A package written for Node and
 * the browser imports `path`, `events` or `node:buffer` and expects what
 * webpack 5's documented `resolve.fallback` set gives it: the browser
 * implementation the Node ecosystem publishes on npm for the modules that have
 * one, and an empty object for the ones that only make sense on a server
 * (`resolve.fallback: { fs: false }`).
 *
 * The implementations are ordinary npm packages installed through the package
 * CDN when something imports them, at the version pinned here unless the
 * build already holds that package: they share instances with the packages
 * that depend on them (one `Buffer`, one `EventEmitter`), are cached like any
 * other package, and a build that imports none of them pays for none of them.
 */

/** A browser implementation published on npm. */
export interface BuiltinPackage {
  /** What to resolve instead (`os` → `os-browserify/browser`). */
  specifier: string;
  name: string;
  /** The version to install when the build does not hold the package yet. */
  range: string;
}

export type NodeBuiltin =
  // A module the bundler provides itself (`providedModuleCode`).
  | { path: string; package?: undefined }
  | { path?: undefined; package: BuiltinPackage };

const PROCESS_MODULE = '/node-builtins/process.js';
const FS_MODULE = '/node-builtins/fs.js';
const FS_PROMISES_MODULE = '/node-builtins/fs-promises.js';

// The shared filesystem the host exposes to app code (async APIs over the
// parent's files); an empty object without one, as for any server-only module.
const SHARED_FS = '(typeof globalThis !== "undefined" && globalThis.__sandpackSharedFs)';

/** Modules the bundler provides: their code, already CommonJS. */
const PROVIDED_MODULES: Record<string, string> = {
  // An object, as webpack's `false` fallback is: code reads properties off it.
  [EMPTY_SHIM]: 'module.exports = {};',
  // The `process` every module already sees, so `require("process")` is the same object.
  [PROCESS_MODULE]: 'module.exports = process;',
  [FS_MODULE]: `module.exports = ${SHARED_FS} || {};`,
  [FS_PROMISES_MODULE]: `module.exports = (${SHARED_FS} || {}).promises || {};`,
};

/** The code of a module the bundler provides at `path`, if it is one. */
export function providedModuleCode(path: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(PROVIDED_MODULES, path) ? PROVIDED_MODULES[path] : undefined;
}

const EMPTY: NodeBuiltin = { path: EMPTY_SHIM };

const implementation = (specifier: string, range: string): NodeBuiltin => {
  const segments = specifier.split('/');
  const name = specifier[0] === '@' ? segments.slice(0, 2).join('/') : segments[0];
  return { package: { specifier, name, range } };
};

const TABLE = new Map<string, NodeBuiltin>([
  // webpack 5's `resolve.fallback` set.
  ['assert', implementation('assert', '2.1.0')],
  ['assert/strict', implementation('assert', '2.1.0')],
  ['buffer', implementation('buffer', '6.0.3')],
  ['console', implementation('console-browserify', '1.2.0')],
  ['constants', implementation('constants-browserify', '1.0.0')],
  ['domain', implementation('domain-browser', '5.7.0')],
  ['events', implementation('events', '3.3.0')],
  ['http', implementation('stream-http', '3.2.0')],
  ['https', implementation('https-browserify', '1.0.0')],
  ['os', implementation('os-browserify/browser', '0.3.0')],
  ['path', implementation('path-browserify', '1.0.1')],
  ['path/posix', implementation('path-browserify', '1.0.1')],
  ['punycode', implementation('punycode', '2.3.1')],
  ['querystring', implementation('querystring-es3', '0.2.1')],
  ['stream', implementation('stream-browserify', '3.0.0')],
  ['string_decoder', implementation('string_decoder', '1.3.0')],
  ['sys', implementation('util', '0.12.5')],
  ['timers', implementation('timers-browserify', '2.0.12')],
  ['tty', implementation('tty-browserify', '0.0.1')],
  ['url', implementation('url', '0.11.4')],
  ['util', implementation('util', '0.12.5')],
  ['util/types', implementation('util/support/types', '0.12.5')],
  ['vm', implementation('vm-browserify', '1.1.2')],
  ['zlib', implementation('browserify-zlib', '0.2.0')],

  ['process', { path: PROCESS_MODULE }],
  ['fs', { path: FS_MODULE }],
  ['fs/promises', { path: FS_PROMISES_MODULE }],

  // Server-only: an empty object.
  ...[
    'async_hooks',
    'child_process',
    'cluster',
    // Not `crypto-browserify`: its dependencies need two major versions of
    // `readable-stream` and of `bn.js`, and an install holds one version per
    // name, so it does not load here. Browser code uses `globalThis.crypto`.
    'crypto',
    'dgram',
    'diagnostics_channel',
    'dns',
    'dns/promises',
    'http2',
    'inspector',
    'inspector/promises',
    'module',
    'net',
    'path/win32',
    'perf_hooks',
    'readline',
    'readline/promises',
    'repl',
    'stream/consumers',
    'stream/promises',
    'stream/web',
    'timers/promises',
    'tls',
    'trace_events',
    'v8',
    'wasi',
    'worker_threads',
  ].map((name): [string, NodeBuiltin] => [name, EMPTY]),
]);

const NODE_SCHEME = 'node:';

/**
 * What a specifier naming a Node built-in loads in the browser, or null when
 * it does not name one. `node:name` and `name` are the same module; a
 * trailing slash (`process/`, Node's way to skip the built-in for the npm
 * package of that name) means the same thing in a browser build.
 */
export function nodeBuiltin(specifier: string): NodeBuiltin | null {
  const prefixed = specifier.startsWith(NODE_SCHEME);
  let name = prefixed ? specifier.slice(NODE_SCHEME.length) : specifier;
  if (name.endsWith('/')) name = name.slice(0, -1);
  // `node:` only ever names a built-in: one this table does not know is server-only.
  return TABLE.get(name) ?? (prefixed ? EMPTY : null);
}

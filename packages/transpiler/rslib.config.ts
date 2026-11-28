import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type LibConfig } from '@rslib/core';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The polyfill-provider helper of the core-js plugin, wherever the package
// manager put it (it is the plugin's dependency, not this package's).
const corejsPlugin = createRequire(import.meta.url).resolve('babel-plugin-polyfill-corejs3/package.json');
const polyfillProvider = dirname(
  createRequire(corejsPlugin).resolve('@babel/helper-define-polyfill-provider/package.json'),
);

// `src/index.ts` is the package root both the CLI and the sandbox iframe consume.
// `src/babel/worker-api.ts` (→ `dist/babel/worker-api.js`) is the narrow surface
// the transform worker bundles. `src/css.ts` is shared with authoring without
// loading Babel or MDX, and `src/runtime.ts` is the compiler-free entry of the
// preview iframe.
const entries = {
  index: './src/index.ts',
  'babel/worker-api': './src/babel/worker-api.ts',
  css: './src/css.ts',
  runtime: './src/runtime.ts',
};

const dts = { bundle: true, autoExtension: true };

// Every entry is ONE self-contained file, as a consumer's bundler and the
// toolchain hash expect. Rspack's ESM output would add files: a module that two
// entries of one build share moves into a chunk of its own, so each ESM entry is
// a build of its own. (CommonJS output repeats the module instead.)
const esmEntry = (name: keyof typeof entries, extra: Partial<LibConfig> = {}): LibConfig => ({
  id: `esm-${name.replace('/', '-')}`,
  format: 'esm',
  source: { entry: { [name]: entries[name] } },
  dts,
  ...extra,
});

// The two entries with the Babel chain bundle the core-js plugin, whose data
// helpers are CommonJS. Rslib's default ESM library puts the module runtime
// such code needs into one more file; Rspack's `module` library keeps it
// inside the entry.
const withInlineRuntime: Partial<LibConfig> = {
  tools: {
    rspack: (config) => {
      config.output ??= {};
      config.output.library = { type: 'module' };
      config.optimization ??= {};
      config.optimization.concatenateModules = true;
    },
  },
};

const esm = [
  esmEntry('index', withInlineRuntime),
  esmEntry('babel/worker-api', withInlineRuntime),
  esmEntry('css'),
  esmEntry('runtime'),
];

// The prebuilt same-origin transform worker, `worker/babel-worker.js`: ONE
// self-contained classic script (the host spawns it with `new Worker(url)`, not
// as a module worker), holding the Babel chain and the MDX compile.
const worker: LibConfig = {
  id: 'worker',
  format: 'iife',
  source: {
    entry: { 'babel-worker': './worker-src/babel-worker.ts' },
    define: { 'process.env.NODE_ENV': '"production"' },
  },
  output: {
    target: 'web',
    distPath: { root: 'worker' },
    autoExternal: false,
    // A classic script, not a module: its top-level scope is the worker's
    // global scope, so the minifier must keep the wrapping function.
    minify: { jsOptions: { minimizerOptions: { module: false } } },
    sourceMap: false,
    legalComments: 'none',
  },
  tools: {
    rspack: (config) => {
      config.target = 'webworker';
      // A worker has no DOM. Packages that ship a DOM-free build name it with
      // the `worker` condition (decode-named-character-reference's `browser`
      // build calls `document.createElement`).
      config.resolve ??= {};
      config.resolve.conditionNames = ['worker', '...'];
      // React Refresh hashes hook signatures with Node's `crypto`. Scoped to
      // react-refresh, so any other use of a Node built-in still fails the
      // build instead of being stubbed.
      config.module ??= {};
      config.module.rules ??= [];
      config.module.rules.push({
        test: /[\\/]node_modules[\\/]react-refresh[\\/]/,
        resolve: { alias: { crypto: fromRoot('./shims/crypto.mjs') } },
      });
    },
  },
};

export default defineConfig({
  lib: [...esm, { id: 'cjs', format: 'cjs', source: { entry: entries }, dts }, worker],
  syntax: 'es2020',
  output: {
    sourceMap: true,
    // Dependencies stay external, so every consumer runs the pinned Babel,
    // react-refresh and MDX releases it installed (their versions are part of
    // the toolchain stamp). The shared remark plugins are the exception: they
    // are inlined, so consumers gain no transitive runtime dependency and the
    // compiled MDX bytes cannot drift from this package's version.
    autoExternal: { exclude: ['@immediately-run/mdx-plugins'] },
  },
  // The core-js plugin (a devDependency, so it is inlined too) and what it
  // imports are resolved so that the standalone Babel build stays the only
  // compiler and the only source of browser data in any output.
  resolve: {
    alias: {
      '@babel/core': fromRoot('./shims/babel-core.mjs'),
      browserslist: fromRoot('./shims/browserslist.mjs'),
      // The index of core-js entry points (`import 'core-js/stable'`), read
      // only by the plugin's `entry-global` method. The chain uses `usage-global`.
      'core-js-compat/entries.json': fromRoot('./shims/core-js-entries.json'),
      // The build that does not look for an installed core-js on disk: the
      // CLI and the worker must make the same decisions.
      '@babel/helper-define-polyfill-provider': join(polyfillProvider, 'lib/index.browser.js'),
    },
  },
  tools: {
    rspack: {
      module: {
        rules: [
          // These two read `namespace.default || namespace` to accept both of
          // Babel's module formats; the missing `default` is expected.
          {
            test: /[\\/]node_modules[\\/](?:babel-plugin-polyfill-corejs3|@babel[\\/]helper-define-polyfill-provider)[\\/]/,
            parser: { exportsPresence: false },
          },
          // The provider asks `isRequired` the same questions over and over;
          // it gets the remembering wrapper (shims/compilation-targets.mjs).
          {
            test: /[\\/]node_modules[\\/]@babel[\\/]helper-define-polyfill-provider[\\/]/,
            resolve: {
              alias: { '@babel/helper-compilation-targets': fromRoot('./shims/compilation-targets.mjs') },
            },
          },
        ],
      },
    },
  },
});

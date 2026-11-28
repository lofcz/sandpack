import * as babel from '@babel/standalone';
// Bundled into this package, with its `@babel/core` import resolved to the
// standalone engine above (rslib.config.ts): one compiler, and the data that
// decides which polyfills a file gets is the data this version was built with.
// (The plugin ships no types.)
import polyfillCorejs3 from 'babel-plugin-polyfill-corejs3';

import { loadPlugin, loadPreset } from './babel-plugin-registry';
import { collectDependencies, collectedDependencies } from './dep-collector';
import { importMetaShim } from './import-meta-shim';
import { tsUninitializedFields } from './ts-uninitialized-fields';

type BabelOptions = Parameters<typeof babel.transform>[1];
type PluginItem = NonNullable<BabelOptions['plugins']>[number];
type PresetItem = NonNullable<BabelOptions['presets']>[number];
type PresetObject = ReturnType<Parameters<typeof babel.registerPreset>[1]>;

export interface ITransformData {
  code: string;
  filepath: string;
  config: any;
}

export interface BabelTransformResult {
  code: string;
  dependencies: Set<string>;
}

/** The browsers compiled modules must run in (a browserslist query). */
const TARGETS = '> 2.5%, not ie 11, not dead, not op_mini all';

/**
 * The core-js release the injected polyfill imports are chosen from: the one
 * materials install (`augmentDependencies` in presets/react.ts; keep the two
 * together). Only modules of this release are imported, so a built-in core-js
 * learned later than the release named here would run unpolyfilled where a
 * browser lacks it (`RegExp.escape`, `Error.isError`, `Math.sumPrecise`,
 * `DisposableStack`, ...).
 */
const CORE_JS_VERSION = '3.51';

/**
 * Chains built by releases that still ran Babel 7 name this plugin. `using`
 * is now lowered by preset-env wherever a target needs it, so the name is
 * accepted and adds nothing.
 */
const LEGACY_PLUGINS = new Set(['@babel/plugin-proposal-explicit-resource-management']);

function getNameFromConfigEntry(entry: any): string | null {
  if (typeof entry === 'string') {
    return entry;
  } else if (Array.isArray(entry) && typeof entry[0] === 'string') {
    return entry[0];
  } else {
    return null;
  }
}

// Babel 8's preset-env no longer injects core-js imports itself (`useBuiltIns`
// is gone); this plugin does. Babel 7's preset-env appended it to its own
// plugin list. Presets apply last to first, so a preset placed first runs in
// that same position: after every syntax transform, over the code they produced.
const corejs: PluginItem = [polyfillCorejs3, { method: 'usage-global', version: CORE_JS_VERSION }];
const polyfills: PresetObject = { plugins: [corejs] };
const polyfillPreset: PresetItem = () => polyfills;

// TODO: Normalize preset names
async function getPresets(presets: any): Promise<PresetItem[]> {
  const result: PresetItem[] = [
    polyfillPreset,
    [
      'env',
      {
        // Babel 8 leaves `import`/`export` alone unless told otherwise; the
        // sandbox evaluates CommonJS.
        modules: 'commonjs',
        exclude: ['@babel/plugin-transform-regenerator'],
      },
    ],
    // Babel 8 keeps an import whose bindings are only used as types unless it
    // is written `import type`. Materials are not written that way, and such
    // an import would become a `require()` of a module that may not exist.
    ['typescript', { onlyRemoveTypeImports: false }],
  ];
  if (!Array.isArray(presets)) {
    return result;
  }
  for (const preset of presets) {
    const presetName = getNameFromConfigEntry(preset);
    if (presetName !== null) {
      if (!(babel.availablePresets as Record<string, unknown>)[presetName]) {
        babel.registerPreset(presetName, await loadPreset(presetName));
      }

      const foundIndex = result.findIndex((v) => getNameFromConfigEntry(v) === presetName);
      if (foundIndex > -1) {
        result[foundIndex] = preset;
        continue;
      }
    }
    result.push(preset);
  }
  return result;
}

// TODO: Normalize plugin names
async function getPlugins(plugins: any): Promise<PluginItem[]> {
  const result: PluginItem[] = [];
  if (!Array.isArray(plugins)) {
    return result;
  }
  for (const plugin of plugins) {
    const pluginName = getNameFromConfigEntry(plugin);
    if (pluginName !== null) {
      if (LEGACY_PLUGINS.has(pluginName)) {
        continue;
      }
      if (!babel.availablePlugins[pluginName]) {
        babel.registerPlugin(pluginName, await loadPlugin(pluginName));
      }

      const foundIndex = result.findIndex((v) => getNameFromConfigEntry(v) === pluginName);
      if (foundIndex > -1) {
        result[foundIndex] = plugin;
        continue;
      }
    }
    result.push(plugin);
  }
  return result;
}

interface Chain {
  presets: PresetItem[];
  plugins: PluginItem[];
}

async function buildChain(config: any): Promise<Chain> {
  const presets = await getPresets(config?.presets ?? []);
  const plugins = await getPlugins(config?.plugins ?? []);
  // Always-on plugins, NOT config-driven: the configs are the byte-identity
  // contract and these apply to every chain variant equally.
  plugins.push(tsUninitializedFields);
  // R3-328: rewrite `import.meta` syntax before anything evaluates it — the emitted
  // `$ir_import_meta` identifier is provided per-module by the runtime (frozen
  // `{ url }`).
  plugins.push(importMetaShim);
  plugins.push(collectDependencies);
  return { presets, plugins };
}

// Babel resolves a preset (for preset-env: the browser query and the plugin
// list it implies) again whenever it is handed a new `presets` array, and that
// costs more than transforming a small file. A config arrives as a fresh
// object with every request, so chains are kept by the config's content.
const MAX_CACHED_CHAINS = 32;
const chains = new Map<string, Promise<Chain>>();

/** The config as a cache key, or `null` when it holds something JSON would lose. */
function chainKey(config: unknown): string | null {
  let plain = true;
  const key = JSON.stringify(config ?? null, (_key, value) => {
    if (typeof value === 'function') plain = false;
    else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      if (Object.prototype.toString.call(value) !== '[object Object]') plain = false;
    }
    return value;
  });
  return plain ? key : null;
}

function getChain(config: unknown): Promise<Chain> {
  const key = chainKey(config);
  if (key === null) return buildChain(config);
  let chain = chains.get(key);
  if (!chain) {
    if (chains.size >= MAX_CACHED_CHAINS) chains.clear();
    chain = buildChain(config);
    chains.set(key, chain);
    chain.catch(() => chains.delete(key));
  }
  return chain;
}

/**
 * The Babel half of the per-file chain — moved from
 * sandbox/src/bundler/transforms/babel/babel-worker.ts (the worker transport,
 * WorkerMessageBus and logger left behind in sandbox). The `babel.transform`
 * options here ARE the toolchain contract: any change to presets/plugins/flags
 * changes the emitted bytes and so MUST bump the package version (§4.4).
 */
export async function transformBabel({
  code,
  filepath,
  config,
}: ITransformData): Promise<BabelTransformResult> {
  const { presets, plugins } = await getChain(config);
  const transformed = babel.transform(code, {
    filename: filepath,
    // Babel 8 presets read defaults from the environment name (preset-react
    // emits the development JSX runtime in `development`), and that name comes
    // from NODE_ENV when it is not given. The CLI and the worker must emit the
    // same bytes whatever their NODE_ENV is.
    envName: 'production',
    targets: TARGETS,
    presets,
    plugins,
    // no ast needed for now
    ast: false,
    sourceMaps: 'inline',
    compact: /node_modules/.test(filepath),
  });

  return {
    // no-op module
    code: transformed?.code || 'module.exports = {};',
    dependencies: collectedDependencies(transformed?.metadata),
  };
}

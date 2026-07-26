// Lazy loaders for the Babel plugins/presets referenced by the react chain that
// are not built into @babel/standalone. Moved from
// sandbox/src/bundler/transforms/babel/babel-plugin-registry.ts; the v1
// transpiler covers the `react` preset only, so the solid loaders are dropped
// (they were never reachable from the react chain — see ReactPreset.mapTransformers).
//
// The dynamic `import()`s are left as runtime imports (the package marks these
// external); they resolve to the consumer's installed, version-pinned copy so
// the produced bytes match across the sandbox and the CLI (§4.4 stamp).
type LoaderFn = () => Promise<any>;

const loaderCache: Map<string, Promise<any>> = new Map();

const BABEL_PRESET_LOADERS: Map<string, LoaderFn> = new Map();

const BABEL_PLUGIN_LOADERS: Map<string, LoaderFn> = new Map([
  [
    'react-refresh/babel',
    () => {
      // @ts-ignore - no types shipped for the babel entry point
      return import('react-refresh/babel');
    },
  ],
  [
    '@babel/plugin-proposal-explicit-resource-management',
    () => {
      // @ts-ignore - no types shipped
      return import('@babel/plugin-proposal-explicit-resource-management');
    },
  ],
]);

function load(key: string, loader: LoaderFn): Promise<any> {
  let cached = loaderCache.get(key);
  if (!cached) {
    cached = loader().then((val) => val.default ?? val);
    loaderCache.set(key, cached);
  }
  return cached;
}

export function loadPreset(name: string): Promise<any> {
  const foundLoader = BABEL_PRESET_LOADERS.get(name);
  if (!foundLoader) {
    return Promise.reject(new Error(`Preset loader ${name} not found`));
  }
  return load(`preset-${name}`, foundLoader);
}

export function loadPlugin(name: string): Promise<any> {
  const foundLoader = BABEL_PLUGIN_LOADERS.get(name);
  if (!foundLoader) {
    return Promise.reject(new Error(`Plugin loader ${name} not found`));
  }
  return load(`plugin-${name}`, foundLoader);
}

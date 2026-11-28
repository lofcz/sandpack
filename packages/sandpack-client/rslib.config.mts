import { readFileSync } from "node:fs";

import { defineConfig, type RsbuildPlugin } from "@rslib/core";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

/**
 * The console hook runs inside the preview document, so it ships as source
 * text: the "hook" lib bundles and minifies it (with console-feed), and this
 * plugin republishes that file as a module whose default export is the text.
 * The clients import it from src/inject-scripts/dist/consoleHook.js.
 */
const emitAsStringModule = (): RsbuildPlugin => ({
  name: "sandpack:emit-as-string-module",
  setup(api) {
    api.processAssets(
      { stage: "summarize" },
      ({ assets, compilation, sources }) => {
        for (const [name, asset] of Object.entries(assets)) {
          if (!name.endsWith(".js")) continue;
          const code = asset.source().toString().trim();
          compilation.updateAsset(
            name,
            new sources.RawSource(`export default ${JSON.stringify(code)};\n`),
          );
        }
      },
    );
  },
});

/**
 * loadSandpackClient() picks its client with import(), and Rslib leaves
 * import() as written in CommonJS output. This package's CommonJS build has
 * always loaded the client with require(), which also works where CommonJS
 * code cannot import() (Jest's default runtime, for one), so it still does.
 */
const requireRelativeDynamicImports = (): RsbuildPlugin => ({
  name: "sandpack:require-relative-dynamic-imports",
  setup(api) {
    api.processAssets(
      { stage: "summarize" },
      ({ assets, compilation, sources }) => {
        for (const [name, asset] of Object.entries(assets)) {
          if (!name.endsWith(".js")) continue;
          const code = asset.source().toString();
          const next = code.replace(
            /\bimport\(("\.{1,2}\/[^"]+")\)/g,
            "Promise.resolve().then(() => require($1))",
          );
          if (next !== code) {
            compilation.updateAsset(name, new sources.RawSource(next));
          }
        }
      },
    );
  },
});

// Nothing here cleans its output: in watch mode Rsbuild would do that after
// the hook has been written, and the three libs share directories. The
// `clean` script (run by `prebuild` and `dev`) empties them instead.
export default defineConfig({
  lib: [
    {
      id: "hook",
      format: "iife",
      syntax: "es2022",
      dts: false,
      source: {
        entry: { consoleHook: "./src/inject-scripts/consoleHook.ts" },
      },
      output: {
        target: "web",
        distPath: { root: "./src/inject-scripts/dist" },
        cleanDistPath: false,
        minify: true,
      },
      plugins: [emitAsStringModule()],
    },
    // One output module per source module, so the entries that package.json
    // exports (index, utils, clients/*) share a single instance of everything
    // they have in common, in both formats.
    ...(["esm", "cjs"] as const).map((format) => ({
      id: format,
      format,
      bundle: false,
      syntax: "es2022" as const,
      outBase: "./src",
      dts: format === "esm",
      source: {
        entry: {
          index: [
            "./src/**/*.ts",
            "./src/inject-scripts/dist/consoleHook.js",
            "!./src/**/*.test.ts",
            "!./src/inject-scripts/consoleHook.ts",
          ],
        },
        tsconfigPath: "./tsconfig.build.json",
        define: {
          global: "globalThis",
          "process.env.CODESANDBOX_ENV": JSON.stringify(
            String(process.env.CODESANDBOX_ENV),
          ),
          "process.env.PACKAGE_VERSION": JSON.stringify(pkg.version),
        },
      },
      output: { target: "web" as const, cleanDistPath: false },
      plugins: format === "cjs" ? [requireRelativeDynamicImports()] : [],
      // The hook text has to exist before the clients that embed it compile.
      tools: { rspack: { dependencies: ["hook"] } },
    })),
  ],
});

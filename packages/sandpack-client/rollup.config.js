import os from "os";

import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import { string } from "rollup-plugin-string";

import pkg from "./package.json";

// @rollup/plugin-terser falls back to `os.cpus().length` when maxWorkers is
// unset. In restricted environments (sandboxes, some CI runners) that can
// return 0, which causes the worker pool to never spawn a worker and the
// build to hang with "Unexpected early exit. (terser) renderChunk".
const TERSER_MAX_WORKERS = Math.max(os.cpus().length || 0, 1);

const configs = [
  {
    input: "src/inject-scripts/consoleHook.ts",
    output: {
      file: "src/inject-scripts/dist/consoleHook.js",
      format: "es",
    },
    plugins: [
      typescript({
        tsconfig: "./tsconfig.json",
        compilerOptions: {
          declaration: false,
          declarationMap: false,
          emitDeclarationOnly: false,
          outDir: "src/inject-scripts/dist",
        },
      }),
      commonjs(),
      nodeResolve(),
      terser({ compress: { passes: 2 }, maxWorkers: TERSER_MAX_WORKERS }),
    ],
    external: [],
  },

  {
    input: {
      index: "src/index.ts",
      utils: "src/utils.ts",
      "clients/node/index": "src/clients/node/index.ts",
      "clients/runtime/index": "src/clients/runtime/index.ts",
    },
    output: [
      {
        dir: "dist",
        format: "cjs",
      },
      {
        dir: "dist",
        chunkFileNames: "[name]-[hash].mjs",
        entryFileNames: "[name].mjs",
        format: "es",
      },
    ],

    plugins: [
      typescript({
        tsconfig: "./tsconfig.json",
        compilerOptions: {
          emitDeclarationOnly: false,
          outDir: "dist",
        },
      }),
      string({ include: "**/dist/consoleHook.js" }),
      replace({
        preventAssignment: true,
        values: {
          global: "globalThis",
          "process.env.CODESANDBOX_ENV": `"${process.env.CODESANDBOX_ENV}"`,
          "process.env.PACKAGE_VERSION": `"${pkg.version}"`,
        },
      }),
    ],
    external: Object.keys({
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
    }),
  },
];

export default configs;

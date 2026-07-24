/* eslint-disable @typescript-eslint/no-var-requires */
const commonjs = require("@rollup/plugin-commonjs");
const replace = require("@rollup/plugin-replace");
const typescript = require("@rollup/plugin-typescript");
const { vanillaExtractPlugin } = require("@vanilla-extract/rollup-plugin");
const filesize = require("rollup-plugin-filesize");

const sandpackClientPkg = require("../sandpack-client/package.json");

const pkg = require("./package.json");
const generateUnstyledTypes = require("./scripts/rollup-generate-unstyled-types");
const inlineCssText = require("./scripts/rollup-inline-css-text");
const stubCss = require("./scripts/rollup-stub-css");
const dts = require("rollup-plugin-dts").dts;

const basePlugins = [commonjs({ requireReturnsDefault: "preferred" })];

const externalPackages = [
  "react/jsx-runtime",
  ...Object.keys(pkg.dependencies),
  ...Object.keys(pkg.devDependencies),
  ...Object.keys(pkg.peerDependencies),
];

const external = (id) => {
  if (externalPackages.includes(id)) return true;
  return externalPackages.some((pkgName) => id.startsWith(`${pkgName}/`));
};

const baseConfig = { input: "src/index.ts", external };

const configBase = [
  {
    ...baseConfig,
    plugins: basePlugins.concat(
      vanillaExtractPlugin({
        extract: { name: "styles.css" },
      }),
      replace({
        preventAssignment: true,
        values: {
          "process.env.TEST_ENV": "false",
          "process.env.SANDPACK_UNSTYLED_COMPONENTS": `"false"`,
          "process.env.SANDPACK_CLIENT_VERSION": `"${sandpackClientPkg.version}"`,
        },
      }),
      typescript({ tsconfig: "./tsconfig.json" }),
      inlineCssText({ cssFileName: "styles.css" }),
      filesize(),
    ),
    output: [
      {
        dir: "dist",
        exports: "named",
        format: "cjs",
        inlineDynamicImports: true,
        interop: "auto",
        banner: `"use client";\n`,
        preserveModules: false,
        assetFileNames: "[name][extname]",
      },
      {
        dir: "dist",
        chunkFileNames: "[name]-[hash].mjs",
        entryFileNames: "[name].mjs",
        exports: "named",
        format: "es",
        inlineDynamicImports: true,
        banner: `"use client";\n`,
        preserveModules: false,
        assetFileNames: "[name][extname]",
      },
    ],
  },

  {
    ...baseConfig,
    treeshake: {
      preset: "smallest",
    },
    plugins: basePlugins.concat(
      stubCss(),
      replace({
        preventAssignment: true,
        values: {
          "process.env.TEST_ENV": "false",
          "process.env.SANDPACK_UNSTYLED_COMPONENTS": `"true"`,
        },
      }),
      typescript({
        tsconfig: "./tsconfig.json",
        compilerOptions: { outDir: "dist/unstyled/" },
      }),
      generateUnstyledTypes(),
      filesize(),
    ),
    output: [
      {
        dir: "dist/unstyled",
        exports: "named",
        format: "cjs",
        inlineDynamicImports: true,
        interop: "auto",
      },
      {
        dir: "dist/unstyled",
        chunkFileNames: "[name]-[hash].mjs",
        entryFileNames: "[name].mjs",
        exports: "named",
        format: "es",
        inlineDynamicImports: true,
      },
    ],
  },

  {
    input: "./dist/src/index.d.ts",
    output: {
      file: "./dist/index.d.ts",
      format: "es",
    },
    plugins: [dts()],
  },
];

module.exports = configBase;

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig, rspack } from '@rsbuild/core';

const require = createRequire(import.meta.url);
const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The output is copied verbatim into a versioned static directory and loaded as
// `index.html` inside a sandboxed, opaque-origin iframe. So: one flat directory,
// relative URLs only, content-hashed names, and every script an ES module (a
// CORS fetch, which is what lets the page read the errors its own scripts throw
// from an opaque origin).
export default defineConfig({
  source: {
    entry: { 'sandpack-bundler': './src/index.ts' },
    define: {
      // Optional build-time CDN root (see module-registry/module-cdn.ts).
      'process.env.SANDPACK_CDN_ROOT': JSON.stringify(process.env.SANDPACK_CDN_ROOT ?? ''),
    },
  },
  html: {
    template: './src/index.html',
    inject: 'body',
  },
  output: {
    module: true,
    assetPrefix: 'auto',
    distPath: { js: '', jsAsync: '', wasm: '', assets: '' },
    filename: {
      html: 'index.html',
      wasm: '[name].[contenthash:10][ext]',
    },
    sourceMap: { js: 'source-map' },
    legalComments: 'none',
    copy: [{ from: 'static' }],
  },
  // One entry script; code behind a dynamic import() stays in chunks of its own.
  splitChunks: { preset: 'none', chunks: 'async' },
  resolve: {
    alias: {
      // acorn-jsx require()s acorn while everything else imports it: one build of it.
      acorn$: require.resolve('acorn').replace(/acorn\.js$/, 'acorn.mjs'),
    },
  },
  server: {
    port: 1234,
    // The page is loaded from a sandboxed iframe: its requests carry `Origin: null`,
    // which no origin allowlist can name.
    cors: true,
  },
  tools: {
    rspack: {
      resolve: {
        // The Node modules the bundled packages import, and nothing else: a new
        // one fails the build instead of being polyfilled unseen.
        fallback: {
          path: require.resolve('path-browserify'), // error-listener/unmapper
          fs: false, // lightningcss-wasm: a guarded import() it only reaches under Node
        },
      },
      module: {
        rules: [
          {
            // react-refresh/babel hashes long component signatures.
            test: /[\\/]node_modules[\\/]react-refresh[\\/]/,
            resolve: { alias: { crypto$: local('./shims/crypto.mjs') } },
          },
        ],
      },
      plugins: [
        // The Node globals those packages read without importing them.
        new rspack.ProvidePlugin({
          process: require.resolve('process/browser.js'),
          Buffer: [require.resolve('buffer/'), 'Buffer'],
        }),
      ],
    },
  },
});

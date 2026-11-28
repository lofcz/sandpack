import { resolve } from 'node:path';

import { defineConfig } from '@rstest/core';

export default defineConfig({
  // `npm test` runs `test/*.test.mjs`. The worker harness is not named
  // `*.test.mjs` and runs on its own (`npm run test:worker`).
  include: ['test/*.test.mjs'],
  // The first transform of a file loads Babel and resolves its presets.
  testTimeout: 60_000,
  output: {
    // Nothing a test run writes may land in the published `dist/`.
    distPath: { root: 'node_modules/.rstest' },
    // The suites test the BUILT package (`../dist/*`). Rstest bundles the local
    // files a test imports; the built files are handed to Node as they are, so
    // a test loads exactly what a consumer of the published package loads.
    externals: [
      ({ context, request }, callback) => {
        if (context && request && /^\.\.\/dist\//.test(request)) {
          return callback(undefined, `module-import ${resolve(context, request)}`);
        }
        callback();
      },
    ],
  },
});

import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['src/**/*.test.ts', 'shims/**/*.test.ts'],
  globals: true,
  setupFiles: ['./rstest.setup.ts'],
  // One process per CPU, a fresh VM context per file (what the suite was written
  // against): booting a process for each of the files costs more than the tests.
  pool: 'vmForks',
  // A harness file boots a whole bundler (Babel included) in its before-hooks.
  hookTimeout: 30_000,
  output: {
    // Packages load through Node in the jsdom files too, as in the node ones:
    // every test file sees the same build of a dependency.
    bundleDependencies: false,
  },
});

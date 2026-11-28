import { defineConfig, globalIgnores } from '@rslint/core';

export default defineConfig([
  globalIgnores(['dist/**']),
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Block stray `console.log` debug cruft, but permit intentional
      // `console.warn`/`console.error` — used for always-surface diagnostics and
      // `[security]` events (e.g. SDK-integrity failures) that must reach the
      // console regardless of the configured logLevel.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
]);

import { defineConfig, globalIgnores, js, ts } from '@rslint/core';

export default defineConfig([
  globalIgnores(['dist/**', 'worker/**', 'test/golden/**', 'test/fixtures/**']),
  js.configs.recommended,
  ts.configs.recommended,
  {
    rules: {
      // Babel's plugin API (paths, plugin state, a chain's config) is used
      // untyped throughout, as `noImplicitAny: false` in tsconfig.json says.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]);

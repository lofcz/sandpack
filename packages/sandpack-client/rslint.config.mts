import { defineConfig, js, rstestPlugin, ts } from "@rslint/core";

// Build output (dist, sandpack, the generated console hook) is skipped through
// .gitignore, which Rslint reads.
export default defineConfig([
  js.configs.recommended,
  ts.configs.recommended,
  {
    ...rstestPlugin.configs.recommended,
    files: ["**/*.test.ts"],
    rules: {
      ...rstestPlugin.configs.recommended.rules,
      // Suites are named after the function under test: describe(tokenize, ...).
      "rstest/valid-title": ["error", { ignoreTypeOfDescribeName: true }],
      // refused(url) asserts for the tests that do nothing but call it.
      "rstest/expect-expect": [
        "warn",
        { assertFunctionNames: ["expect", "assert", "refused"] },
      ],
      // Tests swap globals such as fetch and caches through `globalThis as any`.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

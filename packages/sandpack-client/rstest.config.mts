import { defineConfig } from "@rstest/core";

export default defineConfig({
  include: ["src/**/*.test.ts"],
  // Suites that need a DOM opt in with `@rstest-environment jsdom`.
  testEnvironment: "node",
});

module.exports = {
  setupFilesAfterEnv: ["<rootDir>/src/setup.jest.ts"],
  testEnvironment: "jsdom",
  testEnvironmentOptions: {
    customExportConditions: [""],
  },
  transform: {
    "\\.css\\.ts$": "@vanilla-extract/jest-transform",
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  // Allow babel-jest to transform @zenfs/core and its ESM-only dependencies
  transformIgnorePatterns: [
    "/node_modules/(?!(@zenfs|kerium|memium|utilium)/)",
  ],
  moduleNameMapper: {
    // Resolve the workspace package to source so Jest can transform the
    // ESM-only `@zenfs/core` dependency via babel-jest instead of hitting
    // the CJS dist build.
    "^@lofcz/sandpack-client$":
      "<rootDir>/../sandpack-client/src/index.ts",
  },
  globals: {
    "process.env.TEST_ENV": "true",
  },
};

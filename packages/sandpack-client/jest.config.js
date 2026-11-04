module.exports = {
  testEnvironment: "node",
  // Share the workspace resolver for ZenFS's exports-only dependencies.
  resolver: "<rootDir>/../sandpack-bundler/jest.resolver.cjs",
  setupFiles: ["<rootDir>/jest.setup.js"],
  transform: {
    "^.+\\.(?:[tj]sx?|mjs)$": [
      "@swc-node/jest",
      {
        module: "commonjs",
        target: "es2022",
        esModuleInterop: true,
        useDefineForClassFields: true,
      },
    ],
  },
  transformIgnorePatterns: [],
};

import { addPackageJSONIfNeededToMap, normalizePath } from "./utils";

// The filesystem-mutating `addPackageJSONIfNeeded(fs, …)` variant was removed
// (BOOT_SCAFFOLDING_SPEC §3 — the resolved package.json is delivered to the
// bundler out-of-band, not written into the CoW). The pure map variant
// `addPackageJSONIfNeededToMap` is the one still in use (createSandpackFS), so
// coverage moves here — and it needs no zenfs harness.
const baseFiles = {
  "/package.json": {
    code: `{
  "name": "custom-package",
  "main": "old-entry.js",
  "dependencies": { "baz": "*" },
  "devDependencies": { "baz": "*" }
}`,
  },
};

const parsePkg = (files: Record<string, { code: string }>) =>
  JSON.parse(files["/package.json"].code);

describe(addPackageJSONIfNeededToMap, () => {
  test("merges dependencies into an existing package.json", () => {
    const out = addPackageJSONIfNeededToMap(baseFiles, { foo: "*" });
    expect(parsePkg(out).dependencies).toEqual({ baz: "*", foo: "*" });
  });

  test("merges dev-dependencies into an existing package.json", () => {
    const out = addPackageJSONIfNeededToMap(baseFiles, undefined, { foo: "*" });
    expect(parsePkg(out).devDependencies).toEqual({ baz: "*", foo: "*" });
  });

  test("sets the entry (main) on an existing package.json", () => {
    const out = addPackageJSONIfNeededToMap(
      baseFiles,
      undefined,
      undefined,
      "new-entry.js",
    );
    expect(parsePkg(out).main).toEqual("new-entry.js");
  });

  test("creates a package.json when absent, given deps + entry", () => {
    const out = addPackageJSONIfNeededToMap(
      {},
      { react: "*" },
      undefined,
      "/index.js",
    );
    const pkg = parsePkg(out);
    expect(pkg.dependencies).toEqual({ react: "*" });
    expect(pkg.main).toEqual("/index.js");
  });

  test("does not mutate the input map", () => {
    const input = { ...baseFiles };
    addPackageJSONIfNeededToMap(input, { foo: "*" });
    expect(parsePkg(input).dependencies).toEqual({ baz: "*" });
  });

  test("throws when there are no dependencies at all", () => {
    expect(() =>
      addPackageJSONIfNeededToMap({ "/package.json": { code: `{}` } }),
    ).toThrow('[sandpack-client]: "entry" was not specified');
  });
});

describe(normalizePath, () => {
  it("adds trailing slash to a string", () => {
    expect(normalizePath("foo")).toBe("/foo");
    expect(normalizePath("/foo")).toBe("/foo");
  });

  it("adds trailing slash to an array of string", () => {
    expect(normalizePath(["foo", "/baz"])).toStrictEqual(["/foo", "/baz"]);
    expect(normalizePath(["/foo", "/baz"])).toStrictEqual(["/foo", "/baz"]);
  });

  it("adds trailing slash to an object", () => {
    expect(normalizePath({ foo: "", baz: "" })).toStrictEqual({
      "/baz": "",
      "/foo": "",
    });
    expect(normalizePath({ "/foo": "", "/baz": "" })).toStrictEqual({
      "/baz": "",
      "/foo": "",
    });
  });

  it("doesn't tranform invalid values", () => {
    expect(normalizePath(undefined)).toBe(null);
    expect(normalizePath(null)).toBe(null);
    expect(normalizePath(123)).toBe(null);
  });
});

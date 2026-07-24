import type { FileMetaMap } from "@lofcz/sandpack-client";

import { fromPropsToModules } from "./utils";

const fileList = [
  "/src/component/index.js",
  "/src/folder/index.js",
  "/component/index.js",
  "/component/src/index.js",
  "/hidden-folder/index.js",
  "/non-hidden-folder/index.js",
  "/index.js",
  "/App.js",
];

const fileMeta: FileMetaMap = {
  "/src/component/index.js": { hidden: true },
  "/src/folder/index.js": { hidden: true },
  "/component/index.js": { hidden: true },
  "/component/src/index.js": { hidden: true },
  "/hidden-folder/index.js": { hidden: true },
  "/non-hidden-folder/index.js": { hidden: false },
  "/index.js": { hidden: true },
  "/App.js": { hidden: false },
};

const defaultProps = {
  fileList,
  fileMeta,
  autoHiddenFiles: false,
  visibleFiles: [] as string[],
  prefixedPath: "/",
};

describe(fromPropsToModules, () => {
  it("returns a list of unique folder", () => {
    expect(fromPropsToModules(defaultProps).directories.sort()).toEqual([
      "/component/",
      "/hidden-folder/",
      "/non-hidden-folder/",
      "/src/",
    ]);
  });

  it("returns only the root files", () => {
    expect(fromPropsToModules(defaultProps).modules.sort()).toEqual([
      "/App.js",
      "/index.js",
    ]);
  });

  it("returns the folder from a subfolder", () => {
    expect(
      fromPropsToModules({
        ...defaultProps,
        prefixedPath: "/src/",
      }).directories.sort(),
    ).toEqual(["/src/component/", "/src/folder/"]);
  });

  it("returns only the files from the visibleFiles prop (autoHiddenFiles)", () => {
    const input = {
      ...defaultProps,
      autoHiddenFiles: true,
      visibleFiles: ["/index.js", "/src/component/index.js"],
    };

    expect(fromPropsToModules(input)).toEqual({
      directories: ["/src/"],
      modules: ["/index.js"],
    });
  });

  it("returns only the non-hidden files (autoHiddenFiles)", () => {
    const input = {
      ...defaultProps,
      autoHiddenFiles: true,
      visibleFiles: [] as string[],
    };

    expect(fromPropsToModules(input)).toEqual({
      directories: ["/non-hidden-folder/"],
      modules: ["/App.js"],
    });
  });
});

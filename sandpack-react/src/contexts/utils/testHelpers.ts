import { SandpackFS } from "@lofcz/sandpack-client";

import type { FilesState } from "./useFiles";

/**
 * Build a fully-initialized {@link FilesState} for unit tests that exercise
 * client or context hooks without going through React's async init path.
 */
export async function createTestFilesState(
  files: Record<string, string> = { "/index.js": "" },
): Promise<FilesState & { visibleFilesFromProps: string[] }> {
  const fs = await SandpackFS.fromFiles(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { code: v }])),
    {},
    // Tests have no live preview iframe; hand back an unconnected port.
    () => Promise.resolve(new MessageChannel().port1),
  );
  const list = await fs.list();
  return {
    fs,
    fileList: list,
    fileMeta: fs.getAllMetadata(),
    environment: "parcel",
    visibleFiles: list,
    activeFile: list[0] ?? "/index.js",
    visibleFilesFromProps: list,
    shouldUpdatePreview: true,
    isLoading: false,
  };
}

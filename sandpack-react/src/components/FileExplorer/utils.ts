import type { FileMetaMap } from "@lofcz/sandpack-client";

/**
 * Build the `{directories, modules}` split used by the file explorer. Takes
 * the flat list of paths from `SandpackFS.list()` plus the metadata sidecar
 * so we can honor `hidden` without round-tripping to the bundler.
 */
export const fromPropsToModules = ({
  autoHiddenFiles,
  visibleFiles,
  fileList,
  fileMeta,
  prefixedPath,
}: {
  prefixedPath: string;
  fileList: string[];
  fileMeta: FileMetaMap;
  autoHiddenFiles?: boolean;
  visibleFiles: string[];
}): { directories: string[]; modules: string[] } => {
  const hasVisibleFilesOption = visibleFiles.length > 0;

  const filterByHiddenProperty = autoHiddenFiles && !hasVisibleFilesOption;
  const filterByVisibleFilesOption = autoHiddenFiles && !!hasVisibleFilesOption;

  const fileListWithoutPrefix = fileList
    .filter((filePath) => {
      const isValidatedPath = filePath.startsWith(prefixedPath);
      if (filterByVisibleFilesOption) {
        return isValidatedPath && visibleFiles.includes(filePath);
      }

      if (filterByHiddenProperty) {
        return isValidatedPath && !fileMeta[filePath]?.hidden;
      }

      return isValidatedPath;
    })
    .map((file) => file.substring(prefixedPath.length));

  const directories = new Set(
    fileListWithoutPrefix
      .filter((file) => file.includes("/"))
      .map((file) => `${prefixedPath}${file.split("/")[0]}/`),
  );

  const modules = fileListWithoutPrefix
    .filter((file) => !file.includes("/"))
    .map((file) => `${prefixedPath}${file}`);

  return { directories: Array.from(directories), modules };
};

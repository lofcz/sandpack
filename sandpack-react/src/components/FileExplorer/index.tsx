// DEAD-CANDIDATE(2026-06): inherited upstream — not used by immediately.run (site-main
// has its own file-explorer system app; see DEPRECATION_CANDIDATES.md); flag-only, do not remove.
import * as React from "react";

import { useSandpack } from "../../hooks/useSandpack";
import { useClassNames } from "../../utils/classNames";
import { stackClassName } from "../common";

import { fileExplorerClassName } from "./FileExplorer.css";
import { ModuleList } from "./ModuleList";

export interface SandpackFileExplorerProp {
  /**
   * enable auto hidden file in file explorer
   *
   * @description set with hidden property in files property
   * @default false
   */
  autoHiddenFiles?: boolean;

  initialCollapsedFolder?: string[];
}

export const SandpackFileExplorer = ({
  className,
  autoHiddenFiles = false,
  initialCollapsedFolder = [],
  ...props
}: SandpackFileExplorerProp &
  React.HTMLAttributes<HTMLDivElement>): React.JSX.Element | null => {
  const {
    sandpack: {
      status,
      updateFile,
      deleteFile,
      activeFile,
      fileList,
      fileMeta,
      openFile,
      visibleFilesFromProps,
    },
    listen,
  } = useSandpack();
  const classNames = useClassNames();

  React.useEffect(
    function watchFSFilesChanges() {
      if (status !== "running") return;

      const unsubscribe = listen((message) => {
        if (message.type === "fs/change") {
          void updateFile(message.path, message.content, false);
        }

        if (message.type === "fs/remove") {
          void deleteFile(message.path, false);
        }
      });

      return unsubscribe;
    },
    [status], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const orderedFileList = React.useMemo(() => [...fileList].sort(), [fileList]);

  return (
    <div
      className={classNames("file-explorer", [stackClassName, className])}
      {...props}
    >
      <div
        className={classNames("file-explorer-list", [fileExplorerClassName])}
      >
        <ModuleList
          activeFile={activeFile}
          autoHiddenFiles={autoHiddenFiles}
          fileList={orderedFileList}
          fileMeta={fileMeta}
          initialCollapsedFolder={initialCollapsedFolder}
          prefixedPath="/"
          selectFile={openFile}
          visibleFiles={visibleFilesFromProps}
        />
      </div>
    </div>
  );
};

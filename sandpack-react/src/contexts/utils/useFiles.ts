import type { FileMetaMap, SandpackFS } from "@lofcz/sandpack-client";
import { normalizePath } from "@lofcz/sandpack-client/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SandboxEnvironment, SandpackProviderProps } from "../..";

export interface FilesState {
  fs: SandpackFS;
  fileList: string[];
  fileMeta: FileMetaMap;
  environment?: SandboxEnvironment;
  visibleFiles: string[];
  activeFile: string;
  shouldUpdatePreview: boolean;
  /** True while the async path enumeration is in flight. */
  isLoading: boolean;
}

interface FilesOperations {
  openFile: (path: string) => void;
  resetFile: (path: string) => Promise<void>;
  resetAllFiles: () => Promise<void>;
  setActiveFile: (path: string) => void;
  updateCurrentFile: (
    code: string,
    shouldUpdatePreview?: boolean,
  ) => Promise<void>;
  updateFile: (
    path: string,
    code: string,
    shouldUpdatePreview?: boolean,
  ) => Promise<void>;
  addFile: (
    path: string,
    code: string,
    shouldUpdatePreview?: boolean,
  ) => Promise<void>;
  closeFile: (path: string) => void;
  deleteFile: (path: string, shouldUpdatePreview?: boolean) => Promise<void>;
}

export type UseFiles = (props: SandpackProviderProps) => [
  FilesState & {
    visibleFilesFromProps: string[];
  },
  FilesOperations,
];

interface UIState {
  visibleFiles: string[];
  activeFile: string;
  visibleFilesFromProps: string[];
  environment?: SandboxEnvironment;
  shouldUpdatePreview: boolean;
}

interface FSState {
  fileList: string[];
  fileMeta: FileMetaMap;
  isLoading: boolean;
}

const EMPTY_LIST: string[] = [];
const EMPTY_META: FileMetaMap = {};

/**
 * Manages the {@link SandpackFS} lifecycle for a provider.
 *
 * The supplied `props.fs` is used directly as the source of truth. On mount,
 * the hook enumerates paths and derives `visibleFiles` / `activeFile` from the
 * sidecar metadata. `isLoading` stays true until that first enumeration
 * completes.
 */
export const useFiles: UseFiles = (props) => {
  const fs = props.fs;

  const [uiState, setUiState] = useState<UIState>({
    visibleFiles: [],
    activeFile: "",
    visibleFilesFromProps: [],
    environment: undefined,
    shouldUpdatePreview: true,
  });

  const [fsState, setFsState] = useState<FSState>({
    fileList: EMPTY_LIST,
    fileMeta: EMPTY_META,
    isLoading: true,
  });

  /**
   * Snapshot of the original file contents at mount so we can implement
   * `resetFile` / `resetAllFiles`.
   */
  const originalSnapshotRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Use the SandpackFS listing (leading-slash paths, internal
        // `/.sandpack` metadata excluded) rather than a raw recursive
        // readdir, which would surface relative paths and the metadata
        // directory — and pick `/.sandpack` as the active file.
        const paths = await fs.list();
        const snap: Record<string, string> = {};
        await Promise.all(
          paths.map(async (p) => {
            snap[p] = await fs.readFile(p);
          }),
        );
        if (cancelled) return;

        originalSnapshotRef.current = snap;

        const meta = fs.getAllMetadata();
        const visible: string[] = [];
        let active: string | undefined = props.options?.activeFile
          ? normalizePath(props.options.activeFile)
          : undefined;

        const optionsVisibleFiles =
          props.options?.visibleFiles?.map(normalizePath);

        if (optionsVisibleFiles && optionsVisibleFiles.length > 0) {
          visible.push(...optionsVisibleFiles.filter((p) => paths.includes(p)));
          if (!active) {
            paths.forEach((p) => {
              const m = meta[p] ?? {};
              if (!active && m.active) active = p;
            });
          }
        } else {
          paths.forEach((p) => {
            const m = meta[p] ?? {};
            if (!active && m.active) active = p;
            if (!m.hidden) visible.push(p);
          });
        }

        if (visible.length === 0 && paths.length > 0) visible.push(paths[0]);
        if (!active) active = visible[0] ?? paths[0] ?? "/";
        if (active && !visible.includes(active)) visible.push(active);

        const environment = fs.getEnvironment() as
          | SandboxEnvironment
          | undefined;

        setUiState({
          visibleFiles: visible,
          visibleFilesFromProps: visible,
          activeFile: active,
          environment,
          shouldUpdatePreview: true,
        });

        setFsState({
          fileList: paths,
          fileMeta: meta,
          isLoading: false,
        });
      } catch {
        // FS disposed while in-flight (e.g., component unmounted mid-async) — ignore
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
    // Intentionally mount-only: changing the fs prop after mount is
    // unsupported. Consumers who need to swap setups should unmount the
    // provider instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (fsState.isLoading) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const paths = await fs.list();
        if (cancelled) return;
        setFsState((prev) => {
          return { ...prev, fileList: paths, fileMeta: fs.getAllMetadata() };
        });
      } catch {
        // FS disposed while in-flight — ignore
      }
    };

    // Refresh the file list on any mutation (local edits or iframe writes),
    // so create/delete/rename are reflected in the tree.
    const unsub = fs.onChange(() => void refresh());

    return () => {
      cancelled = true;
      unsub();
    };
  }, [fs, fsState.isLoading]);

  // ------------------------------------------------------------------
  // Operations
  // ------------------------------------------------------------------

  const updateFile = useCallback(
    async (
      path: string,
      code: string,
      shouldUpdatePreview = true,
    ): Promise<void> => {
      await fs.writeFile(path, code);
      setUiState((prev) => ({ ...prev, shouldUpdatePreview }));
    },
    [fs],
  );

  const operations: FilesOperations = useMemo(
    () => ({
      openFile: (path: string) => {
        setUiState((prev) => {
          const newPaths = prev.visibleFiles.includes(path)
            ? prev.visibleFiles
            : [...prev.visibleFiles, path];
          return { ...prev, activeFile: path, visibleFiles: newPaths };
        });
      },
      resetFile: async (path: string) => {
        const original = originalSnapshotRef.current[path];
        if (original !== undefined) {
          await fs.writeFile(path, original);
        }
      },
      resetAllFiles: async () => {
        await Promise.all(
          Object.entries(originalSnapshotRef.current).map(([path, body]) =>
            fs.writeFile(path, body),
          ),
        );
      },
      setActiveFile: (activeFile: string) => {
        setUiState((prev) => ({ ...prev, activeFile }));
      },
      updateCurrentFile: async (code: string, shouldUpdatePreview = true) => {
        await updateFile(uiState.activeFile, code, shouldUpdatePreview);
      },
      updateFile,
      addFile: updateFile,
      closeFile: (path: string) => {
        setUiState((prev) => {
          if (prev.visibleFiles.length === 1) return prev;
          const indexOfRemoved = prev.visibleFiles.indexOf(path);
          const newPaths = prev.visibleFiles.filter((p) => p !== path);
          return {
            ...prev,
            activeFile:
              path === prev.activeFile
                ? indexOfRemoved === 0
                  ? prev.visibleFiles[1]
                  : prev.visibleFiles[indexOfRemoved - 1]
                : prev.activeFile,
            visibleFiles: newPaths,
          };
        });
      },
      deleteFile: async (path: string, shouldUpdatePreview = true) => {
        await fs.unlink(path);

        setUiState((prev) => {
          const remainingVisible = prev.visibleFiles.filter((p) => p !== path);
          if (remainingVisible.length === 0) {
            const nextFile =
              fsState.fileList.filter((p) => p !== path).pop() ?? "/";
            return {
              ...prev,
              visibleFiles: [nextFile],
              activeFile: nextFile,
              shouldUpdatePreview,
            };
          }
          return {
            ...prev,
            visibleFiles: remainingVisible,
            activeFile:
              path === prev.activeFile
                ? remainingVisible[remainingVisible.length - 1]
                : prev.activeFile,
            shouldUpdatePreview,
          };
        });
      },
    }),
    [fs, fsState.fileList, updateFile, uiState.activeFile],
  );

  const state: FilesState & { visibleFilesFromProps: string[] } = {
    fs,
    fileList: fsState.fileList,
    fileMeta: fsState.fileMeta,
    environment: uiState.environment,
    visibleFiles: uiState.visibleFiles,
    activeFile: uiState.activeFile,
    visibleFilesFromProps: uiState.visibleFilesFromProps,
    shouldUpdatePreview: uiState.shouldUpdatePreview,
    isLoading: fsState.isLoading,
  };

  return [state, operations];
};

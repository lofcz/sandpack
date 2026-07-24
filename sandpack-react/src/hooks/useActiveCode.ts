import { useEffect, useState } from "react";

import { useSandpack } from "./useSandpack";

/**
 * Returns the current contents of the active file together with helpers to
 * edit it. Content is fetched asynchronously from the backing
 * {@link import("@lofcz/sandpack-client").SandpackFS} so
 * `code` is `undefined` until the first read resolves (reflected via
 * `isLoading`).
 *
 * The editor owns the active file's buffer: `code` is loaded once per file and
 * re-read only when the file is changed *externally* (i.e. by code running in
 * the child iframe). The editor's own edits are never read back — that's what
 * keeps typing free of echo/clobber.
 *
 * @category Hooks
 */
export const useActiveCode = (): {
  code: string;
  readOnly: boolean;
  isLoading: boolean;
  updateCode: (newCode: string, shouldUpdatePreview?: boolean) => Promise<void>;
} => {
  const { sandpack } = useSandpack();
  const { fs, activeFile, fileMeta, updateCurrentFile, isLoading } = sandpack;

  const [code, setCode] = useState<string>("");
  const [loadingContent, setLoadingContent] = useState(true);

  useEffect(() => {
    if (isLoading || !activeFile) return;
    let cancelled = false;
    // Guards against out-of-order reads clobbering newer content: only the most
    // recently started read may commit its result.
    let generation = 0;

    const read = async (): Promise<void> => {
      const current = ++generation;
      try {
        const body = await fs.readFile(activeFile);
        if (!cancelled && current === generation) setCode(body);
      } catch {
        if (!cancelled && current === generation) setCode("");
      } finally {
        if (!cancelled && current === generation) setLoadingContent(false);
      }
    };

    void read();

    // Re-read the active file only on *external* changes (the child iframe
    // wrote it). Local edits — including the editor's own writes — are ignored
    // here, so they never feed back into the editor.
    const unsub = fs.onChange(({ path, external }) => {
      if (external && path === activeFile) void read();
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [fs, activeFile, isLoading]);

  const readOnly = Boolean(fileMeta[activeFile]?.readOnly);

  return {
    code,
    readOnly,
    isLoading: isLoading || loadingContent,
    updateCode: updateCurrentFile,
  };
};

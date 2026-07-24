import type { SandpackFS } from "@lofcz/sandpack-client";

import type { SandpackProviderProps } from "../..";

interface SandpackAppState {
  editorState: "pristine" | "dirty";
}

type UseAppState = (
  props: SandpackProviderProps,
  fs: SandpackFS | null,
  fileList: string[],
) => SandpackAppState;

/**
 * Reports the editor's pristine/dirty state.
 *
 * This used to capture a snapshot of every file's contents on first render and
 * re-read the ENTIRE filesystem on every mutation (walking the maintained file
 * list and `readFile`-ing each entry) to diff against that snapshot. The only
 * consumer of the result is a cosmetic CodeMirror CSS class, so that per-edit
 * whole-tree read was pure overhead. The host tracks real dirty/conflict state
 * itself, so we hardcode `pristine` and do no reads. The signature is preserved
 * so callers don't change.
 */
export const useAppState: UseAppState = (
  _props,
  _fs,
  _fileList,
): SandpackAppState => {
  return { editorState: "pristine" };
};

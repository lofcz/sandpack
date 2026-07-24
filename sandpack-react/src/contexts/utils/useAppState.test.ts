/**
 * @jest-environment jsdom
 */
import { SandpackFS } from "@lofcz/sandpack-client";
import { act, renderHook, waitFor } from "@testing-library/react";

import { VANILLA_TEMPLATE } from "../../templates";

import { useAppState } from "./useAppState";

describe(useAppState, () => {
  let fs: SandpackFS;

  beforeEach(async () => {
    fs = await SandpackFS.fromFiles(VANILLA_TEMPLATE.files);
  });

  afterEach(() => {
    fs.dispose();
  });

  it("reports pristine with a fresh filesystem", async () => {
    const { result } = renderHook(() =>
      useAppState({}, fs, Object.keys(VANILLA_TEMPLATE.files)),
    );

    await waitFor(() => expect(result.current.editorState).toBe("pristine"));
  });

  it("stays pristine on mutation and never reads the filesystem", async () => {
    // Regression guard: this hook must not snapshot or re-read the tree. The
    // editor's real dirty state is tracked by the host, not here.
    const readSpy = jest.spyOn(fs, "readFile");
    const listSpy = jest.spyOn(fs, "list");

    const { result } = renderHook(() =>
      useAppState({}, fs, Object.keys(VANILLA_TEMPLATE.files)),
    );

    await waitFor(() => expect(result.current.editorState).toBe("pristine"));

    await act(async () => {
      await fs.writeFile("/index.js", "UPDATED");
    });

    await waitFor(() => expect(result.current.editorState).toBe("pristine"));

    // The hook itself must perform no enumeration or content reads.
    expect(readSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
  });
});

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

  it("starts pristine with a fresh filesystem", async () => {
    const { result } = renderHook(() =>
      useAppState({}, fs, Object.keys(VANILLA_TEMPLATE.files)),
    );

    await waitFor(() => expect(result.current.editorState).toBe("pristine"));
  });

  it("flips to dirty when the filesystem is mutated", async () => {
    const { result } = renderHook(() =>
      useAppState({}, fs, Object.keys(VANILLA_TEMPLATE.files)),
    );

    await waitFor(() => expect(result.current.editorState).toBe("pristine"));

    await act(async () => {
      await fs.writeFile("/index.js", "UPDATED");
    });

    await waitFor(() => expect(result.current.editorState).toBe("dirty"));
  });

  it("returns to pristine after reverting a change", async () => {
    const { result } = renderHook(() =>
      useAppState({}, fs, Object.keys(VANILLA_TEMPLATE.files)),
    );

    await waitFor(() => expect(result.current.editorState).toBe("pristine"));

    const original = VANILLA_TEMPLATE["files"]["/index.js"].code;

    await act(async () => {
      await fs.writeFile("/index.js", "UPDATED");
    });
    await waitFor(() => expect(result.current.editorState).toBe("dirty"));

    await act(async () => {
      await fs.writeFile("/index.js", original);
    });
    await waitFor(() => expect(result.current.editorState).toBe("pristine"));
  });
});

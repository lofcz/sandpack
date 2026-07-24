/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import type { SandpackFS } from "@lofcz/sandpack-client";
import React from "react";

import type { UseSandpack } from "..";
import { useSandpack } from "..";

import { createSandpackFS } from "../utils/createSandpackFS";
import { SandpackProvider } from "./sandpackContext";

jest.useFakeTimers();

/**
 * Boots a {@link SandpackProvider} with a fresh react-template filesystem,
 * waits for the async fs init, and starts the sandbox.
 * Returns the hook result ref so assertions see live state.
 */
const createContext = async (
  providerOptions: Omit<
    React.ComponentProps<typeof SandpackProvider>,
    "children" | "fs"
  > = {},
): Promise<{ current: UseSandpack }> => {
  const fs = await createSandpackFS({ template: "react" });

  const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <SandpackProvider fs={fs} {...providerOptions}>
      {children}
    </SandpackProvider>
  );
  const { result } = renderHook(() => useSandpack(), { wrapper });

  await waitFor(() => {
    expect(result.current.sandpack.fs).toBeDefined();
    expect(result.current.sandpack.fileList.length).toBeGreaterThan(0);
  });

  await act(async () => {
    result.current.sandpack.runSandpack();
  });

  return result;
};

const getAmountOfListener = (
  /* eslint-disable @typescript-eslint/no-explicit-any */
  instance: any,
  name = "client-id",
  ignoreGlobalListener = false,
): number => {
  return (
    Object.keys(instance.sandpack.clients[name].iframeProtocol.channelListeners)
      .length -
    1 -
    (ignoreGlobalListener ? 0 : 1)
  );
};

describe(SandpackProvider, () => {
  describe("updateFile", () => {
    it("adds a file", async () => {
      const instance = await createContext();

      await act(async () => {
        await instance.current.sandpack.addFile("/new-file.js", "new-content");
      });

      await waitFor(() =>
        expect(instance.current.sandpack.fileList).toContain("/new-file.js"),
      );
      expect(await instance.current.sandpack.fs.readFile("/new-file.js")).toBe(
        "new-content",
      );
    });

    it("deletes a file", async () => {
      const instance = await createContext();

      await act(async () => {
        await instance.current.sandpack.deleteFile("/App.js");
      });

      await waitFor(() =>
        expect(instance.current.sandpack.fileList).not.toContain("/App.js"),
      );
    });

    it("deletes the activeFile and set the following visibleFile as active", async () => {
      const instance = await createContext({
        options: { activeFile: "/App.js", visibleFiles: ["/styles.css"] },
      });

      await act(async () => {
        await instance.current.sandpack.deleteFile("/App.js");
      });

      expect(instance.current.sandpack.activeFile).toBe("/styles.css");
    });

    it("updates a file", async () => {
      const instance = await createContext();

      expect(await instance.current.sandpack.fs.readFile("/App.js")).toContain(
        "Hello world",
      );

      await act(async () => {
        await instance.current.sandpack.updateFile("/App.js", "Foo");
      });

      expect(await instance.current.sandpack.fs.readFile("/App.js")).toBe(
        "Foo",
      );
    });

    it("updates multiples files in a row", async () => {
      const instance = await createContext();

      await act(async () => {
        await instance.current.sandpack.updateFile("/App.js", "Foo");
      });
      await act(async () => {
        await instance.current.sandpack.updateFile("/index.js", "Baz");
      });

      expect(await instance.current.sandpack.fs.readFile("/App.js")).toBe(
        "Foo",
      );
      expect(await instance.current.sandpack.fs.readFile("/index.js")).toBe(
        "Baz",
      );
    });
  });

  describe("editorState", () => {
    // `editorState` is now a constant `pristine`. The old dirty-tracking
    // re-read the entire filesystem on every mutation to feed a cosmetic CSS
    // class; immediately.run tracks real dirty state itself, so the read was
    // removed (R3 sandpack unnecessary-reads).
    it("is pristine initially", async () => {
      const instance = await createContext();

      expect(instance.current.sandpack.editorState).toBe("pristine");
    });

    it("stays pristine after updating a file (no whole-tree dirty read)", async () => {
      const instance = await createContext();

      await act(async () => {
        await instance.current.sandpack.updateFile("/App.js", "Foo");
      });

      // Give any stray async work a chance to (incorrectly) flip the flag.
      await waitFor(() =>
        expect(instance.current.sandpack.editorState).toBe("pristine"),
      );
    });
  });

  describe("listeners", () => {
    it("sets a listener, but the client hasn't been created yet - no global listener", async () => {
      const instance = await createContext();

      const mock = jest.fn();
      act(() => {
        instance.current.listen(mock, "client-id");
      });

      await act(async () => {
        await instance.current.sandpack.registerBundler(
          document.createElement("iframe"),
          "client-id",
        );
      });

      expect(
        Object.keys(
          instance.current.sandpack.unsubscribeClientListenersRef.current[
            "client-id"
          ],
        ).length,
      ).toBe(1);

      expect(
        Object.keys(instance.current.sandpack.queuedListenersRef.current.global)
          .length,
      ).toBe(0);

      expect(Object.keys(instance.current.sandpack.clients)).toEqual([
        "client-id",
      ]);
    });

    it("sets a listener, but the client hasn't been created yet - global listener", async () => {
      const instance = await createContext();

      const mock = jest.fn();
      act(() => {
        instance.current.listen(mock);
      });

      await act(async () => {
        await instance.current.sandpack.registerBundler(
          document.createElement("iframe"),
          "client-id",
        );
      });

      expect(
        Object.keys(
          instance.current.sandpack.unsubscribeClientListenersRef.current[
            "client-id"
          ],
        ).length,
      ).toBe(1);

      expect(
        Object.keys(instance.current.sandpack.queuedListenersRef.current.global)
          .length,
      ).toBe(1);

      expect(getAmountOfListener(instance.current)).toBe(1);
    });

    it("set a listener, but the client has already been created - no global listener", async () => {
      const instance = await createContext();

      await act(async () => {
        await instance.current.sandpack.registerBundler(
          document.createElement("iframe"),
          "client-id",
        );
      });

      expect(
        Object.keys(
          instance.current.sandpack.unsubscribeClientListenersRef.current[
            "client-id"
          ],
        ).length,
      ).toBe(0);

      expect(
        Object.keys(instance.current.sandpack.queuedListenersRef.current.global)
          .length,
      ).toBe(0);

      const mock = jest.fn();
      act(() => {
        instance.current.listen(mock, "client-id");
      });

      expect(
        Object.keys(
          instance.current.sandpack.unsubscribeClientListenersRef.current[
            "client-id"
          ],
        ).length,
      ).toBe(0);

      expect(
        Object.keys(instance.current.sandpack.queuedListenersRef.current.global)
          .length,
      ).toBe(0);

      expect(getAmountOfListener(instance.current)).toBe(1);
    });

    it("set a listener, but the client has already been created - global listener", async () => {
      const instance = await createContext();

      await act(async () => {
        await instance.current.sandpack.registerBundler(
          document.createElement("iframe"),
          "client-id",
        );
      });

      expect(
        Object.keys(
          instance.current.sandpack.unsubscribeClientListenersRef.current[
            "client-id"
          ],
        ).length,
      ).toBe(0);

      expect(
        Object.keys(instance.current.sandpack.queuedListenersRef.current.global)
          .length,
      ).toBe(0);

      const mock = jest.fn();
      act(() => {
        instance.current.listen(mock);
      });

      expect(
        Object.keys(
          instance.current.sandpack.unsubscribeClientListenersRef.current[
            "client-id"
          ],
        ).length,
      ).toBe(0);

      expect(
        Object.keys(instance.current.sandpack.queuedListenersRef.current.global)
          .length,
      ).toBe(1);

      expect(getAmountOfListener(instance.current)).toBe(1);
    });

    it("sets a new listener, and then create one more client", async () => {
      const instance = await createContext();

      act(() => {
        const mock = jest.fn();
        instance.current.listen(mock, "client-id");
      });

      await act(async () => {
        await instance.current.sandpack.registerBundler(
          document.createElement("iframe"),
          "client-id",
        );
      });

      expect(
        Object.keys(
          instance.current.sandpack.unsubscribeClientListenersRef.current[
            "client-id"
          ],
        ).length,
      ).toBe(1);

      expect(
        Object.keys(instance.current.sandpack.queuedListenersRef.current.global)
          .length,
      ).toBe(0);

      expect(getAmountOfListener(instance.current)).toBe(1);

      act(() => {
        const anotherMock = jest.fn();
        instance.current.listen(anotherMock);
      });

      expect(
        Object.keys(instance.current.sandpack.queuedListenersRef.current.global)
          .length,
      ).toBe(1);

      expect(getAmountOfListener(instance.current)).toBe(2);
    });

    it("unsubscribes only from the assigned client id", async () => {
      const instance = await createContext();

      await act(async () => {
        await instance.current.sandpack.registerBundler(
          document.createElement("iframe"),
          "client-1",
        );
        await instance.current.sandpack.registerBundler(
          document.createElement("iframe"),
          "client-2",
        );
      });

      expect(getAmountOfListener(instance.current, "client-1")).toBe(0);
      expect(getAmountOfListener(instance.current, "client-2", true)).toBe(0);

      act(() => {
        instance.current.listen(jest.fn(), "client-1");
      });
      const unsubscribeClientTwo = instance.current.listen(
        jest.fn(),
        "client-2",
      );

      expect(getAmountOfListener(instance.current, "client-1")).toBe(1);
      expect(getAmountOfListener(instance.current, "client-2", true)).toBe(1);

      unsubscribeClientTwo();

      expect(getAmountOfListener(instance.current, "client-1")).toBe(1);
      expect(getAmountOfListener(instance.current, "client-2", true)).toBe(0);
    });

    it("doesn't trigger global unsubscribe", async () => {
      const instance = await createContext();

      await act(async () => {
        await instance.current.sandpack.registerBundler(
          document.createElement("iframe"),
          "client-1",
        );
        await instance.current.sandpack.registerBundler(
          document.createElement("iframe"),
          "client-2",
        );
      });

      act(() => {
        instance.current.listen(jest.fn());
        instance.current.listen(jest.fn());
      });
      const unsubscribe = instance.current.listen(jest.fn());

      expect(getAmountOfListener(instance.current, "client-1")).toBe(3);
      expect(getAmountOfListener(instance.current, "client-2", true)).toBe(3);

      unsubscribe();

      expect(getAmountOfListener(instance.current, "client-1")).toBe(2);
      expect(getAmountOfListener(instance.current, "client-2", true)).toBe(2);
    });

    it("unsubscribe all the listeners from a specific client when it unmonts", async () => {
      const instance = await createContext();
      await act(async () => {
        await instance.current.sandpack.registerBundler(
          document.createElement("iframe"),
          "client-1",
        );
        await instance.current.sandpack.registerBundler(
          document.createElement("iframe"),
          "client-2",
        );

        instance.current.listen(jest.fn());
        instance.current.listen(jest.fn());
        instance.current.listen(jest.fn());
      });

      expect(getAmountOfListener(instance.current, "client-1")).toBe(3);
      expect(getAmountOfListener(instance.current, "client-2", true)).toBe(3);

      act(() => {
        instance.current.sandpack.unregisterBundler("client-2");
      });

      expect(getAmountOfListener(instance.current, "client-1")).toBe(3);
      expect(instance.current.sandpack.clients["client-2"]).toBe(undefined);
    });
  });
});

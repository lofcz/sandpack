/**
 * @jest-environment jsdom
 */
import { render, act, waitFor } from "@testing-library/react";
import React from "react";

import type { SandpackState } from "..";
import { useSandpack } from "..";

import { createSandpackFS } from "../utils/createSandpackFS";
import { SandpackProvider } from "../contexts/sandpackContext";

import { useSandpackSelector } from "./useSandpackSelector";

jest.useFakeTimers();

// The R3-108 exit criterion (plan `sandpack-seam-hardening.md` Phase 1): a
// `useSandpackSelector` consumer re-renders ONLY when its selected slice changes,
// while a plain `useSandpack()` consumer re-renders on every context rebuild. This
// is what lets the host drop the `React.memo(AppPanel)` band-aid.
describe("useSandpackSelector — fine-grained subscriptions (R3-108)", () => {
  it("re-renders a consumer only when its selected slice changes", async () => {
    const fs = await createSandpackFS({ template: "react" });

    const renders = { active: 0, status: 0, full: 0 };
    let ops: SandpackState | undefined;

    const ActiveConsumer: React.FC = () => {
      useSandpackSelector((s) => s.activeFile);
      renders.active += 1;
      return null;
    };
    const StatusConsumer: React.FC = () => {
      useSandpackSelector((s) => s.status);
      renders.status += 1;
      return null;
    };
    const FullConsumer: React.FC = () => {
      useSandpack();
      renders.full += 1;
      return null;
    };
    const Ops: React.FC = () => {
      ops = useSandpack().sandpack;
      return null;
    };

    render(
      <SandpackProvider fs={fs}>
        <ActiveConsumer />
        <StatusConsumer />
        <FullConsumer />
        <Ops />
      </SandpackProvider>,
    );

    await waitFor(() => {
      expect(ops?.fileList.length).toBeGreaterThan(0);
    });
    // Let the async fs init + initial notifies settle before measuring deltas.
    await act(async () => {
      await Promise.resolve();
    });

    const base = { ...renders };

    // A CONTENT edit rebuilds the context (the `useSandpack` consumer re-renders)
    // but leaves `activeFile`/`status` unchanged — so neither selector re-renders.
    await act(async () => {
      await ops!.updateCurrentFile("// edited\n", false);
    });

    expect(renders.active).toBe(base.active); // insulated: activeFile unchanged
    expect(renders.status).toBe(base.status); // insulated: status unchanged
    expect(renders.full).toBeGreaterThan(base.full); // context consumer re-rendered

    const afterEdit = { ...renders };

    // Changing `activeFile` re-renders ONLY the activeFile selector consumer.
    const other = ops!.fileList.find((path) => path !== ops!.activeFile)!;
    await act(async () => {
      ops!.setActiveFile(other);
    });

    expect(renders.active).toBeGreaterThan(afterEdit.active); // its slice changed
    expect(renders.status).toBe(afterEdit.status); // status slice unchanged
  });

  it("throws when used outside a SandpackProvider", () => {
    const Bad: React.FC = () => {
      useSandpackSelector((s) => s.activeFile);
      return null;
    };
    // Silence the expected React error boundary console noise.
    const spy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(() => render(<Bad />)).toThrow(
      /must be wrapped by a "SandpackProvider"/,
    );
    spy.mockRestore();
  });
});

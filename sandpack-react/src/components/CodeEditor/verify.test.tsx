/**
 * @jest-environment jsdom
 */
import { render, waitFor, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SandpackFS } from "@lofcz/sandpack-client";
import React from "react";

import { SandpackProvider } from "../../";
import { SandpackFileExplorer } from "../FileExplorer";
import { useActiveCode } from "../../hooks/useActiveCode";
import { useSandpack } from "../../hooks/useSandpack";
import { createSandpackFS } from "../../utils/createSandpackFS";

if (typeof (global as any).structuredClone === "undefined") {
  (global as any).structuredClone = (v: unknown) =>
    v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

const Probe: React.FC = () => {
  const { code } = useActiveCode();
  const { sandpack } = useSandpack();
  return (
    <div data-testid="probe" data-active={sandpack.activeFile}>
      {code}
    </div>
  );
};
const snap = () => {
  const el = document.querySelector('[data-testid="probe"]') as HTMLElement;
  return {
    active: el?.getAttribute("data-active") ?? "",
    code: el?.textContent ?? "",
  };
};

describe("SandpackCodeEditor loads file content from ZenFS", () => {
  let fs: SandpackFS;
  let appJs: string;
  let stylesCss: string;
  beforeAll(async () => {
    fs = await createSandpackFS({ template: "react" });
    appJs = await fs.readFile("/App.js");
    stylesCss = await fs.readFile("/styles.css");
  });

  it("shows the active file on load and the clicked file on selection", async () => {
    render(
      <SandpackProvider fs={fs}>
        <SandpackFileExplorer />
        <Probe />
      </SandpackProvider>,
    );

    // Initial active file must be a real file (not the internal /.sandpack
    // metadata directory) and its ZenFS content must be displayed.
    await waitFor(() => {
      expect(snap().active).toBe("/App.js");
      expect(snap().code).toEqual(appJs);
    });

    // Clicking a different file in the explorer loads ITS content.
    const btn = (
      Array.from(
        document.querySelectorAll("button[title]"),
      ) as HTMLButtonElement[]
    ).find((b) => /styles\.css$/.test(b.title));
    if (!btn) throw new Error("styles.css button not found");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(snap().active).toBe("/styles.css");
      expect(snap().code).toEqual(stylesCss);
    });

    // An external write to the active file refreshes the editor via the ZenFS
    // watch, and the deferred re-read observes the *completed* write (no torn
    // mid-write content), regardless of whether the new content is shorter or
    // longer than the previous content.
    const shorter = "x";
    await act(async () => {
      await fs.writeFile("/styles.css", shorter);
    });
    await waitFor(() => {
      expect(snap().code).toEqual(shorter);
    });

    const longer = stylesCss + "\n/* appended */\n";
    await act(async () => {
      await fs.writeFile("/styles.css", longer);
    });
    await waitFor(() => {
      expect(snap().code).toEqual(longer);
    });
  });
});

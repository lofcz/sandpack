/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SandpackFS } from "@lofcz/sandpack-client";
import React from "react";

import { SandpackProvider } from "../../contexts/sandpackContext";
import { createSandpackFS } from "../../utils/createSandpackFS";
import { SandpackCodeEditor } from "../CodeEditor";

describe("FileTabs", () => {
  describe("doesn't have duplicate filename", () => {
    let fs: SandpackFS;

    beforeAll(async () => {
      fs = await createSandpackFS({
        template: "react",
        files: {
          "/foo/App.js": "",
          "/App.js": "",
          "/baz/App.js": "",
        },
      });
    });

    afterAll(() => {
      fs.dispose();
    });

    it("renders unique tab names", async () => {
      render(
        <SandpackProvider
          fs={fs}
          options={{ visibleFiles: ["/foo/App.js", "/App.js", "/baz/App.js"] }}
        >
          <SandpackCodeEditor />
        </SandpackProvider>,
      );

      await waitFor(() => {
        expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
      });

      const buttons = screen.getAllByRole("tab");
      const buttonsTex = buttons.map((item) => item.textContent);

      expect(buttonsTex).toEqual(["foo/App.js", "App.js", "baz/App.js"]);
    });
  });

  describe("render the visible files", () => {
    let fs: SandpackFS;

    beforeAll(async () => {
      fs = await createSandpackFS({
        template: "react",
        files: {
          "/foo/App.js": "",
          "/App.js": "",
          "/baz/App.js": "",
        },
      });
    });

    afterAll(() => {
      fs.dispose();
    });

    it("shows only the specified visible files", async () => {
      render(
        <SandpackProvider
          fs={fs}
          options={{
            visibleFiles: ["/baz/App.js", "/App.js"],
          }}
        >
          <SandpackCodeEditor />
        </SandpackProvider>,
      );

      await waitFor(() => {
        expect(screen.getAllByRole("tab").length).toBeGreaterThan(0);
      });

      const buttons = screen.getAllByRole("tab");
      const buttonsTex = buttons.map((item) => item.textContent);

      expect(buttonsTex).toEqual(["baz/App.js", "App.js"]);
    });
  });
});

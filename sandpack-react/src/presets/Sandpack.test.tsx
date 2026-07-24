/**
 * @jest-environment jsdom
 */

/* eslint-disable @typescript-eslint/no-var-requires */
import type { SandpackFS } from "@lofcz/sandpack-client";
import React from "react";
import { renderToString } from "react-dom/server";

import { Sandpack } from "../";
import { createSandpackFS } from "../utils/createSandpackFS";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
global.document = { self: window };

describe("Sandpack", () => {
  let fs: SandpackFS;

  beforeAll(async () => {
    fs = await createSandpackFS({ template: "vanilla" });
  });

  afterAll(() => {
    fs.dispose();
  });

  it("renders on a server without crashing", () => {
    const renderOnServer = (): string =>
      renderToString(<Sandpack fs={fs} options={{ id: "test" }} />);
    expect(renderOnServer).not.toThrow();
  });
});

/**
 * @jest-environment jsdom
 */
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SandpackFS } from "@lofcz/sandpack-client";
import React from "react";

import { SandpackProvider } from "../../";
import { createSandpackFS } from "../../utils/createSandpackFS";

import { SandpackCodeEditor } from ".";

describe("read-only", () => {
  jest.useFakeTimers();

  let fs: SandpackFS;

  beforeAll(async () => {
    fs = await createSandpackFS({ template: "vanilla" });
  });

  afterAll(() => {
    fs.dispose();
  });

  it("should render the read-only flag", () => {
    render(
      <SandpackProvider fs={fs}>
        <SandpackCodeEditor readOnly />
      </SandpackProvider>,
    );

    act(() => {
      jest.runAllTimers();
    });

    const readOnlyFlag = screen.getByTestId("read-only");
    expect(readOnlyFlag).toHaveTextContent("Read-only");
  });

  it("should not render the read-only flag, when showReadOnly is false", () => {
    render(
      <SandpackProvider fs={fs}>
        <SandpackCodeEditor showReadOnly={false} readOnly />
      </SandpackProvider>,
    );

    act(() => {
      jest.runAllTimers();
    });

    expect(screen.queryByTestId("read-only")).not.toBeInTheDocument();
  });
});

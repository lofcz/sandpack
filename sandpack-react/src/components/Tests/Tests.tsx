import type { TestError } from "@lofcz/sandpack-client";
import React from "react";

import { useClassNames } from "../../utils/classNames";

import {
  containerClassName,
  durationClassName,
  gapRightClassName,
  testClassName,
  testContainerClassName,
} from "./Tests.css";
import {
  failTextClassName,
  passTextClassName,
  skipTextClassName,
} from "./style";

type TestStatus = "idle" | "running" | "pass" | "fail";

export interface Test {
  name: string;
  blocks: string[];
  status: TestStatus;
  path: string;
  errors: TestError[];
  duration?: number | undefined;
}

interface SandpackTests extends React.HtmlHTMLAttributes<HTMLDivElement> {
  tests: Test[];
}

export const Tests: React.FC<SandpackTests> = ({ tests, style: _style }) => {
  const classNames = useClassNames();
  return (
    <div className={classNames("test", [testContainerClassName])}>
      {tests.map((test) => (
        <div
          key={test.name}
          className={classNames("test-result", [containerClassName])}
        >
          {test.status === "pass" && (
            <span
              className={classNames("test-pass-text", [
                passTextClassName,
                gapRightClassName,
              ])}
            >
              ✓
            </span>
          )}
          {test.status === "fail" && (
            <span
              className={classNames("test-fail-text", [
                failTextClassName,
                gapRightClassName,
              ])}
            >
              ✕
            </span>
          )}
          {test.status === "idle" && (
            <span
              className={classNames("test-idle-text", [
                skipTextClassName,
                gapRightClassName,
              ])}
            >
              ○
            </span>
          )}
          <span className={classNames("test-name-text", [testClassName])}>
            {test.name}
          </span>
          {test.duration !== undefined && (
            <span
              className={classNames("test-duration-text", [durationClassName])}
            >
              ({test.duration} ms)
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

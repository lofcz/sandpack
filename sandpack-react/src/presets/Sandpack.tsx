/* eslint-disable @typescript-eslint/ban-ts-comment */
import * as React from "react";

import type { CodeEditorProps } from "../components/CodeEditor";
import { SandpackCodeEditor } from "../components/CodeEditor";
import { SandpackConsole } from "../components/Console";
import { SandpackPreview } from "../components/Preview";
import { SandpackTests } from "../components/Tests";
import { SandpackStack } from "../components/common";
import { SandpackLayout } from "../components/common/Layout";
import { RoundedButton } from "../components/common/RoundedButton";
import { ConsoleIcon } from "../components/icons";
import { SandpackProvider } from "../contexts/sandpackContext";
import { THEME_PREFIX } from "../styles";
import type { SandpackInternal, SandpackInternalOptions } from "../types";
import { useClassNames } from "../utils/classNames";

import {
  buttonCounter,
  consoleWrapper,
  dragHandler,
  rtlLayoutClassName,
} from "./Sandpack.css";

export const Sandpack: SandpackInternal = ({
  options,
  fs,
  theme,
  ...props
}) => {
  options ??= {};
  options.resizablePanels ??= true;
  options.editorWidthPercentage ??= 50;
  options.showConsole ??= false;

  const rtlLayout = options?.rtl ?? false;
  const codeEditorOptions: CodeEditorProps = {
    showTabs: options.showTabs,
    showLineNumbers: options.showLineNumbers,
    showInlineErrors: options.showInlineErrors,
    wrapContent: options.wrapContent,
    closableTabs: options.closableTabs,
    initMode: options.initMode,
    extensions: options.codeEditor?.extensions,
    extensionsKeymap: options.codeEditor?.extensionsKeymap,
    readOnly: options.readOnly,
    showReadOnly: options.showReadOnly,
    additionalLanguages: options.codeEditor?.additionalLanguages,
  };

  const providerOptions: SandpackInternalOptions = {
    activeFile: options.activeFile,
    visibleFiles: options.visibleFiles,
    recompileMode: options.recompileMode,
    recompileDelay: options.recompileDelay,
    autorun: options.autorun,
    autoReload: options.autoReload,
    bundlerURL: options.bundlerURL,
    startRoute: options.startRoute,
    skipEval: options.skipEval,
    initMode: options.initMode,
    initModeObserverOptions: options.initModeObserverOptions,
    externalResources: options.externalResources,
    logLevel: options.logLevel,
    classes: options.classes,
    experimental_enableServiceWorker: options.experimental_enableServiceWorker,
    experimental_enableStableServiceWorkerId:
      options.experimental_enableStableServiceWorkerId,
  };

  /**
   * Derive the display mode from the FS sidecar or options.
   * Templates that set mode="tests" (test-ts) or mode="console" (none currently)
   * in createSandpackFS will have that stored on the FS.
   */
  const fsMode = fs.getMode() as typeof options.layout | undefined;
  const mode = options?.layout ?? fsMode ?? "preview";

  /**
   * Console
   */
  const [consoleVisibility, setConsoleVisibility] = React.useState(
    options.showConsole,
  );
  const [counter, setCounter] = React.useState(0);
  const hasRightColumn = options.showConsole || options.showConsoleButton;

  const actionsChildren = options.showConsoleButton ? (
    <ConsoleCounterButton
      counter={counter}
      onClick={(): void => setConsoleVisibility((prev) => !prev)}
    />
  ) : undefined;

  /**
   * Resizable
   */
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const dragEventTargetRef = React.useRef<any>(null);

  const [horizontalSize, setHorizontalSize] = React.useState(
    options.editorWidthPercentage,
  );
  const [verticalSize, setVerticalSize] = React.useState(70);

  const RightColumn = hasRightColumn ? SandpackStack : React.Fragment;
  const rightColumnStyle = {
    flexGrow: 100 - horizontalSize,
    flexShrink: 100 - horizontalSize,
    flexBasis: 0,
    width: 100 - horizontalSize + "%",
    gap: consoleVisibility ? 1 : 0,
    height: options.editorHeight, // use the original editor height
  };

  const topRowStyle = hasRightColumn
    ? {
        flexGrow: verticalSize,
        flexShrink: verticalSize,
        flexBasis: 0,
        overflow: "hidden",
      }
    : rightColumnStyle;

  const onDragMove = (event: MouseEvent): void => {
    if (!dragEventTargetRef.current) return;

    const container = dragEventTargetRef.current.parentElement as
      | HTMLDivElement
      | undefined;

    if (!container) return;

    const direction = dragEventTargetRef.current.dataset.direction as
      | "horizontal"
      | "vertical";
    const isHorizontal = direction === "horizontal";

    const { left, top, height, width } = container.getBoundingClientRect();
    const offset = isHorizontal
      ? ((event.clientX - left) / width) * 100
      : ((event.clientY - top) / height) * 100;
    const boundaries = Math.min(Math.max(offset, 25), 75);

    if (isHorizontal) {
      setHorizontalSize(rtlLayout ? 100 - boundaries : boundaries);
    } else {
      setVerticalSize(boundaries);
    }

    container.querySelectorAll(`.${THEME_PREFIX}-stack`).forEach((item) => {
      (item as HTMLDivElement).style.pointerEvents = "none";
    });
  };

  const stopDragging = (): void => {
    const container = dragEventTargetRef.current?.parentElement as
      | HTMLDivElement
      | undefined;

    if (!container) return;

    container.querySelectorAll(`.${THEME_PREFIX}-stack`).forEach((item) => {
      (item as HTMLDivElement).style.pointerEvents = "";
    });

    dragEventTargetRef.current = null;
  };

  React.useEffect(() => {
    if (!options?.resizablePanels) return;
    document.body.addEventListener("mousemove", onDragMove);
    document.body.addEventListener("mouseup", stopDragging);

    return (): void => {
      document.body.removeEventListener("mousemove", onDragMove);
      document.body.removeEventListener("mouseup", stopDragging);
    };
  }, [options]);

  React.useEffect(() => {
    setConsoleVisibility(options?.showConsole ?? false);
  }, [options.showConsole]);

  const rightColumnProps = hasRightColumn
    ? { className: THEME_PREFIX + "-preset-column", style: rightColumnStyle }
    : {};

  const classNames = useClassNames();

  return (
    <SandpackProvider
      fs={fs}
      options={providerOptions}
      theme={theme}
      {...props}
    >
      <SandpackLayout
        className={
          rtlLayout ? classNames("rtl-layout", [rtlLayoutClassName]) : ""
        }
      >
        <SandpackCodeEditor
          {...codeEditorOptions}
          style={{
            height: options.editorHeight, // use the original editor height
            flexGrow: horizontalSize,
            flexShrink: horizontalSize,
            flexBasis: 0,
            overflow: "hidden",
          }}
        />

        {options.resizablePanels && (
          <div
            className={classNames("resize-handler", [
              dragHandler({ direction: "horizontal" }),
            ])}
            data-direction="horizontal"
            onMouseDown={(event): void => {
              dragEventTargetRef.current = event.target;
            }}
            style={{
              left: `calc(${
                rtlLayout ? 100 - horizontalSize : horizontalSize
              }% - 5px)`,
            }}
          />
        )}

        {/* @ts-ignore */}
        <RightColumn {...rightColumnProps}>
          {mode === "preview" && (
            <SandpackPreview
              actionsChildren={actionsChildren}
              showNavigator={options.showNavigator}
              showRefreshButton={options.showRefreshButton}
              style={topRowStyle}
            />
          )}

          {mode === "tests" && (
            <SandpackTests
              actionsChildren={actionsChildren}
              style={topRowStyle}
            />
          )}

          {mode === "console" && (
            <SandpackConsole
              actionsChildren={actionsChildren}
              style={topRowStyle}
              standalone
            />
          )}

          {(options.showConsoleButton || consoleVisibility) && (
            <>
              {options.resizablePanels && consoleVisibility && (
                <div
                  className={classNames("resize-handler", [
                    dragHandler({ direction: "vertical" }),
                  ])}
                  data-direction="vertical"
                  onMouseDown={(event): void => {
                    dragEventTargetRef.current = event.target;
                  }}
                  style={{ top: `calc(${verticalSize}% - 5px)` }}
                />
              )}

              <div
                className={classNames("console-wrapper", [consoleWrapper])}
                style={{
                  flexGrow: consoleVisibility ? 100 - verticalSize : 0,
                  flexShrink: consoleVisibility ? 100 - verticalSize : 0,
                  flexBasis: 0,
                }}
              >
                <SandpackConsole
                  onLogsChange={(logs): void => setCounter(logs.length)}
                  showHeader={false}
                />
              </div>
            </>
          )}
        </RightColumn>
      </SandpackLayout>
    </SandpackProvider>
  );
};

const ConsoleCounterButton: React.FC<{
  onClick: () => void;
  counter: number;
}> = ({ onClick, counter }) => {
  return (
    <RoundedButton className={buttonCounter} onClick={onClick}>
      <ConsoleIcon />
      {counter > 0 && <strong>{counter}</strong>}
    </RoundedButton>
  );
};

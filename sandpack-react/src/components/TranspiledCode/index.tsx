// DEAD-CANDIDATE(2026-06): inherited upstream — not used by immediately.run (see
// DEPRECATION_CANDIDATES.md, sandpack-react components); flag-only, do not remove.
import * as React from "react";

import { useSandpack } from "../../hooks/useSandpack";
import { useTranspiledCode } from "../../hooks/useTranspiledCode";
import { useClassNames } from "../../utils/classNames";
import type { CodeViewerProps } from "../CodeViewer";
import { SandpackCodeViewer } from "../CodeViewer";
import { stackClassName } from "../common";
import { ErrorOverlay } from "../common/ErrorOverlay";
import { LoadingOverlay } from "../common/LoadingOverlay";

import { transpiledCodeClassName } from "./TranspiledCode.css";

export const SandpackTranspiledCode = ({
  className,
  ...props
}: CodeViewerProps &
  React.HTMLAttributes<HTMLDivElement>): React.JSX.Element => {
  const { sandpack } = useSandpack();
  const transpiledCode = useTranspiledCode();
  const classNames = useClassNames();

  const hiddenIframeRef = React.useRef<HTMLIFrameElement | null>(null);
  React.useEffect(() => {
    const hiddenIframe = hiddenIframeRef.current;

    if (hiddenIframe) {
      sandpack.registerBundler(hiddenIframe, "hidden");
    }
    return (): void => {
      sandpack.unregisterBundler("hidden");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={classNames("transpiled-code", [
        stackClassName,
        transpiledCodeClassName,
        className,
      ])}
      {...props}
    >
      <SandpackCodeViewer
        code={transpiledCode ?? ""}
        initMode={sandpack.initMode}
        {...props}
      />

      <iframe
        ref={hiddenIframeRef}
        style={{ display: "none" }}
        title="transpiled sandpack code"
      />
      <ErrorOverlay />
      <LoadingOverlay clientId="hidden" showOpenInCodeSandbox={false} />
    </div>
  );
};

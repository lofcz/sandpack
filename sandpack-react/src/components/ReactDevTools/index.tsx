// DEAD-CANDIDATE(2026-06): inherited upstream — not used by immediately.run (see
// DEPRECATION_CANDIDATES.md, sandpack-react components); flag-only, do not remove.
import * as React from "react";

import { useSandpackTheme, useSandpack } from "../../hooks";
import { useClassNames } from "../../utils/classNames";

import { devToolClassName } from "./ReactDevTools.css";

type DevToolsTheme = "dark" | "light" | "auto";

export const SandpackReactDevTools = ({
  clientId,
  theme,
  className,
  ...props
}: {
  clientId?: string;
  theme?: DevToolsTheme;
} & React.HTMLAttributes<HTMLDivElement>): React.JSX.Element | null => {
  const { listen, sandpack } = useSandpack();
  const { themeMode } = useSandpackTheme();
  const classNames = useClassNames();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reactDevtools = React.useRef<any>(undefined);

  const [ReactDevTools, setDevTools] = React.useState<React.FunctionComponent<{
    browserTheme: DevToolsTheme;
  }> | null>(null);

  React.useEffect(() => {
    import("react-devtools-inline/frontend").then((module) => {
      reactDevtools.current = module;
    });
  }, []);

  React.useEffect(() => {
    const unsubscribe = listen((msg) => {
      if (msg.type === "activate-react-devtools") {
        const client = clientId
          ? sandpack.clients[clientId]
          : Object.values(sandpack.clients)[0];
        const contentWindow = client?.iframe?.contentWindow;

        if (reactDevtools.current && contentWindow) {
          setDevTools(reactDevtools.current.initialize(contentWindow));
        }
      }
    });

    return unsubscribe;
  }, [reactDevtools, clientId, listen, sandpack.clients]);

  React.useEffect(() => {
    sandpack.registerReactDevTools("legacy");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ReactDevTools) return null;

  return (
    <div
      className={classNames("devtools", [devToolClassName, className])}
      {...props}
    >
      <ReactDevTools browserTheme={theme ?? themeMode} />
    </div>
  );
};

import * as React from "react";

import { SandpackThemeProvider } from "../styles/themeContext";
import type {
  SandpackContext,
  SandpackProviderProps,
  SandpackState,
} from "../types";
import { ClassNamesProvider } from "../utils/classNames";

import { createSandpackStore, SandpackStoreContext } from "./sandpackStore";
import { useAppState } from "./utils/useAppState";
import { useClient } from "./utils/useClient";
import { useFiles } from "./utils/useFiles";

const Sandpack = React.createContext<SandpackContext | null>(null);

export { SandpackFS } from "@lofcz/sandpack-client";

export const SandpackProvider: React.FC<SandpackProviderProps> = (props) => {
  const { children, options, style, className, theme } = props;

  const [fileState, fileOperations] = useFiles(props);
  const [clientState, { dispatchMessage, addListener, ...clientOperations }] =
    useClient(props, fileState);
  const appState = useAppState(
    props,
    fileState.isLoading ? null : fileState.fs,
    fileState.fileList,
  );
  React.useEffect(() => {
    clientOperations.initializeSandpackIframe();
  }, []);

  const contextValue = {
    ...fileState,
    ...clientState,
    ...appState,

    ...fileOperations,
    ...clientOperations,

    autoReload: props.options?.autoReload ?? true,
    teamId: props?.teamId,
    exportOptions: props?.exportOptions,

    listen: addListener,
    dispatch: dispatchMessage,
  };

  // Mirror the state into an external store so `useSandpackSelector` consumers
  // re-render only on their slice, not on every context rebuild. The store is
  // created once (stable identity) and fed the latest state after each commit.
  const storeRef = React.useRef<ReturnType<typeof createSandpackStore> | null>(
    null,
  );
  if (!storeRef.current) {
    storeRef.current = createSandpackStore(contextValue as SandpackState);
  }
  React.useEffect(() => {
    storeRef.current!.setState(contextValue as SandpackState);
  });

  return (
    <SandpackStoreContext.Provider value={storeRef.current}>
      <Sandpack.Provider value={contextValue}>
        <ClassNamesProvider classes={options?.classes}>
          <SandpackThemeProvider
            className={className}
            style={style}
            theme={theme}
          >
            {children}
          </SandpackThemeProvider>
        </ClassNamesProvider>
      </Sandpack.Provider>
    </SandpackStoreContext.Provider>
  );
};

/**
 * @category Provider
 */
const SandpackConsumer = Sandpack.Consumer;

export { SandpackConsumer, Sandpack as SandpackReactContext };

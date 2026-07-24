import type {
  BundlerState,
  ListenerFunction,
  ReactDevToolsMode,
  SandpackError,
  SandpackMessage,
  UnsubscribeFunction,
  SandpackClient,
} from "@lofcz/sandpack-client";
import { loadSandpackClient } from "@lofcz/sandpack-client";
import { extractErrorDetails } from "@lofcz/sandpack-client/utils";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  SandpackInitMode,
  SandpackProviderProps,
  SandpackStatus,
} from "../..";
import { generateRandomId } from "../../utils/stringUtils";
import { useAsyncSandpackId } from "../../utils/useAsyncSandpackId";

import type { FilesState } from "./useFiles";

type SandpackClientType = InstanceType<typeof SandpackClient>;

const BUNDLER_TIMEOUT = 40_000;

interface SandpackConfigState {
  reactDevTools?: ReactDevToolsMode;
  startRoute?: string;
  initMode: SandpackInitMode;
  bundlerState: BundlerState | undefined;
  error: SandpackError | null;
  status: SandpackStatus;
}

export interface ClientPropsOverride {
  startRoute?: string;
}

export interface UseClientOperations {
  clients: Record<string, SandpackClientType>;
  initializeSandpackIframe: () => void;
  runSandpack: () => Promise<void>;
  unregisterBundler: (clientId: string) => void;
  registerBundler: (
    iframe: HTMLIFrameElement,
    clientId: string,
    clientPropsOverride?: ClientPropsOverride,
  ) => Promise<void>;
  registerReactDevTools: (value: ReactDevToolsMode) => void;
  addListener: (
    listener: ListenerFunction,
    clientId?: string,
  ) => UnsubscribeFunction;
  dispatchMessage: (message: SandpackMessage, clientId?: string) => void;
  lazyAnchorRef: React.RefObject<HTMLDivElement | null>;
  unsubscribeClientListenersRef: React.MutableRefObject<
    Record<string, Record<string, UnsubscribeFunction>>
  >;
  queuedListenersRef: React.MutableRefObject<
    Record<string, Record<string, ListenerFunction>>
  >;
}

type UseClient = (
  props: SandpackProviderProps,
  filesState: FilesState,
) => [SandpackConfigState, UseClientOperations];

export const useClient: UseClient = (
  { options, npmRegistries, teamId, sandboxId },
  filesState,
) => {
  options ??= {};

  const initModeFromProps = options?.initMode || "lazy";

  const [state, setState] = useState<SandpackConfigState>({
    startRoute: options?.startRoute,
    bundlerState: undefined,
    error: null,
    initMode: initModeFromProps,
    reactDevTools: undefined,
    status: (options?.autorun ?? true) ? "initial" : "idle",
  });

  /**
   * Refs
   */
  type InterserctionObserverCallback = (
    entries: IntersectionObserverEntry[],
  ) => void;
  const intersectionObserverCallback = useRef<
    InterserctionObserverCallback | undefined
  >(undefined);
  const intersectionObserver = useRef<IntersectionObserver | null>(null);
  const lazyAnchorRef = useRef<HTMLDivElement>(null);
  const registeredIframes = useRef<
    Record<
      string,
      { iframe: HTMLIFrameElement; clientPropsOverride?: ClientPropsOverride }
    >
  >({});
  const clients = useRef<Record<string, SandpackClientType>>({});
  const timeoutHook = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubscribeClientListeners = useRef<
    Record<string, Record<string, UnsubscribeFunction>>
  >({});
  const unsubscribe = useRef<(() => void) | undefined>(undefined);
  const queuedListeners = useRef<
    Record<string, Record<string, ListenerFunction>>
  >({ global: {} });
  const debounceHook = useRef<number | undefined>(undefined);
  const prevEnvironment = useRef(filesState.environment);

  const asyncSandpackId = useAsyncSandpackId(
    filesState.fileList,
    filesState.fs,
  );

  /**
   * Callbacks
   */
  const createClient = useCallback(
    async (
      iframe: HTMLIFrameElement,
      clientId: string,
      clientPropsOverride?: ClientPropsOverride,
    ): Promise<void> => {
      // Clean up any existing clients that
      // have been created with the given id
      if (clients.current[clientId]) {
        clients.current[clientId].destroy();
      }

      console.log("[Sandpack] Creating client", { iframe, clientId, clientPropsOverride });

      options ??= {};

      const timeOut = options?.bundlerTimeOut ?? BUNDLER_TIMEOUT;

      if (timeoutHook.current) {
        clearTimeout(timeoutHook.current);
      }

      /**
       * Subscribe inside the context with the first client that gets instantiated.
       * This subscription is for global states like error and timeout, so no need for a per client listen
       * Also, set the timeout timer only when the first client is instantiated
       */
      const shouldSetTimeout = typeof unsubscribe.current !== "function";

      if (shouldSetTimeout) {
        timeoutHook.current = setTimeout(() => {
          unregisterAllClients();
          setState((prev) => ({ ...prev, status: "timeout" }));
        }, timeOut);
      }

      const getStableServiceWorkerId = async () => {
        if (options?.experimental_enableStableServiceWorkerId) {
          const key = `SANDPACK_INTERNAL:URL-CONSISTENT-ID`;
          let fixedId = localStorage.getItem(key);

          if (!fixedId) {
            fixedId = await asyncSandpackId();
            localStorage.setItem(key, fixedId);
          }

          return fixedId;
        }

        return await asyncSandpackId();
      };

      const client = await loadSandpackClient(
        iframe,
        {
          fs: filesState.fs,
          template: filesState.environment,
        },
        {
          externalResources: options.externalResources,
          bundlerURL: options.bundlerURL,
          babelWorkerURL: options.babelWorkerURL,
          startRoute: clientPropsOverride?.startRoute ?? options.startRoute,
          skipEval: options.skipEval ?? false,
          logLevel: options.logLevel,
          // Host-pinned SDK integrity (SDK_PACKAGING_SPEC §5.2): forward the pin
          // so the runtime client can deliver it on the register-frame
          // handshake. Absent ⇒ the bundler skips verification.
          sdkIntegrity: options.sdkIntegrity,
          // The §5.2 dirty set: forward so the runtime client delivers it on
          // register-frame and the bundler skips seeding edited-in-a-prior-session
          // paths. Absent ⇒ nothing dirty.
          dirtyPaths: options.dirtyPaths,
          // R3-49b batch-hydration snapshot: forward so the runtime client delivers
          // it on register-frame and the bundler hydrates its read caches before the
          // first compile. Absent ⇒ reads cross the Port as before.
          fsSnapshot: options.fsSnapshot,
          showOpenInCodeSandbox: false,
          showErrorScreen: true,
          showLoadingScreen: false,
          reactDevTools: state.reactDevTools,
          customNpmRegistries: npmRegistries,
          teamId,
          experimental_enableServiceWorker:
            !!options?.experimental_enableServiceWorker,
          experimental_stableServiceWorkerId: await getStableServiceWorkerId(),
          sandboxId,
        },
      );

      if (typeof unsubscribe.current !== "function") {
        unsubscribe.current = client.listen(handleMessage);
      }

      unsubscribeClientListeners.current[clientId] =
        unsubscribeClientListeners.current[clientId] || {};

      // Clear the global bundler timeout as soon as THIS client reports a
      // successful compile. `handleMessage` (above) is bound to the FIRST client
      // ONLY, so a separate, later client — e.g. the self-routed file-explorer
      // panel, its own SandpackProvider — would otherwise never clear the timer
      // and hit a spurious TIME_OUT after loading fine (the #4 panel race): the
      // app loaded but its "done" was never registered against the timeout.
      // Belt-and-braces: (a) a per-client listener so any client's "done"/"connected"
      // clears it, and (b) a status reconcile for a "done" that already landed
      // before this listener attached (a fast warm-cache load).
      const clearTimeoutOnReady = (msg: SandpackMessage): void => {
        if (
          ((msg.type === "done" && !msg.compilatonError) ||
            msg.type === "connected") &&
          timeoutHook.current
        ) {
          clearTimeout(timeoutHook.current);
          timeoutHook.current = null;
        }
      };
      unsubscribeClientListeners.current[clientId]["__sp_timeout_reconcile__"] =
        client.listen(clearTimeoutOnReady) as () => void;
      if (client.status === "done" && timeoutHook.current) {
        clearTimeout(timeoutHook.current);
        timeoutHook.current = null;
        setState((prev) => ({ ...prev, error: null }));
      }

      /**
       * Register any potential listeners that subscribed before sandpack ran
       */
      if (queuedListeners.current[clientId]) {
        Object.keys(queuedListeners.current[clientId]).forEach((listenerId) => {
          const listener = queuedListeners.current[clientId][listenerId];
          const unsubscribe = client.listen(listener) as () => void;
          unsubscribeClientListeners.current[clientId][listenerId] =
            unsubscribe;
        });

        // Clear the queued listeners after they were registered
        queuedListeners.current[clientId] = {};
      }

      /**
       * Register global listeners
       */
      const globalListeners = Object.entries(queuedListeners.current.global);
      globalListeners.forEach(([listenerId, listener]) => {
        const unsubscribe = client.listen(listener) as () => void;
        unsubscribeClientListeners.current[clientId][listenerId] = unsubscribe;

        /**
         * Important: Do not clean the global queue
         * Instead of cleaning the queue, keep it there for the
         * following clients that might be created
         */
      });

      clients.current[clientId] = client;
    },
    [filesState.environment, filesState.fs, state.reactDevTools],
  );

  const unregisterAllClients = useCallback((): void => {
    Object.keys(clients.current).map(unregisterBundler);

    if (typeof unsubscribe.current === "function") {
      unsubscribe.current();
      unsubscribe.current = undefined;
    }
  }, []);

  const runSandpack = useCallback(async (): Promise<void> => {
    await Promise.all(
      Object.entries(registeredIframes.current).map(
        async ([clientId, { iframe, clientPropsOverride = {} }]) => {
          await createClient(iframe, clientId, clientPropsOverride);
        },
      ),
    );

    setState((prev) => ({ ...prev, error: null, status: "running" }));
  }, [createClient]);

  intersectionObserverCallback.current = (
    entries: IntersectionObserverEntry[],
  ): void => {
    if (entries.some((entry) => entry.isIntersecting)) {
      runSandpack();
    } else {
      unregisterAllClients();
    }
  };

  const initializeSandpackIframe = useCallback((): void => {
    const autorun = options?.autorun ?? true;

    if (!autorun) {
      return;
    }

    const observerOptions = options?.initModeObserverOptions ?? {
      rootMargin: `1000px 0px`,
    };

    if (intersectionObserver.current && lazyAnchorRef.current) {
      intersectionObserver.current?.unobserve(lazyAnchorRef.current);
    }

    if (lazyAnchorRef.current && state.initMode === "lazy") {
      // If any component registered a lazy anchor ref component, use that for the intersection observer
      intersectionObserver.current = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          // Trigger it once
          if (
            entries.some((entry) => entry.isIntersecting) &&
            lazyAnchorRef.current
          ) {
            intersectionObserverCallback.current?.(entries);

            intersectionObserver.current?.unobserve(lazyAnchorRef.current);
          }
        }
      }, observerOptions);

      intersectionObserver.current.observe(lazyAnchorRef.current);
    } else if (lazyAnchorRef.current && state.initMode === "user-visible") {
      intersectionObserver.current = new IntersectionObserver((entries) => {
        intersectionObserverCallback.current?.(entries);
      }, observerOptions);

      intersectionObserver.current.observe(lazyAnchorRef.current);
    } else {
      runSandpack();
    }
  }, [
    options?.autorun,
    options?.initModeObserverOptions,
    runSandpack,
    state.initMode,
    unregisterAllClients,
  ]);

  const registerBundler = useCallback(
    async (
      iframe: HTMLIFrameElement,
      clientId: string,
      clientPropsOverride?: ClientPropsOverride,
    ): Promise<void> => {
      // Store the iframe info so it can be
      // used later to manually run sandpack
      registeredIframes.current[clientId] = {
        iframe,
        clientPropsOverride,
      };

      if (state.status === "running") {
        await createClient(iframe, clientId, clientPropsOverride);
      }
    },
    [createClient, state.status],
  );

  const unregisterBundler = (clientId: string): void => {
    const client = clients.current[clientId];
    if (client) {
      client.destroy();
      client.iframe.contentWindow?.location.replace("about:blank");
      client.iframe.removeAttribute("src");
      delete clients.current[clientId];
    } else {
      delete registeredIframes.current[clientId];
    }

    if (timeoutHook.current) {
      clearTimeout(timeoutHook.current);
    }

    const unsubscribeQueuedClients = Object.values(
      unsubscribeClientListeners.current[clientId] ?? {},
    );

    // Unsubscribing all listener registered
    unsubscribeQueuedClients.forEach((listenerOfClient) => {
      const listenerFunctions = Object.values(listenerOfClient);
      listenerFunctions.forEach((unsubscribe) => unsubscribe());
    });

    // Keep running if it still have clients
    const status = Object.keys(clients.current).length > 0 ? "running" : "idle";

    setState((prev) => ({ ...prev, status }));
  };

  const handleMessage = (msg: SandpackMessage): void => {
    if (msg.type === "start") {
      setState((prev) => ({ ...prev, error: null }));
    } else if (msg.type === "state") {
      setState((prev) => ({ ...prev, bundlerState: msg.state }));
    } else if (
      (msg.type === "done" && !msg.compilatonError) ||
      msg.type === "connected"
    ) {
      if (timeoutHook.current) {
        clearTimeout(timeoutHook.current);
      }

      setState((prev) => ({ ...prev, error: null }));
    } else if (msg.type === "action" && msg.action === "show-error") {
      if (timeoutHook.current) {
        clearTimeout(timeoutHook.current);
      }

      setState((prev) => ({ ...prev, error: extractErrorDetails(msg) }));
    } else if (
      msg.type === "action" &&
      msg.action === "notification" &&
      msg.notificationType === "error"
    ) {
      setState((prev) => ({
        ...prev,
        error: { message: msg.title },
      }));
    }
  };

  const registerReactDevTools = (value: ReactDevToolsMode): void => {
    setState((prev) => ({ ...prev, reactDevTools: value }));
  };

  const recompileMode = options?.recompileMode ?? "delayed";
  const recompileDelay = options?.recompileDelay ?? 200;

  const dispatchMessage = (
    message: SandpackMessage,
    clientId?: string,
  ): void => {
    if (state.status !== "running") {
      console.warn(
        `[sandpack-react]: dispatch cannot be called while in idle mode`,
      );
      return;
    }

    if (clientId) {
      clients.current[clientId].dispatch(message);
    } else {
      Object.values(clients.current).forEach((client) => {
        client.dispatch(message);
      });
    }
  };

  const addListener = (
    listener: ListenerFunction,
    clientId?: string,
  ): UnsubscribeFunction => {
    if (clientId) {
      if (clients.current[clientId]) {
        const unsubscribeListener = clients.current[clientId].listen(listener);

        return unsubscribeListener;
      } else {
        /**
         * When listeners are added before the client is instantiated, they are stored with an unique id
         * When the client is eventually instantiated, the listeners are registered on the spot
         * Their unsubscribe functions are stored in unsubscribeClientListeners for future cleanup
         */
        const listenerId = generateRandomId();
        queuedListeners.current[clientId] =
          queuedListeners.current[clientId] || {};
        unsubscribeClientListeners.current[clientId] =
          unsubscribeClientListeners.current[clientId] || {};

        queuedListeners.current[clientId][listenerId] = listener;

        const unsubscribeListener = (): void => {
          if (queuedListeners.current[clientId][listenerId]) {
            /**
             * Unsubscribe was called before the client was instantiated
             * common example - a component with autorun=false that unmounted
             */
            delete queuedListeners.current[clientId][listenerId];
          } else if (unsubscribeClientListeners.current[clientId][listenerId]) {
            /**
             * unsubscribe was called for a listener that got added before the client was instantiated
             * call the unsubscribe function and remove it from memory
             */
            unsubscribeClientListeners.current[clientId][listenerId]();
            delete unsubscribeClientListeners.current[clientId][listenerId];
          }
        };

        return unsubscribeListener;
      }
    } else {
      // Push to the **global** queue
      const listenerId = generateRandomId();
      queuedListeners.current.global[listenerId] = listener;

      // Add to the current clients
      const clientsList = Object.values(clients.current);
      const currentClientUnsubscribeListeners = clientsList.map((client) =>
        client.listen(listener),
      );

      const unsubscribeListener = (): void => {
        // Unsubscribing from the clients already created
        currentClientUnsubscribeListeners.forEach((unsubscribe) =>
          unsubscribe(),
        );

        delete queuedListeners.current.global[listenerId];

        // Unsubscribe in case it was added later from `global`
        Object.values(unsubscribeClientListeners.current).forEach((client) => {
          client?.[listenerId]?.();
        });
      };

      return unsubscribeListener;
    }
  };

  /**
   * Effects
   */

  useEffect(
    function watchFileChanges() {
      if (state.status !== "running" || !filesState.shouldUpdatePreview) {
        return;
      }

      const fs = filesState.fs;

      /**
       * When the environment changes, Sandpack needs to make sure
       * to create a new client and the proper bundler
       */
      if (prevEnvironment.current !== filesState.environment) {
        prevEnvironment.current = filesState.environment;

        Object.entries(clients.current).forEach(([key, client]) => {
          registerBundler(client.iframe, key);
        });
      }

      const recompile = (paths: string[]) => {
        Object.values(clients.current).forEach((client) => {
          /**
           * The runtime bundler can't observe parent-side writes to the shared
           * filesystem itself (zenfs's Port backend doesn't forward watch
           * events), so relay the changed paths. Sent unconditionally: the
           * bundler debounces and accumulates pending changes, so a relay that
           * arrives mid-compile is still picked up by the next compile. No-op
           * for other client types, which re-bundle via `updateSandbox` below.
           */
          client.notifyFilesChanged(paths);

          /**
           * Avoid concurrency for the legacy compile-message clients
           * (static/node); the runtime client's `updateSandbox` is a no-op.
           */
          if (client.status === "done") {
            client.updateSandbox({
              fs,
              template: filesState.environment,
            });
          }
        });
      };

      /**
       * Accumulate changed paths across the debounce window so a single
       * recompile relays the full set.
       */
      const pendingPaths = new Set<string>();
      const flush = (): void => {
        const paths = Array.from(pendingPaths);
        pendingPaths.clear();
        recompile(paths);
      };

      /**
       * Re-bundle on any filesystem mutation — local edits and iframe writes
       * both need a recompile — debounced or immediate as configured.
       */
      const unsub = fs.onChange(({ path }) => {
        pendingPaths.add(path);

        if (recompileMode === "immediate") {
          flush();
          return;
        }

        if (recompileMode === "delayed" && typeof window !== "undefined") {
          window.clearTimeout(debounceHook.current);
          debounceHook.current = window.setTimeout(flush, recompileDelay);
        }
      });

      return () => {
        unsub();
        window.clearTimeout(debounceHook.current);
      };
    },
    [
      filesState.fs,
      filesState.environment,
      filesState.shouldUpdatePreview,
      recompileDelay,
      recompileMode,
      registerBundler,
      state.status,
    ],
  );

  useEffect(
    function watchInitMode() {
      if (initModeFromProps !== state.initMode) {
        setState((prev) => ({ ...prev, initMode: initModeFromProps }));

        initializeSandpackIframe();
      }
    },
    [initModeFromProps, initializeSandpackIframe, state.initMode],
  );

  useEffect(() => {
    return function unmountClient(): void {
      if (typeof unsubscribe.current === "function") {
        unsubscribe.current();
      }

      if (timeoutHook.current) {
        clearTimeout(timeoutHook.current);
      }

      if (debounceHook.current) {
        clearTimeout(debounceHook.current);
      }

      if (intersectionObserver.current) {
        intersectionObserver.current.disconnect();
      }
    };
  }, []);

  return [
    state,
    {
      clients: clients.current,
      initializeSandpackIframe,
      runSandpack,
      registerBundler,
      unregisterBundler,
      registerReactDevTools,
      addListener,
      dispatchMessage,
      lazyAnchorRef,
      unsubscribeClientListenersRef: unsubscribeClientListeners,
      queuedListenersRef: queuedListeners,
    },
  ];
};

import * as React from "react";

import { SandpackStoreContext } from "../contexts/sandpackStore";
import type { SandpackState } from "../types";

/**
 * Subscribe to **one slice** of Sandpack state. The component re-renders only
 * when `selector(...)`'s output changes by `Object.is` — not on every
 * `SandpackProvider` context rebuild (which fires on every keystroke). This is
 * the fine-grained alternative to `useSandpack()`, whose consumers all re-render
 * on any state change because the context value is a fresh object each render.
 *
 * ```tsx
 * const activeFile = useSandpackSelector((s) => s.activeFile); // primitive → stable
 * const status = useSandpackSelector((s) => s.status);
 * ```
 *
 * Return a **primitive or a referentially-stable value** from the selector. A
 * selector that builds a fresh object/array each call will re-render every time
 * (and trip React's "getSnapshot should be cached" guard) — use `fileList` etc.,
 * which the provider keeps stable until they actually change.
 *
 * For imperative operations (`openFile`, `setActiveFile`, …) keep using
 * `useSandpack()`: those identities are already stable and are not a re-render
 * hot path.
 */
export function useSandpackSelector<T>(
  selector: (state: SandpackState) => T,
): T {
  const store = React.useContext(SandpackStoreContext);

  if (store === null) {
    throw new Error(
      `[sandpack-react]: "useSandpackSelector" must be wrapped by a "SandpackProvider"`,
    );
  }

  const getSelection = (): T => selector(store.getState());
  return React.useSyncExternalStore(
    store.subscribe,
    getSelection,
    getSelection,
  );
}

import * as React from "react";

import type { SandpackState } from "../types";

/**
 * A tiny external store (the `useSyncExternalStore` shape) mirroring the current
 * {@link SandpackState}. It exists so a consumer can subscribe to **one slice**
 * (`activeFile` / `status` / `fileList` / …) and re-render only when THAT slice
 * changes — instead of re-rendering on every `SandpackProvider` context rebuild,
 * which happens on every keystroke (the context value is a fresh object literal
 * each render). See `useSandpackSelector`.
 *
 * The store is fed from React render state: `SandpackProvider` calls `setState`
 * with the freshly-assembled state after each commit. Selectors that return a
 * primitive (or a referentially-stable slice like `fileList`) then re-render
 * their consumer only when the selected value changes by `Object.is`.
 */
export interface SandpackStore {
  /** Register a listener; returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  /** The current state snapshot (a stable reference between `setState` calls). */
  getState: () => SandpackState;
}

/** The store plus the write side, held privately by `SandpackProvider`. */
export interface MutableSandpackStore extends SandpackStore {
  setState: (next: SandpackState) => void;
}

export const createSandpackStore = (
  initial: SandpackState,
): MutableSandpackStore => {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    setState: (next) => {
      state = next;
      listeners.forEach((listener) => listener());
    },
  };
};

/**
 * Carries the {@link SandpackStore} to the subtree. Its value is a **stable**
 * store object (created once per provider), so reading it via context never
 * itself triggers a re-render — only the `useSyncExternalStore` subscription in
 * `useSandpackSelector` does, and only for the changed slice.
 */
export const SandpackStoreContext = React.createContext<SandpackStore | null>(
  null,
);

import type { SandpackFS } from "@lofcz/sandpack-client";
import React from "react";

import type { CreateSandpackFSOptions } from "./createSandpackFS";
import { createSandpackFS } from "./createSandpackFS";

/**
 * Stories have no live preview iframe to bridge to, so hand back an
 * unconnected MessagePort. The in-memory FS still works locally; only remote
 * (iframe) sync is inert.
 */
const stubRemotePortFactory = (): Promise<MessagePort> =>
  Promise.resolve(new MessageChannel().port1);

/**
 * Async-resolving hook for story files. Creates a SandpackFS from the given
 * options on mount. Returns null while initializing. (SandpackFS exposes no
 * public disposal; its in-memory store is released on GC.)
 */
export const useSandpackFS = (
  options: CreateSandpackFSOptions = {},
): SandpackFS | null => {
  const [fs, setFs] = React.useState<SandpackFS | null>(null);

  React.useEffect(() => {
    let live = true;
    createSandpackFS(options, stubRemotePortFactory).then((newFs) => {
      if (live) {
        setFs(newFs);
      }
    });
    return () => {
      live = false;
      setFs(null);
    };
    // Options are treated as mount-time config, not reactive deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return fs;
};

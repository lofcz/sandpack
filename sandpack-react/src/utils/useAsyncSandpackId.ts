import type { SandpackFS } from "@lofcz/sandpack-client";
import { useId as useReactId } from "react";

import { generateRandomId } from "./stringUtils";

export const useSandpackId = () => {
  if (typeof useReactId === "function") {
    /* eslint-disable-next-line */
    return useReactId();
  } else {
    return generateRandomId();
  }
};

/**
 * This is a hard constraint to make URLs shorter.
 * For example, this id will be used to mount SW in the iframe
 * so, to keep the URL valid, this must be an 9 character long string
 */
const MAX_ID_LENGTH = 9;

const sandpackClientVersion = process.env.SANDPACK_CLIENT_VERSION;

/**
 * Produces a stable id derived from the current filesystem contents. The
 * snapshot is only materialized when the returned thunk is called, so we
 * don't pay for the read unless a stable service-worker id is requested.
 */
export const useAsyncSandpackId = (fileList: string[], fs: SandpackFS) => {
  if (typeof useReactId === "function") {
    /* eslint-disable-next-line react-hooks/rules-of-hooks */
    const reactDomId = useReactId();
    return async () => {
      const entries = await Promise.all(
        fileList.map(async (path) => `${path}|${await fs.readFile(path)}`),
      );
      const allCode = entries.join("|||");
      const sha = await generateShortId(
        allCode + reactDomId + sandpackClientVersion,
      );

      return ensureLength(
        sha.replace(/:/g, "sp").replace(/[^a-zA-Z]/g, ""),
        MAX_ID_LENGTH,
      );
    };
  } else {
    return () => ensureLength(generateRandomId(), MAX_ID_LENGTH);
  }
};

function ensureLength(str: string, length: number) {
  if (str.length > length) {
    return str.slice(0, length);
  } else {
    return str.padEnd(length, "s");
  }
}

async function generateShortId(input: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return btoa(String.fromCharCode(...hashArray));
}

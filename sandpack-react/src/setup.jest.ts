import crypto from "crypto";
import { TextEncoder, TextDecoder } from "util";

import "@vanilla-extract/css/disableRuntimeStyles";

process.env.TEST_ENV = "true";

Object.assign(global, { TextDecoder, TextEncoder });

// jsdom does not expose `structuredClone`, which ZenFS (`bindContext`) uses — so
// every `createSandpackFS`-backed test throws `structuredClone is not defined`
// without this. Prefer the Node global when present (node ≥ 17); fall back to a
// structural clone for the plain values the fs config carries.
if (
  typeof (global as { structuredClone?: unknown }).structuredClone ===
  "undefined"
) {
  (global as { structuredClone: <T>(value: T) => T }).structuredClone =
    typeof globalThis.structuredClone === "function"
      ? globalThis.structuredClone
      : <T>(value: T): T =>
          value === undefined
            ? value
            : (JSON.parse(JSON.stringify(value)) as T);
}

const subtle = {
  digest: async function (
    algorithm: string,
    data: Uint8Array,
  ): Promise<ArrayBuffer> {
    const hash = crypto.createHash("sha256");
    hash.update(Buffer.from(data));
    return hash.digest().buffer;
  },
};

const webCrypto = {
  subtle,
  getRandomValues: function (buffer: Uint8Array): Uint8Array {
    return crypto.randomFillSync(buffer);
  },
};

Object.defineProperty(global, "crypto", {
  value: webCrypto,
  writable: true,
  configurable: true,
  enumerable: true,
});

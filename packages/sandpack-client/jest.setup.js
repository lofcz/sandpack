// zenfs' polyfill script assumes `globalThis.crypto` exists so it can
// conditionally polyfill `crypto.randomUUID`. Node 18 exposes
// `webcrypto` instead; wire it up before any modules are loaded.
const { webcrypto } = require("crypto");
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = webcrypto;
}

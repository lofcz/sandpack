// zenfs' polyfill script assumes `globalThis.crypto` exists so it can
// conditionally polyfill `crypto.randomUUID`. Node 18 exposes
// `webcrypto` instead; wire it up before any modules are loaded.
const { webcrypto } = require("crypto");
if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = webcrypto;
}

const { TextEncoder, TextDecoder } = require("util");
globalThis.TextEncoder ??= TextEncoder;
globalThis.TextDecoder ??= TextDecoder;
// Jest 27 does not expose Node's Fetch API in its VM environments.
const { Response, Headers, Request } = require("node-fetch");
globalThis.Response ??= Response;
globalThis.Headers ??= Headers;
globalThis.Request ??= Request;
if (!globalThis.structuredClone) {
  const v8 = require("v8");
  globalThis.structuredClone = (value) =>
    v8.deserialize(v8.serialize(value));
}

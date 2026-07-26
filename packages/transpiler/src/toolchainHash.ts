// Deterministic hash of the published @immediately-run/transpiler artifact —
// the `toolchainHash` recorded alongside the version in an artifact index's
// `toolchain` (PRETRANSPILED_ARTIFACTS_SPEC §4.4). A version string can survive a
// republish or an npm/CDN divergence while the bytes drift; the hash makes the
// byte-identity guarantee enforceable. Both producers (the CLI, running the
// npm-installed package; the sandbox build, hashing the published artifact for
// the version it embeds) MUST compute it by this recipe.
//
// Uses Web Crypto (`crypto.subtle`), available in Node >=20 and browsers, so the
// package stays isomorphic with no Node-only imports.

/** The published file set: package-relative path => file bytes. */
export type TarballFiles = Map<string, Uint8Array> | Iterable<[string, Uint8Array]> | Record<string, Uint8Array>;

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return new Uint8Array(digest);
}

function toEntries(files: TarballFiles): Array<[string, Uint8Array]> {
  if (typeof (files as any)[Symbol.iterator] === 'function') {
    return Array.from(files as Iterable<[string, Uint8Array]>);
  }
  return Object.entries(files as Record<string, Uint8Array>);
}

// Lexicographic comparison over raw UTF-8 bytes (not UTF-16 code units), as the
// spec requires. Equivalent to JS string `<` for ASCII paths, but correct for
// any non-ASCII path the tarball might contain.
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Compute the canonical `toolchainHash` over a published tarball's file set:
 *   1. key every file by its package-relative path;
 *   2. sort paths by UTF-8 byte order;
 *   3. for each file in order contribute `utf8(path) ‖ 0x00 ‖ sha256(fileBytes)`;
 *   4. `toolchainHash = sha256(concatenation)`, lower-case hex.
 */
export async function computeToolchainHash(files: TarballFiles): Promise<string> {
  const enc = new TextEncoder();
  const entries = toEntries(files).map(([path, bytes]) => ({
    pathBytes: enc.encode(path),
    bytes,
  }));
  entries.sort((x, y) => compareBytes(x.pathBytes, y.pathBytes));

  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const fileHash = await sha256(entry.bytes);
    parts.push(entry.pathBytes, new Uint8Array([0x00]), fileHash);
  }

  return toHex(await sha256(concat(parts)));
}

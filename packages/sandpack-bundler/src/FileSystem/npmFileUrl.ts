/**
 * Origin for raw npm package files the package CDN lists but does not inline:
 * lazily read text files (RegistryFS) and binary assets referenced from package
 * CSS (fonts, images). The package CDN only serves text bundles, so binary
 * bytes always come from here. Always addressed at an exact version, so every
 * URL is immutable and CORS-readable (`Access-Control-Allow-Origin: *`).
 */
export const NPM_FILE_ORIGIN = 'https://unpkg.com/';

/** `name@exact-version/relPath` on {@link NPM_FILE_ORIGIN}. */
export function npmFileUrl(moduleName: string, moduleVersion: string, relPath: string): string {
  return `${NPM_FILE_ORIGIN}${moduleName}@${moduleVersion}/${relPath}`;
}

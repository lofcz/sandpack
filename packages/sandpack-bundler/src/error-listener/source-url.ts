// The name an evaluated module carries in stack traces (`//# sourceURL`). It
// has its own scheme so it never depends on the page: the preview frame has an
// opaque origin, where `location.origin` is the string "null".

const MODULE_URL_PREFIX = 'sandpack://';

/** The sourceURL of the module at `filepath` (an absolute bundler path). */
export function moduleSourceURL(filepath: string): string {
  // A sourceURL ends at the first whitespace, so the path is escaped.
  return MODULE_URL_PREFIX + encodeURI(filepath);
}

/** The bundler path a stack frame's file name stands for, or null when it is not an evaluated module. */
export function modulePathOfSourceURL(fileName: string): string | null {
  if (!fileName.startsWith(MODULE_URL_PREFIX)) return null;
  const path = fileName.slice(MODULE_URL_PREFIX.length);
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

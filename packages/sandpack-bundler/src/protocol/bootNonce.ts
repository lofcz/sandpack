/** URL parameter the host puts on each navigation of this frame (sandpack-client). */
export const BOOT_NONCE_PARAM = 'sandpack-boot';

/**
 * Read this page's boot nonce and take it off the URL, so the material running
 * here sees a clean location and does not carry the nonce into its own routes.
 */
export function readBootNonce(win: Window = window): { boot?: string } {
  try {
    const url = new URL(win.location.href);
    const boot = url.searchParams.get(BOOT_NONCE_PARAM);
    if (!boot) return {};
    url.searchParams.delete(BOOT_NONCE_PARAM);
    try {
      win.history.replaceState(win.history.state, '', url.toString());
    } catch {
      /* the nonce still travels in the message */
    }
    return { boot };
  } catch {
    return {};
  }
}

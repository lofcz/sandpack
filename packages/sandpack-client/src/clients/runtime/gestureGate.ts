/**
 * R3-367 — the getCodeSandboxURL gesture gate, extracted so it is testable
 * without standing the whole runtime graph up (and so the fork's node-env
 * suites can import it too).
 */

/**
 * Whether a codesandbox.io export may run: the user has been ACTIVE on this
 * page (sticky activation — the fs snapshot can outlive a transient window).
 * False ⇒ app/script-initiated context ⇒ the export must refuse before
 * reading the filesystem.
 */
export const codeSandboxExportAllowed = (): boolean =>
  (navigator as { userActivation?: { hasBeenActive?: boolean } })
    .userActivation?.hasBeenActive === true;

/**
 * Make a gesture-gate refusal observable: a `sandpack-security-violation`
 * CustomEvent the host (site-main) can listen for and journal into its
 * security-events stream. Never throws — observability must not become a
 * second failure mode on the refusal path.
 */
export const notifyCodeSandboxExportRefused = (): void => {
  try {
    window.dispatchEvent(
      new CustomEvent("sandpack-security-violation", {
        detail: {
          kind: "gesture-gate.getCodeSandboxURL",
          reason: "no user activation",
        },
      }),
    );
  } catch {
    /* no window / dispatch unavailable */
  }
};

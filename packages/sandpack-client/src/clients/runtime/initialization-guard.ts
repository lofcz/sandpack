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
 */
export class InitializationGuard {
  private expected = 0;
  private detached = false;

  /** Record that the host has navigated the frame, so ONE boot is now expected. */
  arm(): void {
    if (this.detached) return;
    this.expected++;
  }

  /**
   * Spend one armed boot. Returns `false` when this boot was not caused by the
   * host — the caller must then refuse to connect or register anything.
   *
   * The first `false` **detaches** the guard permanently: every later call
   * returns `false` too, including after an `arm()`, so a refused frame cannot be
   * brought back by any sequence of messages.
   */
  consume(): boolean {
    if (this.detached) return false;
    if (this.expected > 0) {
      this.expected--;
      return true;
    }
    this.detached = true;
    return false;
  }

  /** True once an unexpected boot has been refused. Terminal. */
  get isDetached(): boolean {
    return this.detached;
  }

  /** How many host-initiated boots are still outstanding (diagnostics/tests). */
  get pending(): number {
    return this.expected;
  }
}

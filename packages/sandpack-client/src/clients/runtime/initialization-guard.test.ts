import { InitializationGuard } from "./initialization-guard";

/**
 * R3-353 — the re-register guard.
 *
 * The property under test is a NEGATIVE one ("a boot the host did not cause is
 * refused"), so most of this file is the sequences that must NOT be honoured.
 * Runtime integration is exercised by lifecycle.test.ts.
 */
describe("InitializationGuard (R3-353)", () => {
  it("honours the boot that follows a host navigation", () => {
    const guard = new InitializationGuard();
    guard.arm(); // the constructor's setLocationURLIntoIFrame
    expect(guard.consume()).toBe(true);
  });

  it("REFUSES a boot with nothing armed — the self-navigation case", () => {
    // The frame navigated itself; no client navigation preceded this boot.
    const guard = new InitializationGuard();
    expect(guard.consume()).toBe(false);
    expect(guard.isDetached).toBe(true);
  });

  it("REFUSES a SECOND boot after one legitimate navigation", () => {
    // The realistic shape of the attack: boot normally, register, then
    // `location.href = '…'` and post `initialized` again from whatever loads.
    const guard = new InitializationGuard();
    guard.arm();
    expect(guard.consume()).toBe(true);
    expect(guard.consume()).toBe(false);
  });

  it("stays refused forever once detached — a rogue document cannot re-arm it", () => {
    const guard = new InitializationGuard();
    expect(guard.consume()).toBe(false);
    // Everything a rogue frame could do afterwards, including racing a
    // legitimate host navigation.
    guard.arm();
    guard.arm();
    expect(guard.consume()).toBe(false);
    expect(guard.consume()).toBe(false);
    expect(guard.isDetached).toBe(true);
    expect(guard.pending).toBe(0);
  });

  it("counts rather than latches, so navigate–navigate–boot–boot is legitimate", () => {
    // Two host navigations can be in flight (a constructor navigation
    // immediately followed by a `refresh` dispatch). A boolean latch would eat
    // its own credit here and tear down a perfectly good frame.
    const guard = new InitializationGuard();
    guard.arm();
    guard.arm();
    expect(guard.consume()).toBe(true);
    expect(guard.consume()).toBe(true);
    expect(guard.consume()).toBe(false); // …but not a third
  });

  it("honours interleaved navigate/boot pairs indefinitely (refresh loops)", () => {
    const guard = new InitializationGuard();
    for (let i = 0; i < 10; i++) {
      guard.arm();
      expect(guard.consume()).toBe(true);
    }
    expect(guard.isDetached).toBe(false);
  });

  it("starts closed — a boot before any navigation is refused", () => {
    // Defensive: the field initialiser must not start at 1 "because the
    // constructor navigates anyway". The constructor arms it by CALLING
    // setLocationURLIntoIFrame, which is what keeps arm and navigate together.
    expect(new InitializationGuard().pending).toBe(0);
  });

  describe("boot nonces", () => {
    it("honours its own nonce and drops the overtaken ones with it", () => {
      const guard = new InitializationGuard();
      guard.arm();
      const second = guard.arm();
      expect(guard.decide(second)).toBe("accept");
      expect(guard.pending).toBe(0);
    });

    it("ignores an earlier navigation's page while a newer one is armed", () => {
      const guard = new InitializationGuard();
      const first = guard.arm();
      const second = guard.arm();
      guard.decide(second);
      const third = guard.arm();
      expect(guard.decide(first)).toBe("stale");
      expect(guard.decide(third)).toBe("accept");
      expect(guard.isDetached).toBe(false);
    });

    it("recognises a page navigated by the previous client on the same frame", () => {
      const issued = new Set<string>();
      const previous = new InitializationGuard(issued);
      const old = previous.arm();
      const next = new InitializationGuard(issued);
      const own = next.arm();
      expect(next.decide(old)).toBe("stale");
      expect(next.decide(own)).toBe("accept");
    });

    it("REFUSES a nonce it never issued, and a replayed one with nothing armed", () => {
      const forged = new InitializationGuard();
      forged.arm();
      expect(forged.decide("0".repeat(32))).toBe("refuse");
      expect(forged.isDetached).toBe(true);

      const replayed = new InitializationGuard();
      const own = replayed.arm();
      expect(replayed.decide(own)).toBe("accept");
      expect(replayed.decide(own)).toBe("refuse");
    });

    it("REFUSES a non-string nonce", () => {
      const guard = new InitializationGuard();
      guard.arm();
      expect(guard.decide(42)).toBe("refuse");
    });
  });

  describe("boot deadline", () => {
    it("stops counting a navigation whose page never booted", () => {
      const guard = new InitializationGuard();
      const nonce = guard.arm();
      expect(guard.expire(nonce)).toBe(true);
      expect(guard.pending).toBe(0);
      // Already given up on, already booted, or never issued: nothing to report.
      expect(guard.expire(nonce)).toBe(false);
      expect(guard.expire("0".repeat(32))).toBe(false);
      const booted = guard.arm();
      guard.decide(booted);
      expect(guard.expire(booted)).toBe(false);
    });

    it("gives up on the overtaken navigations with it, not on a newer one", () => {
      const guard = new InitializationGuard();
      guard.arm();
      const second = guard.arm();
      const third = guard.arm();
      expect(guard.expire(second)).toBe(true);
      expect(guard.pending).toBe(1);
      expect(guard.decide(third)).toBe("accept");
    });

    it("still honours the page when it boots late, once", () => {
      const guard = new InitializationGuard();
      const nonce = guard.arm();
      guard.expire(nonce);
      expect(guard.decide(nonce)).toBe("accept");
      expect(guard.isDetached).toBe(false);
      expect(guard.decide(nonce)).toBe("refuse");
    });

    it("ignores the late page while a newer navigation is armed, and refuses it after that one booted", () => {
      const guard = new InitializationGuard();
      const slow = guard.arm();
      guard.expire(slow);
      const next = guard.arm();
      expect(guard.decide(slow)).toBe("stale");
      expect(guard.decide(next)).toBe("accept");
      expect(guard.decide(slow)).toBe("refuse");
    });

    it("REFUSES a boot without a nonce and a forged one after the deadline", () => {
      const legacy = new InitializationGuard();
      legacy.expire(legacy.arm());
      expect(legacy.consume()).toBe(false);

      const forged = new InitializationGuard();
      const own = forged.arm();
      forged.expire(own);
      expect(forged.decide("0".repeat(32))).toBe("refuse");
      // Detached for good: the late page gets nothing either.
      expect(forged.decide(own)).toBe("refuse");
    });

    it("does not revive a detached guard", () => {
      const guard = new InitializationGuard();
      guard.consume();
      expect(guard.expire(guard.arm())).toBe(false);
      expect(guard.isDetached).toBe(true);
    });
  });
});

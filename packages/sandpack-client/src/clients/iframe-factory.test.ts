import {
  createSandboxedIframe,
  ensureSandboxed,
  assertOpaqueOrigin,
} from "./iframe-factory";

// Minimal fake element/doc so the test doesn't depend on a DOM environment.
function fakeIframe(initialSandbox?: string) {
  const attrs: Record<string, string> = {};
  if (initialSandbox !== undefined) attrs.sandbox = initialSandbox;
  return {
    _attrs: attrs,
    getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
  } as unknown as HTMLIFrameElement & { _attrs: Record<string, string> };
}
const fakeDoc = { createElement: () => fakeIframe() } as unknown as Document;
const attrsOf = (f: HTMLIFrameElement) =>
  (f as unknown as { _attrs: Record<string, string> })._attrs;

describe("iframe factory — the opaque-origin invariant (G1/T1)", () => {
  it("createSandboxedIframe sets allow-scripts and NOT allow-same-origin", () => {
    const f = createSandboxedIframe(fakeDoc);
    expect(attrsOf(f).sandbox).toContain("allow-scripts");
    expect(attrsOf(f).sandbox).not.toContain("allow-same-origin");
  });

  it("assertOpaqueOrigin THROWS when allow-same-origin is present", () => {
    expect(() =>
      assertOpaqueOrigin(fakeIframe("allow-scripts allow-same-origin")),
    ).toThrow(/allow-same-origin/);
  });

  it("assertOpaqueOrigin passes for an opaque-origin sandbox", () => {
    expect(() =>
      assertOpaqueOrigin(fakeIframe("allow-scripts allow-popups")),
    ).not.toThrow();
  });

  it("ensureSandboxed hardens a bare host-provided iframe", () => {
    const f = fakeIframe();
    ensureSandboxed(f);
    expect(attrsOf(f).sandbox).toContain("allow-scripts");
    expect(attrsOf(f).sandbox).not.toContain("allow-same-origin");
  });

  it("ensureSandboxed REFUSES a passed iframe that already has allow-same-origin", () => {
    expect(() =>
      ensureSandboxed(fakeIframe("allow-scripts allow-same-origin")),
    ).toThrow(/allow-same-origin/);
  });
});

// R3-195 — the §G1a stance tightening. M3 (a stranger's app) emits a hardened
// sandbox + delegated-features set that is a STRICT SUBSET of the baseline; M0–M2
// (and an absent stance) emit the EXACT baseline.
describe("iframe factory — M3 stance containment (§G1a / R3-195)", () => {
  const tokens = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
  const sandboxFor = (stance?: "M0" | "M1" | "M2" | "M3") =>
    attrsOf(createSandboxedIframe(fakeDoc, stance)).sandbox;
  const allowFor = (stance?: "M0" | "M1" | "M2" | "M3") =>
    attrsOf(createSandboxedIframe(fakeDoc, stance)).allow;

  it("M0/M1/M2/absent emit the EXACT baseline sandbox (never tightened)", () => {
    const baseline = sandboxFor(undefined);
    for (const s of ["M0", "M1", "M2"] as const) {
      expect(sandboxFor(s)).toBe(baseline);
      expect(allowFor(s)).toBe(allowFor(undefined));
    }
    // The baseline is the trusted-author set (value 3).
    expect(tokens(baseline)).toEqual(
      tokens(
        "allow-forms allow-modals allow-popups allow-presentation allow-scripts allow-downloads allow-pointer-lock",
      ),
    );
  });

  it("M3 sandbox is a STRICT SUBSET of baseline — removes forms/popups/modals/presentation, keeps scripts", () => {
    const baseline = tokens(sandboxFor(undefined));
    const m3 = tokens(sandboxFor("M3"));
    // subset: every M3 token is in the baseline, and it never adds a flag
    for (const t of m3) expect(baseline.has(t)).toBe(true);
    // strictly smaller (the four bulk-egress flags are gone)
    expect(m3.size).toBeLessThan(baseline.size);
    for (const gone of [
      "allow-forms",
      "allow-popups",
      "allow-modals",
      "allow-presentation",
    ]) {
      expect(m3.has(gone)).toBe(false);
    }
    // the app must still run + its harmless capabilities remain
    for (const kept of [
      "allow-scripts",
      "allow-downloads",
      "allow-pointer-lock",
    ]) {
      expect(m3.has(kept)).toBe(true);
    }
    // the load-bearing invariant is never regressed
    expect(m3.has("allow-same-origin")).toBe(false);
  });

  it("M3 delegates NO features (empty allow) — a subset of baseline (camera/mic/geo/WebRTC withheld)", () => {
    const baselineAllow = tokens(allowFor(undefined).replace(/;/g, " "));
    const m3Allow = tokens(allowFor("M3").replace(/;/g, " "));
    expect(m3Allow.size).toBe(0);
    for (const t of m3Allow) expect(baselineAllow.has(t)).toBe(true); // vacuously subset
    expect(baselineAllow.has("camera")).toBe(true); // baseline delegated it; M3 doesn't
  });

  it("ensureSandboxed applies the M3 flags when it is the one setting the attribute", () => {
    const f = fakeIframe();
    ensureSandboxed(f, "M3");
    expect(tokens(attrsOf(f).sandbox).has("allow-popups")).toBe(false);
    expect(tokens(attrsOf(f).sandbox).has("allow-scripts")).toBe(true);
  });
});

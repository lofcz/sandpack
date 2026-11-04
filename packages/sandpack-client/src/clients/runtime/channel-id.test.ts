/**
 * R3-367 — the channel id hardening (node env: the protocol constructor skips
 * window registration when absent, so 10⁵ draws stay cheap and listener-free).
 */
import { IFrameProtocol } from "./iframe-protocol";

const fakeFrame = (): HTMLIFrameElement =>
  ({
    contentWindow: { postMessage: () => undefined },
  } as unknown as HTMLIFrameElement);

describe("R3-367: the channel id", () => {
  it("is a 16-hex-char (64-bit) crypto-random string", () => {
    const protocol = new IFrameProtocol(fakeFrame(), "*");
    expect(protocol.channelId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("draws do not collide at a scale where Math.random's 1e6 space would", () => {
    // 100k draws from a 2^64 space: collision probability ~2.7e-10. The OLD
    // Math.floor(Math.random()*1e6) space collides ~once per ~1.2k draws at
    // this scale, so uniqueness here is the discriminator between the classes.
    const seen = new Set<string>();
    for (let i = 0; i < 100_000; i++) {
      const protocol = new IFrameProtocol(fakeFrame(), "*");
      expect(seen.has(protocol.channelId)).toBe(false);
      seen.add(protocol.channelId);
    }
  });

  it("draws from crypto.getRandomValues, not Math.random", () => {
    const mathRandom = jest.spyOn(Math, "random");
    const protocol = new IFrameProtocol(fakeFrame(), "*");
    expect(protocol.channelId).toMatch(/^[0-9a-f]{16}$/);
    expect(mathRandom).not.toHaveBeenCalled();
    mathRandom.mockRestore();
  });
});

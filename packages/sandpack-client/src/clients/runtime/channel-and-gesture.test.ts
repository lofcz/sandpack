/**
 * @jest-environment jsdom
 *
 * R3-367 — the jsdom-dependent halves: the evt.source authentication invariant
 * and the getCodeSandboxURL gesture gate.
 */
import { IFrameProtocol } from "./iframe-protocol";
import {
  codeSandboxExportAllowed,
  notifyCodeSandboxExportRefused,
} from "./gestureGate";

describe("R3-367: registration does NOT log the channel id", () => {
  it("an observer no longer gets the correlation key for free (register in jsdom: it reads document.location)", () => {
    const consoleLog = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
    try {
      const frame = {
        contentWindow: { postMessage: () => undefined },
      } as unknown as HTMLIFrameElement;
      const protocol = new IFrameProtocol(frame, "*");
      protocol.register(undefined as unknown as MessagePort, {
        template: "test",
      });
      for (const call of consoleLog.mock.calls) {
        for (const arg of call) {
          expect(String(arg)).not.toContain(protocol.channelId);
        }
      }
      expect(consoleLog.mock.calls.length).toBe(0);
    } finally {
      consoleLog.mockRestore();
    }
  });
});

describe("R3-367: the evt.source invariant (the real authentication)", () => {
  it("a message whose source is NOT the owned frameWindow is ignored, whatever its $id", () => {
    const owned: unknown = { postMessage: () => undefined };
    const protocol = new IFrameProtocol(
      { contentWindow: owned } as unknown as HTMLIFrameElement,
      "*",
    );
    const heard: unknown[] = [];
    protocol.channelListen((m) => heard.push(m));
    // A hostile sibling iframe forges a message carrying the RIGHT channel id.
    window.dispatchEvent(
      new MessageEvent("message", {
        source: { someOtherFrame: true } as unknown as Window,
        data: {
          codesandbox: true,
          type: "forged",
          $id: protocol.channelId,
        },
      }),
    );
    expect(heard).toEqual([]);
  });

  it("a message FROM the owned frame with the right id IS heard (the invariant does not over-block)", () => {
    const owned: unknown = { postMessage: () => undefined };
    const protocol = new IFrameProtocol(
      { contentWindow: owned } as unknown as HTMLIFrameElement,
      "*",
    );
    const heard: unknown[] = [];
    protocol.channelListen((m) => heard.push(m));
    window.dispatchEvent(
      new MessageEvent("message", {
        source: owned as Window,
        data: {
          codesandbox: true,
          type: "legit",
          $id: protocol.channelId,
        },
      }),
    );
    expect(heard.length).toBe(1);
    protocol.cleanup();
  });
});

describe("R3-367: the getCodeSandboxURL gesture gate", () => {
  const setActivation = (active: boolean | undefined): void => {
    Object.defineProperty(window.navigator, "userActivation", {
      configurable: true,
      value: active === undefined ? undefined : { hasBeenActive: active },
    });
  };

  afterEach(() => setActivation(undefined));

  it("refuses when NO user activation exists (app/script-initiated context)", () => {
    setActivation(false);
    expect(codeSandboxExportAllowed()).toBe(false);
    setActivation(undefined);
    expect(codeSandboxExportAllowed()).toBe(false);
  });

  it("allows after user activity (the export button flow — gesture present)", () => {
    setActivation(true);
    expect(codeSandboxExportAllowed()).toBe(true);
  });

  it("a refusal dispatches the observable sandpack-security-violation event", () => {
    const events: CustomEvent[] = [];
    const onViolation = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("sandpack-security-violation", onViolation);
    try {
      notifyCodeSandboxExportRefused();
    } finally {
      window.removeEventListener(
        "sandpack-security-violation",
        onViolation,
      );
    }
    expect(events.length).toBe(1);
    expect(events[0]!.detail).toMatchObject({
      kind: "gesture-gate.getCodeSandboxURL",
    });
  });
});

import type {
  ListenerFunction,
  SandpackMessage,
  UnsubscribeFunction,
} from "../../types";

// R3-367: crypto-random, 64-bit channel id (16 hex chars from 8 random bytes).
// This used to be Math.floor(Math.random()*1e6) — guessable, and the id was
// console.logged at registration. SECURITY INVARIANT (do not weaken): the id is
// a CORRELATION key only — every incoming message is authenticated by the
// `event.source === this.frameWindow` check in eventListener() below, NEVER by
// the id alone. The crypto entropy is defense-in-depth on top of that check.
// `string | number` on the wire stays compatible with ids older
// peers minted as numbers: both sides compare the echoed value they themselves
// sent, so the type never has to agree across versions.
const randomChannelId = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
};

export class IFrameProtocol {
  private frameWindow: Window | null;
  private origin: string;

  // React to messages from any iframe
  private globalListeners: Record<number, ListenerFunction> = {};
  private globalListenersCount = 0;

  // React to messages from the iframe owned by this instance
  public channelListeners: Record<number, ListenerFunction> = {};
  private channelListenersCount = 0;

  // Random id to identify this instance of the client when messages are coming
  // from multiple iframes — crypto-random (see randomChannelId above).
  readonly channelId: string = randomChannelId();

  constructor(iframe: HTMLIFrameElement, _origin: string) {
    this.frameWindow = iframe.contentWindow;
    this.origin = "*"; //origin;
    this.globalListeners = [];
    this.channelListeners = [];

    this.eventListener = this.eventListener.bind(this);

    if (typeof window !== "undefined") {
      window.addEventListener("message", this.eventListener);
    }
  }

  cleanup(): void {
    this.frameWindow = null;
    window.removeEventListener("message", this.eventListener);
    this.globalListeners = {};
    this.channelListeners = {};
    this.globalListenersCount = 0;
    this.channelListenersCount = 0;
  }

  // Sends the channelId and triggers an iframeHandshake promise to resolve,
  // so the iframe can start listening for messages (based on the id).
  // `config` carries the bundler's bootstrap configuration (template/logLevel/
  // recompileDelay) — the bundler watches the shared filesystem itself and no
  // longer receives a `compile` message, so it needs this delivered once here.
  register(
    port?: MessagePort,
    config?: Record<string, unknown>,
    babelPort?: MessagePort,
  ): void {
    if (!this.frameWindow) {
      return;
    }

    // R3-367: no channelId log — the id is not secret-critical, but logging it
    // at registration handed an observer the correlation key for free (the
    // evt.source check below is the actual authentication).

    // Order matters: the bundler reads ports[0] as the fs port and ports[1] as
    // the Babel worker port. `filter` keeps that order as long as the fs port
    // is always present (it is, in normal operation).
    const ports = [port, babelPort].filter(
      (p): p is MessagePort => p != null,
    );

    this.frameWindow.postMessage(
      {
        type: "register-frame",
        origin: document.location.origin,
        id: this.channelId,
        ...config,
      },
      this.origin,
      ports,
    );
  }

  // Messages are dispatched from the client directly to the instance iframe
  dispatch(message: SandpackMessage): void {
    if (!this.frameWindow) {
      return;
    }

    // `_transfer` (e.g. a MessagePort for a mount's filesystem) must be passed
    // as the postMessage transfer list, not as a serialized payload field.
    const { _transfer, ...payload } = message;

    this.frameWindow.postMessage(
      {
        $id: this.channelId,
        codesandbox: true,
        ...payload,
      },
      this.origin,
      _transfer ?? [],
    );
  }

  // Add a listener that is called on any message coming from an iframe in the page
  // This is needed for the `initialize` message which comes without a channelId
  globalListen(listener: ListenerFunction): UnsubscribeFunction {
    if (typeof listener !== "function") {
      return (): void => {
        return;
      };
    }

    const listenerId = this.globalListenersCount;
    this.globalListeners[listenerId] = listener;
    this.globalListenersCount++;
    return (): void => {
      delete this.globalListeners[listenerId];
    };
  }

  // Add a listener that is called on any message coming from an iframe with the instance channelId
  // All other messages (eg: from other iframes) are ignored
  channelListen(listener: ListenerFunction): UnsubscribeFunction {
    if (typeof listener !== "function") {
      return (): void => {
        return;
      };
    }

    const listenerId = this.channelListenersCount;
    this.channelListeners[listenerId] = listener;
    this.channelListenersCount++;
    return (): void => {
      delete this.channelListeners[listenerId];
    };
  }

  // Handles message windows coming from iframes
  private eventListener(evt: MessageEvent): void {
    // SECURITY INVARIANT (R3-367, twin of the randomChannelId comment): this
    // source check — not the channelId — is what authenticates an incoming
    // message. The id below only routes a message ALREADY accepted here to the
    // owning instance. Weakening or reordering this check would let any iframe
    // on the page speak on the bundler channel.
    if (evt.source !== this.frameWindow) {
      return;
    }

    const message = evt.data;
    if (!message || !message.codesandbox) {
      return;
    }

    Object.values(this.globalListeners).forEach((listener) =>
      listener(message),
    );

    if (message.$id !== this.channelId) {
      return;
    }

    Object.values(this.channelListeners).forEach((listener) =>
      listener(message),
    );
  }
}

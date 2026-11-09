/** @jest-environment jsdom */
import type { SandpackFS } from "../../fs/SandpackFS";
import { SandpackRuntime } from "./index";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("runtime navigation and registration ownership", () => {
  let client: SandpackRuntime;
  let port: { close: jest.Mock };
  let filesystem: {
    connectRemote: jest.Mock;
    exists: jest.Mock;
    readFile: jest.Mock;
    list: jest.Mock;
    dispose: jest.Mock;
  };
  let frameWindow: { postMessage: jest.Mock };
  let navigate: jest.Mock;
  let onUnexpectedNavigation: jest.Mock;
  let warnings: jest.SpyInstance;
  let errors: jest.SpyInstance;
  let workers: { postMessage: jest.Mock; terminate: jest.Mock }[];
  const originalWorker = globalThis.Worker;
  const originalMessageChannel = globalThis.MessageChannel;

  beforeEach(() => {
    workers = [];
    globalThis.Worker = jest.fn().mockImplementation(() => {
      const worker = { postMessage: jest.fn(), terminate: jest.fn() };
      workers.push(worker);
      return worker;
    });
    globalThis.MessageChannel = jest.fn().mockImplementation(() => ({
      port1: { close: jest.fn() }, port2: { close: jest.fn() },
    }));
    warnings = jest.spyOn(console, "warn").mockImplementation(() => {});
    errors = jest.spyOn(console, "error").mockImplementation(() => {});
    port = { close: jest.fn() };
    filesystem = {
      connectRemote: jest.fn().mockResolvedValue(port),
      exists: jest.fn().mockResolvedValue(true),
      readFile: jest.fn().mockResolvedValue(
        JSON.stringify({
          dependencies: { react: "19.1.0", shared: "1.0.0" },
          main: "index.js",
        }),
      ),
      list: jest.fn().mockResolvedValue(["/package.json", "/index.js"]),
      dispose: jest.fn(),
    };
    // A real browsing context retains its WindowProxy across navigations.
    // jsdom replaces it, so model that browser contract explicitly here.
    frameWindow = { postMessage: jest.fn() };
    navigate = jest.fn();
    const attributes = new Map<string, string>();
    const frame = {
      contentWindow: frameWindow,
      set src(url: string) {
        navigate(url);
      },
      setAttribute: (key: string, value: string) =>
        attributes.set(key, value),
      getAttribute: (key: string) => attributes.get(key) ?? null,
    } as unknown as HTMLIFrameElement;
    onUnexpectedNavigation = jest.fn();
    client = new SandpackRuntime(
      frame,
      {
        fs: filesystem as unknown as SandpackFS,
        template: "vanilla",
        entry: "/host-entry.js",
        dependencies: { shared: "2.0.0", "html-to-image": "1.11.13" },
      },
      {
        bundlerURL: "https://host.example/sandpack/",
        babelWorkerURL: "/babel-worker.js",
        startRoute: "preview",
        sandpackCdnRoot: "https://host.example/sandpack-cdn/",
        immutableUrlPrefixes: [
          "https://host.example/sandpack-cdn/package/",
        ],
        onUnexpectedNavigation,
      },
    );
  });

  afterEach(() => {
    client.destroy();
    warnings.mockRestore();
    errors.mockRestore();
    globalThis.Worker = originalWorker;
    globalThis.MessageChannel = originalMessageChannel;
  });

  const send = (
    data: Record<string, unknown>,
    source: unknown = frameWindow,
  ) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        source: source as Window,
        data: {
          codesandbox: true,
          $id: client.iframeProtocol.channelId,
          ...data,
        },
      }),
    );
  };
  const registrations = () =>
    frameWindow.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "register-frame");

  it("warms one compiler per host navigation and only connects it after authorized boot", async () => {
    expect(workers).toHaveLength(1);
    expect(workers[0].postMessage).not.toHaveBeenCalled();
    send({ type: "initialized" });
    await flush();
    expect(workers).toHaveLength(1);
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1);
    client.dispatch({ type: "refresh" });
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(workers).toHaveLength(2);
    expect(workers[1].postMessage).not.toHaveBeenCalled();
    client.destroy();
    expect(workers[1].terminate).toHaveBeenCalledTimes(1);
  });

  it("boots with the host CDN and dependency overlays intact", async () => {
    expect(navigate.mock.calls).toEqual([
      ["https://host.example/sandpack/preview"],
    ]);
    send({ type: "initialized" });
    await flush();
    expect(registrations()).toHaveLength(1);
    expect(registrations()[0]).toMatchObject({
      hostControlledRefresh: true,
      id: expect.stringMatching(/^[0-9a-f]{16}$/),
      sandpackCdnRoot: "https://host.example/sandpack-cdn/",
      packageJSON: {
        dependencies: {
          react: "19.1.0",
          shared: "2.0.0",
          "html-to-image": "1.11.13",
        },
        main: "/host-entry.js",
      },
    });
  });

  it("requests a host navigation, accepts its next boot, and refuses an extra boot", async () => {
    send({ type: "initialized" });
    await flush();
    send({ type: "request-refresh", url: "https://untrusted.example/" });
    send({ type: "request-refresh" });
    send({ type: "request-refresh" });
    expect(navigate.mock.calls).toEqual([
      ["https://host.example/sandpack/preview"],
      ["https://host.example/sandpack/preview"],
    ]);
    expect(
      frameWindow.postMessage.mock.calls.some(
        ([m]) => m.type === "refresh",
      ),
    ).toBe(false);
    send({ type: "initialized" });
    await flush();
    expect(registrations()).toHaveLength(2);
    send({ type: "initialized" });
    send({ type: "initialized" });
    expect(filesystem.connectRemote).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith("about:blank");
    expect(onUnexpectedNavigation).toHaveBeenCalledTimes(1);
    client.dispatch({ type: "refresh" });
    expect(navigate).toHaveBeenLastCalledWith("about:blank");
    expect(filesystem.dispose).not.toHaveBeenCalled(); // the host owns it
  });

  it("does not authorize a boot from a reloading status or a forged refresh request", async () => {
    send({ type: "initialized" });
    await flush();
    send({ type: "request-refresh" }, {});
    send({ type: "request-refresh", $id: "wrong-channel" });
    send({ type: "status", status: "reloading" });
    expect(client.status).toBe("reloading");
    expect(navigate).toHaveBeenCalledTimes(1);
    send({ type: "initialized" });
    expect(onUnexpectedNavigation).toHaveBeenCalledTimes(1);
    expect(filesystem.connectRemote).toHaveBeenCalledTimes(1);
  });

  it.each(["destroy", "refusal", "refresh"])(
    "closes a pending port after %s",
    async (action) => {
      const pending = deferred<MessagePort>();
      filesystem.connectRemote.mockReturnValueOnce(pending.promise);
      send({ type: "initialized" });
      if (action === "destroy") client.destroy();
      else if (action === "refusal") send({ type: "initialized" });
      else client.dispatch({ type: "refresh" });
      pending.resolve(port as unknown as MessagePort);
      await flush();
      expect(port.close).toHaveBeenCalledTimes(1);
      expect(registrations()).toHaveLength(0);
    },
  );

  it("does not register when navigation changes while the config is being read", async () => {
    const pending = deferred<string>();
    filesystem.readFile.mockReturnValueOnce(pending.promise);
    send({ type: "initialized" });
    await flush();
    client.dispatch({ type: "refresh" });
    pending.resolve("{}");
    await flush();
    expect(port.close).toHaveBeenCalledTimes(1);
    expect(registrations()).toHaveLength(0);
  });

  it.each(["destroy", "refresh"])(
    "does not deliver a pending filesystem reply after %s",
    async (action) => {
      send({ type: "initialized" });
      await flush();
      const pending = deferred<string>();
      filesystem.readFile.mockReturnValueOnce(pending.promise);
      send({
        type: "protocol-fs",
        method: "readFile",
        params: ["/private.ts"],
        msgId: 1,
      });
      if (action === "destroy") client.destroy();
      else client.dispatch({ type: "refresh" });
      pending.resolve("old document's data");
      await flush();
      expect(
        frameWindow.postMessage.mock.calls.some(
          ([message]) => message.type === "protocol-fs",
        ),
      ).toBe(false);
    },
  );

  it("refuses an export before reading files or posting data when activation is absent", async () => {
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: undefined,
    });
    const network = jest.fn();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = network;
    try {
      await expect(client.getCodeSandboxURL()).rejects.toThrow(
        /user activation/,
      );
      expect(filesystem.list).not.toHaveBeenCalled();
      expect(filesystem.readFile).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

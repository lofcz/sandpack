/** @jest-environment jsdom */
import type { SandpackFS } from "../../fs/SandpackFS";
import type { ClientOptions, SandpackMessage } from "../../types";
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
  let workers: {
    postMessage: jest.Mock;
    terminate: jest.Mock;
    onerror?: ((event: Partial<ErrorEvent>) => void) | null;
    onmessageerror?: (() => void) | null;
  }[];
  let mount: (options?: ClientOptions) => SandpackRuntime;
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
    mount = (options = {}) =>
      new SandpackRuntime(
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
          ...options,
        },
      );
    client = mount();
  });

  afterEach(() => {
    jest.useRealTimers();
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
      [expect.stringMatching(/^https:\/\/host\.example\/sandpack\/preview\?sandpack-boot=[0-9a-f]{32}$/)],
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
      [expect.stringMatching(/^https:\/\/host\.example\/sandpack\/preview\?sandpack-boot=/)],
      [expect.stringMatching(/^https:\/\/host\.example\/sandpack\/preview\?sandpack-boot=/)],
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

  const bootOf = (call: number) =>
    new URL(navigate.mock.calls[call][0] as string).searchParams.get("sandpack-boot");

  it("ignores the page of an overtaken navigation and registers the one that replaces it", async () => {
    const first = bootOf(0);
    client.dispatch({ type: "refresh" });
    const second = bootOf(1);
    expect(second).not.toBe(first);
    // The first navigation's page still boots before the second replaces it.
    send({ type: "initialized", boot: first });
    await flush();
    send({ type: "initialized", boot: second });
    await flush();
    expect(onUnexpectedNavigation).not.toHaveBeenCalled();
    expect(registrations()).toHaveLength(2);
    // Nothing is left armed: the bundler's next reload request is honoured.
    send({ type: "request-refresh" });
    expect(navigate).toHaveBeenCalledTimes(3);
  });

  it("a page whose navigation was overtaken boots last is not registered and tears nothing down", async () => {
    const first = bootOf(0);
    client.dispatch({ type: "refresh" });
    const second = bootOf(1);
    client.dispatch({ type: "refresh" });
    send({ type: "initialized", boot: second });
    await flush();
    send({ type: "initialized", boot: first });
    await flush();
    expect(onUnexpectedNavigation).not.toHaveBeenCalled();
    expect(filesystem.connectRemote).toHaveBeenCalledTimes(1);
  });

  it("refuses a boot carrying a nonce it never issued", async () => {
    send({ type: "initialized", boot: "f".repeat(32) });
    await flush();
    expect(onUnexpectedNavigation).toHaveBeenCalledTimes(1);
    expect(filesystem.connectRemote).not.toHaveBeenCalled();
  });

  it("refuses a replayed nonce once nothing is armed", async () => {
    const first = bootOf(0);
    send({ type: "initialized", boot: first });
    await flush();
    send({ type: "initialized", boot: first });
    await flush();
    expect(onUnexpectedNavigation).toHaveBeenCalledTimes(1);
    expect(filesystem.connectRemote).toHaveBeenCalledTimes(1);
  });

  /** The build results a host's listener received, as the fields they carry. */
  const heard = (listener: jest.Mock) =>
    listener.mock.calls
      .map(([message]: [SandpackMessage]) => {
        const { type, action, title, message: text, compilatonError } =
          message as unknown as Record<string, unknown>;
        return { type, action, title, message: text, compilatonError };
      })
      .filter(({ type }) => type === "action" || type === "done");
  const failedBuild = (title: string, message: unknown) => [
    { type: "action", action: "show-error", title, message },
    { type: "done", compilatonError: true },
  ];
  const sentToFrame = (type: string) =>
    frameWindow.postMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === type);

  describe("a Babel worker that fails", () => {
    it("is reported at once to the listeners, as a failed build, and to the bundler", async () => {
      const listener = jest.fn();
      client.listen(listener);
      send({ type: "initialized" });
      await flush();
      // A script that failed to load fires a plain event: no message.
      workers[0].onerror!({});
      expect(heard(listener)).toEqual(
        failedBuild(
          "Babel worker failed",
          "/babel-worker.js: the script could not be loaded or started",
        ),
      );
      expect(client.errors).toHaveLength(1);
      expect(sentToFrame("babel-worker-error")).toEqual([
        expect.objectContaining({
          url: "/babel-worker.js",
          message: "the script could not be loaded or started",
          $id: client.iframeProtocol.channelId,
        }),
      ]);
      // One report per worker, and it is left to finish what it still can.
      expect(workers[0].onerror).toBeNull();
      expect(workers[0].onmessageerror).toBeNull();
      expect(workers[0].terminate).not.toHaveBeenCalled();
    });

    it("names the uncaught error and where it was thrown", async () => {
      const listener = jest.fn();
      client.listen(listener);
      send({ type: "initialized" });
      await flush();
      workers[0].onerror!({
        message: "Uncaught ReferenceError: x is not defined",
        filename: "https://host.example/babel-worker.js",
        lineno: 3,
        colno: 9,
      });
      expect(heard(listener)[0].message).toBe(
        "/babel-worker.js: Uncaught ReferenceError: x is not defined (https://host.example/babel-worker.js:3:9)",
      );
    });

    it("reports a message the worker sent that could not be read", async () => {
      const listener = jest.fn();
      client.listen(listener);
      send({ type: "initialized" });
      await flush();
      workers[0].onmessageerror!();
      expect(heard(listener)).toEqual(
        failedBuild(
          "Babel worker failed",
          "/babel-worker.js: a message from the worker could not be deserialized",
        ),
      );
    });

    it("is replaced without a report while it only warms, and its replacement is reported", async () => {
      const listener = jest.fn();
      client.listen(listener);
      workers[0].onerror!({});
      expect(heard(listener)).toEqual([]);
      expect(workers[0].terminate).toHaveBeenCalledTimes(1);
      send({ type: "initialized" });
      await flush();
      expect(workers).toHaveLength(2);
      expect(workers[1].postMessage).toHaveBeenCalledTimes(1);
      expect(registrations()).toHaveLength(1);
      expect(heard(listener)).toEqual([]);
      workers[1].onerror!({});
      expect(heard(listener)).toHaveLength(2);
    });

    it("is reported when it cannot even be created for the registration", async () => {
      const listener = jest.fn();
      client.listen(listener);
      workers[0].onerror!({});
      (globalThis.Worker as unknown as jest.Mock).mockImplementation(() => {
        throw new Error("worker-src blocks /babel-worker.js");
      });
      send({ type: "initialized" });
      await flush();
      expect(heard(listener)).toEqual(
        failedBuild(
          "Babel worker failed",
          "/babel-worker.js: worker-src blocks /babel-worker.js",
        ),
      );
      expect(registrations()).toHaveLength(0);
    });

    it("says nothing for a worker a newer navigation has replaced", async () => {
      const listener = jest.fn();
      client.listen(listener);
      send({ type: "initialized" });
      await flush();
      const lateError = workers[0].onerror!;
      client.dispatch({ type: "refresh" });
      lateError({});
      expect(heard(listener)).toEqual([]);
      expect(sentToFrame("babel-worker-error")).toHaveLength(0);
    });
  });

  it("terminates the worker warmed for a navigation that is overtaken at once", () => {
    client.dispatch({ type: "refresh" });
    client.dispatch({ type: "refresh" });
    expect(workers).toHaveLength(3);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(workers[1].terminate).toHaveBeenCalledTimes(1);
    expect(workers[2].terminate).not.toHaveBeenCalled();
    client.destroy();
    expect(workers[2].terminate).toHaveBeenCalledTimes(1);
  });

  describe("a bundler page that never boots", () => {
    const PAGE_FAILED = failedBuild(
      "Preview page failed to load",
      "https://host.example/sandpack/preview did not start within 1000 ms of being opened.",
    );
    let listener: jest.Mock;
    /** Replace the client with one whose navigation is timed by fake timers. */
    const remount = (options: ClientOptions = { bootTimeoutMs: 1000 }) => {
      client.destroy();
      jest.useFakeTimers();
      navigate.mockClear();
      client = mount(options);
      listener = jest.fn();
      client.listen(listener);
    };

    it("is reported after the boot deadline, and reload requests are honoured again", () => {
      remount();
      jest.advanceTimersByTime(999);
      expect(heard(listener)).toEqual([]);
      send({ type: "request-refresh" });
      expect(navigate).toHaveBeenCalledTimes(1); // still waiting for that page
      jest.advanceTimersByTime(1);
      expect(heard(listener)).toEqual(PAGE_FAILED);
      expect(client.errors).toHaveLength(1);
      send({ type: "request-refresh" });
      expect(navigate).toHaveBeenCalledTimes(2);
      // The new navigation gets a deadline of its own.
      jest.advanceTimersByTime(1000);
      expect(heard(listener)).toEqual([...PAGE_FAILED, ...PAGE_FAILED]);
    });

    it("is not reported when the page boots in time", async () => {
      remount();
      send({ type: "initialized", boot: bootOf(0) });
      expect(jest.getTimerCount()).toBe(0);
      jest.advanceTimersByTime(60_000);
      expect(heard(listener)).toEqual([]);
    });

    it("times only the latest navigation", () => {
      remount();
      jest.advanceTimersByTime(600);
      client.dispatch({ type: "refresh" });
      jest.advanceTimersByTime(600);
      expect(heard(listener)).toEqual([]);
      jest.advanceTimersByTime(400);
      expect(heard(listener)).toEqual(PAGE_FAILED);
    });

    it("still registers a page that was only slow, instead of tearing it down", async () => {
      remount();
      jest.advanceTimersByTime(1000);
      expect(heard(listener)).toEqual(PAGE_FAILED);
      jest.useRealTimers();
      send({ type: "initialized", boot: bootOf(0) });
      await flush();
      expect(onUnexpectedNavigation).not.toHaveBeenCalled();
      expect(registrations()).toHaveLength(1);
    });

    it("has no deadline when the option turns it off, and none after destroy", () => {
      remount({ bootTimeoutMs: 0 });
      expect(jest.getTimerCount()).toBe(0);
      remount();
      expect(jest.getTimerCount()).toBe(1);
      client.destroy();
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});

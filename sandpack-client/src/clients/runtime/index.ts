import { dequal as deepEqual } from "dequal";

import type { SandpackMessage } from "../..";
import { nullthrows } from "../..";
import { createError } from "../..";
import type { SandpackFS } from "../../fs/SandpackFS";
import type {
  BundlerState,
  ClientOptions,
  FsSnapshot,
  ListenerFunction,
  SandboxSetup,
  SandpackError,
  SdkIntegrity,
  UnsubscribeFunction,
} from "../../types";
import { SandpackLogLevel } from "../../types";
import { extractErrorDetails, createPackageJSON } from "../../utils";
import { SandpackClient } from "../base";
import { createSandboxedIframe, ensureSandboxed } from "../iframe-factory";

import Protocol from "./file-resolver-protocol";
import { IFrameProtocol } from "./iframe-protocol";
import { handleImmutableFetch } from "./immutable-fetch-protocol";
import { EXTENSIONS_MAP } from "./mime";
import type { IPreviewRequestMessage, IPreviewResponseMessage } from "./types";
import { CHANNEL_NAME, type SandpackRuntimeMessage } from "./types";
import { getExtension, getTemplate } from "./utils";

const SUFFIX_PLACEHOLDER = "-{{suffix}}";

const BUNDLER_URL =
  process.env.CODESANDBOX_ENV === "development"
    ? "http://localhost:3000/"
    : `https://${process.env.PACKAGE_VERSION?.replace(
        /\./g,
        "-",
      )}${SUFFIX_PLACEHOLDER}-sandpack.codesandbox.io/`;

export class SandpackRuntime extends SandpackClient {
  fileResolverProtocol?: Protocol;
  immutableFetchProtocol?: Protocol;
  bundlerURL: string;
  bundlerState?: BundlerState;
  errors: SandpackError[];

  selector!: string;
  element: Element;

  unsubscribeGlobalListener: UnsubscribeFunction;
  unsubscribeChannelListener: UnsubscribeFunction;
  unsubscribeFsWatcher?: () => void;
  iframeProtocol: IFrameProtocol;
  fs: SandpackFS;
  /** Parent-owned Babel transpiler worker, connected to the iframe by port. */
  private babelWorker: Worker | null = null;

  constructor(
    selector: string | HTMLIFrameElement,
    sandboxSetup: SandboxSetup,
    options: ClientOptions = {},
  ) {
    super(selector, sandboxSetup, options);

    this.bundlerURL = this.createBundlerURL();

    this.bundlerState = undefined;
    this.errors = [];
    this.status = "initializing";
    this.fs = sandboxSetup.fs;

    if (typeof selector === "string") {
      this.selector = selector;
      const element = document.querySelector(selector);

      nullthrows(element, `The element '${selector}' was not found`);

      this.element = element!;
      // Opaque-origin app iframe via the single factory (G1/T1). No
      // `allow-same-origin`: the iframe runs untrusted code at an opaque origin
      // so it can't read domain-scoped cookies, register service workers, or
      // touch shared storage on the bundler origin. The Babel worker that used
      // to require same-origin is now owned by the parent and reached over a
      // transferred `MessagePort` (see `createBabelWorkerPort`).
      this.iframe = createSandboxedIframe(document, this.options.stance);
      this.initializeElement();
    } else {
      this.element = selector;
      this.iframe = selector;
    }
    // Set-and-assert: a host-provided iframe is hardened here, and any iframe
    // (created or passed) is verified to carry no `allow-same-origin`.
    ensureSandboxed(this.iframe, this.options.stance);

    this.setLocationURLIntoIFrame();

    this.iframeProtocol = new IFrameProtocol(this.iframe, this.bundlerURL);

    this.unsubscribeGlobalListener = this.iframeProtocol.globalListen(
      (mes: SandpackMessage) => {
        if (mes.type !== "initialized" || !this.iframe.contentWindow) {
          return;
        }
        // this may not work with a boundedcontext, it may require an actual FS instance
        const remotePortPromise = this.fs.connectRemote();
        remotePortPromise.then(async (remotePort) => {
          /**
           * Lazy file resolution over the iframe protocol, backed by the
           * {@link SandpackFS} passed on construction. Created before `register`
           * so it's ready for the bundler's lazy file reads as soon as the
           * bundler has the fs port.
           */
          this.fileResolverProtocol = new Protocol(
            "fs",
            async (data) => {
              if (data.method === "isFile") {
                return this.sandboxSetup.fs.exists(data.params[0]);
              } else if (data.method === "readFile") {
                return this.sandboxSetup.fs.readFile(data.params[0]);
              } else {
                throw new Error("Method not supported");
              }
            },
            this.iframeProtocol,
          );

          /**
           * Parent-side fetch + persistent cache for immutable module URLs.
           * The iframe's opaque origin has no storage, so it forwards these
           * here (see immutable-fetch-protocol.ts for the allowlist).
           */
          this.immutableFetchProtocol = new Protocol(
            "immutable-fetch",
            async (data) => {
              if (data.method !== "fetch") {
                throw new Error("Method not supported");
              }
              // params[1] is an optional `sha384-…` integrity the caller pins
              // for this URL (SDK files); the cache verifies against it.
              // Extra prefixes (e.g. Priprava `/sandpack-cdn/package/`) come
              // from ClientOptions.immutableUrlPrefixes.
              return handleImmutableFetch(
                data.params[0],
                data.params[1],
                this.options.immutableUrlPrefixes,
              );
            },
            this.iframeProtocol,
          );

          // The bundler watches the shared filesystem itself and self-triggers
          // its initial build and every rebuild — there is no `compile` message
          // anymore. It only needs the template/logLevel/recompileDelay once,
          // delivered here alongside the transferred fs port.
          const config = await this.computeInitConfig();

          // Spawn the Babel worker on the parent (real origin) and hand the
          // iframe the other end of the channel. Transferred alongside the fs
          // port as the second port in the handshake.
          const babelPort = this.createBabelWorkerPort();
          this.iframeProtocol.register(remotePort, config, babelPort);
        });
      },
    );

    this.unsubscribeChannelListener = this.iframeProtocol.channelListen(
      (mes: SandpackMessage) => {
        switch (mes.type) {
          case "start": {
            this.errors = [];
            break;
          }
          case "status": {
            this.status = mes.status;
            break;
          }
          case "action": {
            if (mes.action === "show-error") {
              this.errors = [...this.errors, extractErrorDetails(mes)];
            }
            break;
          }
          case "done": {
            this.status = "done";
            break;
          }
          case "state": {
            this.bundlerState = mes.state;
            break;
          }
        }
      },
    );

    if (options.experimental_enableServiceWorker) {
      this.serviceWorkerHandshake();
    }
  }

  private createBundlerURL() {
    let bundlerURL = this.options.bundlerURL || BUNDLER_URL;

    // if it's a custom, skip the rest
    if (this.options.bundlerURL) {
      return bundlerURL;
    }

    if (this.options.teamId) {
      bundlerURL =
        bundlerURL.replace("https://", "https://" + this.options.teamId + "-") +
        `?cache=${Date.now()}`;
    }

    if (this.options.experimental_enableServiceWorker) {
      const suffixes: string[] = [];
      suffixes.push(Math.random().toString(36).slice(4));

      bundlerURL = bundlerURL.replace(
        SUFFIX_PLACEHOLDER,
        `-${
          this.options.experimental_stableServiceWorkerId ?? suffixes.join("-")
        }`,
      );
    } else {
      bundlerURL = bundlerURL.replace(SUFFIX_PLACEHOLDER, "");
    }

    return bundlerURL;
  }

  /**
   * Creates (or recreates) the parent-owned Babel transpiler worker and returns
   * the `MessagePort` to transfer into the iframe. The iframe can no longer run
   * its own worker — without `allow-same-origin` it has an opaque origin, and a
   * same-origin worker script won't load there — so transpilation happens in
   * this worker on the parent's real origin. Per-transform traffic then flows
   * iframe<->worker directly over the entangled ports; the parent doesn't relay.
   */
  private createBabelWorkerPort(): MessagePort | undefined {
    const workerURL = this.options.babelWorkerURL;
    if (!workerURL) {
      console.warn(
        "[SandpackRuntime] No `babelWorkerURL` configured — the bundler cannot transpile without a Babel worker.",
      );
      return undefined;
    }

    // A reload re-runs this handshake; terminate the previous worker first so
    // we don't leak one per reload.
    this.babelWorker?.terminate();

    // Classic (not module) worker: the bundled worker lazily loads its Babel
    // plugin/preset chunks via importScripts(), which a `{ type: "module" }`
    // worker forbids. The worker artifact is built with outputFormat "global"
    // to match (see sandpack-bundler's babelWorker Parcel target).
    const worker = new Worker(workerURL);
    this.babelWorker = worker;

    const channel = new MessageChannel();
    // Hand the worker one end; it binds its message bus to this port on receipt.
    worker.postMessage({ type: "connect" }, [channel.port1]);
    return channel.port2;
  }

  private serviceWorkerHandshake() {
    const channel = new MessageChannel();

    const iframeContentWindow = this.iframe.contentWindow;
    if (!iframeContentWindow) {
      throw new Error("Could not get iframe contentWindow");
    }

    const port = channel.port1;
    port.onmessage = (evt: MessageEvent) => {
      if (typeof evt.data === "object" && evt.data.$channel === CHANNEL_NAME) {
        switch (evt.data.$type) {
          case "preview/ready":
            // no op for now
            break;
          case "preview/request":
            this.handleWorkerRequest(evt.data, port);

            break;
        }
      }
    };

    const sendMessage = () => {
      const initMsg = {
        $channel: CHANNEL_NAME,
        $type: "preview/init",
      };

      iframeContentWindow.postMessage(initMsg, "*", [channel.port2]);

      this.iframe.removeEventListener("load", sendMessage);
    };

    this.iframe.addEventListener("load", sendMessage);
  }

  private async handleWorkerRequest(
    request: IPreviewRequestMessage,
    port: MessagePort,
  ) {
    const notFound = () => {
      const responseMessage: IPreviewResponseMessage = {
        $channel: CHANNEL_NAME,
        $type: "preview/response",
        id: request.id,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
        status: 404,
        body: "File not found",
      };

      port.postMessage(responseMessage);
    };
    try {
      const filepath = new URL(request.url, this.bundlerURL).pathname;

      const headers: Record<string, string> = {};

      let body: string | undefined;
      if (await this.sandboxSetup.fs.exists(filepath)) {
        body = await this.sandboxSetup.fs.readFile(filepath);
      } else {
        const modulesFromManager = await this.getTranspiledFiles();
        const match = modulesFromManager.find((item) =>
          item.path.endsWith(filepath),
        );
        if (match) {
          body = match.code;
        }
      }

      if (body === undefined) {
        notFound();
        return;
      }

      if (!headers["Content-Type"]) {
        const extension = getExtension(filepath);
        const foundMimetype = EXTENSIONS_MAP.get(extension);
        if (foundMimetype) {
          headers["Content-Type"] = foundMimetype;
        }
      }

      const responseMessage: IPreviewResponseMessage = {
        $channel: CHANNEL_NAME,
        $type: "preview/response",
        id: request.id,
        headers,
        status: 200,
        body,
      };

      port.postMessage(responseMessage);
    } catch (err) {
      console.error(err);
      notFound();
    }
  }

  public setLocationURLIntoIFrame(): void {
    const urlSource = this.options.startRoute
      ? new URL(this.options.startRoute, this.bundlerURL).toString()
      : this.bundlerURL;

    this.iframe.contentWindow?.location.replace(urlSource);
    this.iframe.src = urlSource;
  }

  destroy(): void {
    this.unsubscribeChannelListener();
    this.unsubscribeGlobalListener();
    this.unsubscribeFsWatcher?.();
    this.fileResolverProtocol?.dispose();
    this.immutableFetchProtocol?.dispose();
    this.babelWorker?.terminate();
    this.iframeProtocol.cleanup();
  }

  updateOptions(options: ClientOptions): void {
    if (!deepEqual(this.options, options)) {
      this.options = options;
      this.updateSandbox();
    }
  }

  /**
   * Updates the local sandbox state. The bundler watches the shared filesystem
   * itself, so there is nothing to push to the iframe here — a file mutation
   * triggers a rebuild on the bundler side without a `compile` message. A
   * template/environment change is handled by re-registering the client (see
   * `useClient`'s `watchFileChanges` effect), which re-runs `computeInitConfig`.
   */
  updateSandbox(sandboxSetup = this.sandboxSetup): void {
    this.sandboxSetup = {
      ...this.sandboxSetup,
      ...sandboxSetup,
    };
  }

  /**
   * Computes the bundler's bootstrap config. Delivered once via the
   * `register-frame` handshake (see the `initialized` handler) instead of a
   * `compile` message, since the bundler now self-watches the filesystem.
   */
  private async computeInitConfig(): Promise<{
    template?: string;
    logLevel: SandpackLogLevel;
    sdkIntegrity?: SdkIntegrity;
    dirtyPaths?: string[];
    distrustArtifacts?: boolean;
    fsSnapshot?: FsSnapshot;
    region?: string;
    packageJSON?: Record<string, unknown>;
  }> {
    const fs = this.sandboxSetup.fs;

    // BOOT_SCAFFOLDING_SPEC §3 — the resolved package.json is delivered to the
    // bundler OUT-OF-BAND in this config (`packageJSON` below), so we no longer
    // write a synthesized copy into the shared filesystem. (The old
    // `addPackageJSONIfNeeded(fs, …)` write is what put `package.json` into the
    // CoW writable layer and forced the rewrite-loop guard.)
    //
    // Prefer the repo's FS package.json when present, but always merge the
    // handshake `dependencies`/`devDependencies` on top — hosts inject
    // platform-only packages (e.g. html-to-image for a preview bus) via setup
    // without rewriting the user-facing manifest that landed in the FS.
    const setupPackageJSON = JSON.parse(
      createPackageJSON(
        this.sandboxSetup.dependencies,
        this.sandboxSetup.devDependencies,
        this.sandboxSetup.entry,
      ),
    ) as Record<string, unknown>;
    let packageJSON: Record<string, unknown> = setupPackageJSON;
    try {
      if (await fs.exists("/package.json")) {
        const fsPackageJSON = JSON.parse(
          await fs.readFile("/package.json"),
        ) as Record<string, unknown>;
        packageJSON = {
          ...setupPackageJSON,
          ...fsPackageJSON,
          dependencies: {
            ...((fsPackageJSON.dependencies as Record<string, string>) ?? {}),
            ...((setupPackageJSON.dependencies as Record<string, string>) ?? {}),
          },
          devDependencies: {
            ...((fsPackageJSON.devDependencies as Record<string, string>) ?? {}),
            ...((setupPackageJSON.devDependencies as Record<string, string>) ??
              {}),
          },
          // Prefer the handshake entry (devtools wrapper) when the host set one.
          main: setupPackageJSON.main ?? fsPackageJSON.main,
        };
      }
    } catch (e) {
      console.error(
        createError(
          "could not parse package.json file: " + (e as Error).message,
        ),
      );
    }

    // getTemplate only reads Object.keys(modules) to match on file paths, so
    // a file-name -> true map is all it needs.
    const fileNames = await fs.list();
    const fileNameMap = Object.fromEntries(
      fileNames.map((p) => [p, true] as const),
    );

    return {
      template:
        this.sandboxSetup.template || getTemplate(packageJSON, fileNameMap),
      logLevel: this.options.logLevel ?? SandpackLogLevel.Info,
      // Host-pinned SDK integrity hashes (SDK_PACKAGING_SPEC §5.2), forwarded
      // verbatim into register-frame for the bundler to verify against. The host
      // sets it via client options; absent → the bundler skips verification.
      sdkIntegrity: this.options.sdkIntegrity,
      // The §5.2 dirty set, forwarded verbatim into register-frame so the bundler
      // skips seeding artifacts for paths edited in a previous session. Absent ⇒
      // nothing dirty.
      dirtyPaths: this.options.dirtyPaths,
      // The §5.7 per-commit distrust mark, forwarded verbatim into register-frame so
      // the bundler ignores the zip's artifact section when a prior session caught a
      // tampered artifact for this commit. Absent/false ⇒ artifacts trusted.
      distrustArtifacts: this.options.distrustArtifacts,
      // R3-49b batch-hydration snapshot, forwarded verbatim into register-frame so
      // the bundler hydrates its read caches before the first compile. Absent ⇒
      // reads cross the Port as before.
      fsSnapshot: this.options.fsSnapshot,
      // The chrome region this frame occupies (R3-114), forwarded verbatim into
      // register-frame so the bundler surfaces it on the runtime global for the
      // SDK's getRegion(). Absent ⇒ the app reads no region.
      region: this.options.region,
      // BOOT_SCAFFOLDING_SPEC §3 — the resolved root package.json, forwarded
      // out-of-band so the bundler reads it from config instead of the FS and no
      // synthesized `package.json` is written into the CoW writable layer. This
      // is the same object `getTemplate` consumes above (the repo's file when
      // present, else the setup-derived default).
      packageJSON,
    };
  }

  /**
   * Relays the set of changed file paths to the bundler so it can re-bundle.
   * The bundler can't observe parent-side writes to the shared filesystem on
   * its own: zenfs's `Port` backend doesn't forward watch events across the
   * iframe boundary. This lightweight signal replaces the old per-change
   * `compile` message — it carries only paths, not template/options/config.
   */
  public notifyFilesChanged(paths: string[]): void {
    if (!paths.length) {
      return;
    }
    this.dispatch({ type: "fs-change", paths });
  }

  public dispatch(message: SandpackRuntimeMessage): void {
    /**
     * Intercept "refresh" dispatch: this will make sure
     * that the iframe is still in the location it's supposed to be.
     * External links inside the iframe will change the location and
     * prevent the user from navigating back.
     */
    if (message.type === "refresh") {
      this.setLocationURLIntoIFrame();

      if (this.options.experimental_enableServiceWorker) {
        this.serviceWorkerHandshake();
      }
    }

    this.iframeProtocol.dispatch(message);
  }

  public listen(listener: ListenerFunction): UnsubscribeFunction {
    return this.iframeProtocol.channelListen(listener);
  }

  /**
   * Get the URL of the contents of the current sandbox
   */
  public async getCodeSandboxURL(): Promise<{
    sandboxId: string;
    editorUrl: string;
    embedUrl: string;
  }> {
    const snapshot = await snapshotFS(this.sandboxSetup.fs);

    const paramFiles = Object.keys(snapshot).reduce(
      (prev, next) => ({
        ...prev,
        [next.replace("/", "")]: {
          content: snapshot[next],
          isBinary: false,
        },
      }),
      {},
    );

    const res = await fetch(
      "https://codesandbox.io/api/v1/sandboxes/define?json=1",
      {
        method: "POST",
        body: JSON.stringify({ files: paramFiles }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      },
    );

    const { sandbox_id: sandboxId } = (await res.json()) as {
      sandbox_id: string;
    };
    return {
      sandboxId,
      editorUrl: `https://codesandbox.io/s/${sandboxId}`,
      embedUrl: `https://codesandbox.io/embed/${sandboxId}`,
    };
  }

  public getTranspilerContext = (): Promise<
    Record<string, Record<string, unknown>>
  > =>
    new Promise((resolve) => {
      const unsubscribe = this.listen((message) => {
        if (message.type === "transpiler-context") {
          resolve(message.data);

          unsubscribe();
        }
      });

      this.dispatch({ type: "get-transpiler-context" });
    });

  public getTranspiledFiles = (): Promise<
    Array<{ path: string; code: string }>
  > => {
    return new Promise((resolve) => {
      const unsubscribe = this.listen((message) => {
        if (message.type === "all-modules") {
          resolve(message.data);

          unsubscribe();
        }
      });

      this.dispatch({ type: "get-modules" });
    });
  };

  private initializeElement(): void {
    this.iframe.style.border = "0";
    this.iframe.style.width = this.options.width || "100%";
    this.iframe.style.height = this.options.height || "100%";
    this.iframe.style.overflow = "hidden";

    nullthrows(
      this.element.parentNode,
      "The given iframe does not have a parent.",
    );

    this.element.parentNode!.replaceChild(this.iframe, this.element);
  }
}

/**
 * Read every tracked file from the filesystem into a plain `{ path: code }`
 * snapshot. Used wherever the bundler protocol still expects a flat module
 * map (the iframe `compile` payload, Open-in-CodeSandbox, etc.).
 */
async function snapshotFS(fs: SandpackFS): Promise<Record<string, string>> {
  const paths = await fs.list();
  const out: Record<string, string> = {};
  await Promise.all(
    paths.map(async (path) => {
      out[path] = await fs.readFile(path);
    }),
  );
  return out;
}

/* eslint-disable @typescript-eslint/ban-ts-comment */
// DEAD-CANDIDATE(2026-06): inherited upstream — the static-HTML client (no transpilation)
// is not used by immediately.run's live-bundled flow. Not in the site-main import closure.
// See DEPRECATION_CANDIDATES.md. Flag-only, do NOT remove: clients/index.ts dispatches to it
// and no-raw-app-iframe.test.ts asserts this file is present in its scan path.
import type { FileContent } from "static-browser-server";
import { PreviewController } from "static-browser-server";

import type {
  ClientOptions,
  ListenerFunction,
  SandboxSetup,
  UnsubscribeFunction,
} from "../..";
// get the bundled file, which contains all dependencies
// @ts-ignore
import consoleHook from "../../inject-scripts/dist/consoleHook.js";
import { SandpackClient } from "../base";
import { EventEmitter } from "../event-emitter";
import { createSandboxedIframe, ensureSandboxed } from "../iframe-factory";
import { generateRandomId } from "../node/client.utils";
import type { SandpackNodeMessage } from "../node/types";

import { insertHtmlAfterRegex, readBuffer, validateHtml } from "./utils";

/**
 * Options accepted by `PreviewController` once zenfs-native serving lands.
 * The bundled `static-browser-server` types still describe the older
 * `getFileContent`-based API, so we type-assert the constructor args against
 * this local shape.
 */
interface ZenFSPreviewControllerOptions {
  baseUrl: string;
  transformResponse?: (args: {
    filepath: string;
    content: FileContent;
  }) => string;
}

export class SandpackStatic extends SandpackClient {
  private emitter: EventEmitter;
  private previewController: PreviewController;

  public iframe!: HTMLIFrameElement;
  public selector!: string;
  public element: Element;

  constructor(
    selector: string | HTMLIFrameElement,
    sandboxSetup: SandboxSetup,
    options: ClientOptions = {},
  ) {
    super(selector, sandboxSetup, options);

    this.status = "initializing";

    this.emitter = new EventEmitter();
    const previewOptions: ZenFSPreviewControllerOptions = {
      baseUrl:
        options.bundlerURL ??
        "https://preview.sandpack-static-server.codesandbox.io",
      transformResponse: ({ filepath, content }): string => {
        if (!filepath.endsWith(".html") && !filepath.endsWith(".htm")) {
          return readBuffer(content);
        }
        try {
          let out: FileContent = validateHtml(content);
          out = this.injectProtocolScript(out);
          out = this.injectExternalResources(out, options.externalResources);
          out = this.injectScriptIntoHead(out, {
            script: consoleHook,
            scope: { channelId: generateRandomId() },
          });
          return readBuffer(out);
        } catch (err) {
          console.error("Runtime injection failed", err);
          return readBuffer(content);
        }
      },
    };
    this.previewController = new PreviewController(
      previewOptions as unknown as ConstructorParameters<
        typeof PreviewController
      >[0],
    );

    if (typeof selector === "string") {
      this.selector = selector;
      const element = document.querySelector(selector);

      this.element = element!;
      // Opaque-origin app iframe via the single factory (G1/T1) — untrusted
      // preview content runs at an opaque origin (see the runtime client).
      this.iframe = createSandboxedIframe(document, this.options.stance);
    } else {
      this.element = selector;
      this.iframe = selector;
    }
    // Set-and-assert: harden a host-provided iframe; verify no allow-same-origin.
    ensureSandboxed(this.iframe, this.options.stance);

    this.eventListener = this.eventListener.bind(this);
    if (typeof window !== "undefined") {
      window.addEventListener("message", this.eventListener);
    }

    // Dispatch very first compile action
    this.updateSandbox();
  }

  private injectContentIntoHead(
    content: FileContent,
    contentToInsert: string,
  ): FileContent {
    // Make it a string
    content = readBuffer(content);

    // Inject script
    content =
      insertHtmlAfterRegex(/<head[^<>]*>/g, content, "\n" + contentToInsert) ??
      contentToInsert + "\n" + content;

    return content;
  }

  private injectProtocolScript(content: FileContent): FileContent {
    const scriptToInsert = `<script>
  window.addEventListener("message", (message) => {
    if(message.data.type === "refresh") {
      window.location.reload();
    }
  })
</script>`;

    return this.injectContentIntoHead(content, scriptToInsert);
  }

  private injectExternalResources(
    content: FileContent,
    externalResources: ClientOptions["externalResources"] = [],
  ): FileContent {
    const tagsToInsert = externalResources
      .map((resource) => {
        const match = resource.match(/\.([^.]*)$/);
        const fileType = match?.[1];

        if (fileType === "css" || resource.includes("fonts.googleapis")) {
          return `<link rel="stylesheet" href="${resource}">`;
        }

        if (fileType === "js") {
          return `<script src="${resource}"></script>`;
        }

        throw new Error(
          `Unable to determine file type for external resource: ${resource}`,
        );
      })
      .join("\n");

    return this.injectContentIntoHead(content, tagsToInsert);
  }

  private injectScriptIntoHead(
    content: FileContent,
    opts: {
      script: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scope?: { channelId: string } & Record<string, any>;
    },
  ): FileContent {
    const { script, scope = {} } = opts;
    const scriptToInsert = `
    <script>
      const scope = ${JSON.stringify(scope)};
      ${script}
    </script>
    `.trim();

    return this.injectContentIntoHead(content, scriptToInsert);
  }

  public updateSandbox(
    setup = this.sandboxSetup,
    _isInitializationCompile?: boolean,
  ): void {
    this.sandboxSetup = { ...this.sandboxSetup, ...setup };
    void this.updateSandboxAsync(setup);
  }

  private async updateSandboxAsync(setup: SandboxSetup): Promise<void> {
    // File content is served straight from zenfs by the static preview
    // runtime, so the compile message no longer needs to carry files.
    this.dispatch({
      codesandbox: true,
      template: setup.template,
      type: "compile",
    });
  }

  private async compile(): Promise<void> {
    const previewUrl = await this.previewController.initPreview();
    this.iframe.setAttribute("src", previewUrl);

    this.status = "done";
    this.dispatch({ type: "done", compilatonError: false });
    this.dispatch({
      type: "urlchange",
      url: previewUrl,
      back: false,
      forward: false,
    });
  }

  // Handles message windows coming from iframes
  private eventListener(evt: MessageEvent): void {
    // skip events originating from different iframes
    if (evt.source !== this.iframe.contentWindow) {
      return;
    }

    const message = evt.data;
    if (!message.codesandbox) {
      return;
    }

    this.dispatch(message);
  }

  /**
   * Bundler communication
   */
  public dispatch(message: SandpackNodeMessage): void {
    switch (message.type) {
      case "compile":
        this.compile();
        break;

      default:
        this.iframe.contentWindow?.postMessage(message, "*");
        this.emitter.dispatch(message);
    }
  }

  public listen(listener: ListenerFunction): UnsubscribeFunction {
    return this.emitter.listener(listener);
  }

  public destroy(): void {
    this.emitter.cleanup();
    if (typeof window !== "undefined") {
      window.removeEventListener("message", this.eventListener);
    }
  }
}

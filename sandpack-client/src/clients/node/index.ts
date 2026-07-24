// DEAD-CANDIDATE(2026-06): inherited upstream — the Nodebox remote-VM client targets a
// different execution model (immediately.run uses the in-browser bundler). Not in the
// site-main import closure; G1/T1-exempt. See DEPRECATION_CANDIDATES.md. Flag-only, do
// not remove (referenced by clients/index.ts dispatch + the G1/T1 test's exempt set).
import { PREVIEW_LOADED_MESSAGE_TYPE, Nodebox } from "@codesandbox/nodebox";
import type { ShellProcess, FSWatchEvent } from "@codesandbox/nodebox";
import type { ShellCommandOptions } from "@codesandbox/nodebox/build/modules/shell";

import type {
  ClientOptions,
  ListenerFunction,
  SandboxSetup,
  UnsubscribeFunction,
} from "../..";
import { nullthrows } from "../..";
import { createError } from "../..";
import { SandpackClient } from "../base";
import { EventEmitter } from "../event-emitter";

import {
  findStartScriptPackageJson,
  getMessageFromError,
  generateRandomId,
} from "./client.utils";
import { loadPreviewIframe, setPreviewIframeProperties } from "./iframe.utils";
import { injectScriptToIframe } from "./inject-scripts";
import type { SandpackNodeMessage } from "./types";

export class SandpackNode extends SandpackClient {
  // General
  private emitter: EventEmitter;

  // Nodebox
  private emulatorIframe!: HTMLIFrameElement;
  private emulator!: Nodebox;
  private emulatorShellProcess: ShellProcess | undefined;
  private emulatorCommand: [string, string[], ShellCommandOptions] | undefined;
  private iframePreviewUrl: string | undefined;
  private messageChannelId = generateRandomId();

  // Public
  public iframe!: HTMLIFrameElement;

  private _initPromise: Promise<void> | null = null;

  constructor(
    selector: string | HTMLIFrameElement,
    sandboxInfo: SandboxSetup,
    options: ClientOptions = {},
  ) {
    super(selector, sandboxInfo, {
      ...options,
      bundlerURL: options.bundlerURL,
    });

    this.emitter = new EventEmitter();

    // Assign iframes
    this.manageIframes(selector);

    // Init emulator
    this.emulator = new Nodebox({
      iframe: this.emulatorIframe,
      runtimeUrl: this.options.bundlerURL,
    });

    // Trigger initial compile
    this.updateSandbox(sandboxInfo);
  }

  // Initialize nodebox, should only ever be called once
  private async _init(): Promise<void> {
    await this.emulator.connect();

    await this.globalListeners();
  }

  /**
   * It initializes the emulator and provide it with files, template and script to run
   */
  private async compile(): Promise<void> {
    try {
      // 1. Init
      this.status = "initializing";
      this.dispatch({ type: "start", firstLoad: true });
      if (!this._initPromise) {
        this._initPromise = this._init();
      }
      await this._initPromise;

      this.dispatch({ type: "connected" });

      // 3. Create, run task and assign preview
      const { id: shellId } = await this.createShellProcessFromTask();

      // 4. Launch Preview
      await this.createPreviewURLFromId(shellId);
      await this.setLocationURLIntoIFrame();

      // 5. Returns to consumer
      this.dispatchDoneMessage();
    } catch (err) {
      this.dispatch({
        type: "action",
        action: "notification",
        notificationType: "error",
        title: getMessageFromError(err as Error),
      });

      this.dispatch({ type: "done", compilatonError: true });
    }
  }

  /**
   * It creates a new shell and run the starting task
   */
  private async createShellProcessFromTask(): Promise<{ id: string }> {
    const packageJsonContent =
      await this.sandboxSetup.fs.readFile("/package.json");

    this.emulatorCommand = findStartScriptPackageJson(packageJsonContent);
    this.emulatorShellProcess = this.emulator.shell.create();

    // Shell listeners
    await this.emulatorShellProcess.on("exit", (exitCode) => {
      this.dispatch({
        type: "action",
        action: "notification",
        notificationType: "error",
        title: createError(`Error: process.exit(${exitCode}) called.`),
      });
    });

    await this.emulatorShellProcess.on("progress", (data) => {
      if (
        data.state === "command_running" ||
        data.state === "starting_command"
      ) {
        this.dispatch({
          type: "shell/progress",
          data: {
            ...data,
            command: [
              this.emulatorCommand?.[0],
              this.emulatorCommand?.[1].join(" "),
            ].join(" "),
          },
        });

        this.status = "installing-dependencies";

        return;
      }

      this.dispatch({ type: "shell/progress", data });
    });

    this.emulatorShellProcess.stdout.on("data", (data) => {
      this.dispatch({ type: "stdout", payload: { data, type: "out" } });
    });

    this.emulatorShellProcess.stderr.on("data", (data) => {
      this.dispatch({ type: "stdout", payload: { data, type: "err" } });
    });

    return await this.emulatorShellProcess.runCommand(...this.emulatorCommand);
  }

  private async createPreviewURLFromId(id: string): Promise<void> {
    this.iframePreviewUrl = undefined;

    const { url } = await this.emulator.preview.getByShellId(id);

    this.iframePreviewUrl = url + (this.options.startRoute ?? "");
  }

  /**
   * Nodebox needs to handle two types of iframes at the same time:
   *
   * 1. Runtime iframe: where the emulator process runs, which is responsible
   *    for creating the other iframes (hidden);
   * 2. Preview iframes: any other node process that contains a PORT (public);
   */
  private manageIframes(selector: string | HTMLIFrameElement): void {
    /**
     * Pick the preview iframe
     */
    if (typeof selector === "string") {
      const element = document.querySelector(selector);

      nullthrows(element, `The element '${selector}' was not found`);

      this.iframe = document.createElement("iframe");
      element?.appendChild(this.iframe);
    } else {
      this.iframe = selector;
    }

    // Set preview iframe styles
    setPreviewIframeProperties(this.iframe, this.options);

    nullthrows(
      this.iframe.parentNode,
      `The given iframe does not have a parent.`,
    );

    /**
     * Create the runtime iframe, which is hidden sibling
     * from the preview one
     */
    this.emulatorIframe = document.createElement("iframe");
    this.emulatorIframe.classList.add("sp-bridge-frame");
    this.iframe.parentNode?.appendChild(this.emulatorIframe);
  }

  private async setLocationURLIntoIFrame(): Promise<void> {
    if (this.iframePreviewUrl) {
      await loadPreviewIframe(this.iframe, this.iframePreviewUrl);
    }
  }

  /**
   * Send all messages and events to tell to the
   * consumer that the bundler is ready without any error
   */
  private dispatchDoneMessage(): void {
    this.status = "done";
    this.dispatch({ type: "done", compilatonError: false });

    if (this.iframePreviewUrl) {
      this.dispatch({
        type: "urlchange",
        url: this.iframePreviewUrl,
        back: false,
        forward: false,
      });
    }
  }

  private async globalListeners(): Promise<void> {
    window.addEventListener("message", (event) => {
      if (event.data.type === PREVIEW_LOADED_MESSAGE_TYPE) {
        injectScriptToIframe(this.iframe, this.messageChannelId);
      }

      if (
        event.data.type === "urlchange" &&
        event.data.channelId === this.messageChannelId
      ) {
        this.dispatch({
          type: "urlchange",
          url: event.data.url,
          back: event.data.back,
          forward: event.data.forward,
        });
      } else if (event.data.channelId === this.messageChannelId) {
        this.dispatch(event.data);
      }
    });

    await this.emulator.fs.watch(
      ["*"],
      [
        ".next",
        "node_modules",
        "build",
        "dist",
        "vendor",
        ".config",
        ".vuepress",
      ],

      async (message) => {
        if (!message) return;

        const event = message as FSWatchEvent;

        const path =
          "newPath" in event
            ? event.newPath
            : "path" in event
              ? event.path
              : "";
        const { type } = await this.emulator.fs.stat(path);
        if (type !== "file") return null;

        try {
          switch (event.type) {
            case "change":
            case "create": {
              const content = await this.emulator.fs.readFile(
                event.path,
                "utf8",
              );
              this.dispatch({
                type: "fs/change",
                path: event.path,
                content: content,
              });

              break;
            }
            case "remove":
              this.dispatch({
                type: "fs/remove",
                path: event.path,
              });

              break;

            case "rename": {
              this.dispatch({
                type: "fs/remove",
                path: event.oldPath,
              });

              const newContent = await this.emulator.fs.readFile(
                event.newPath,
                "utf8",
              );
              this.dispatch({
                type: "fs/change",
                path: event.newPath,
                content: newContent,
              });

              break;
            }

            case "close":
              break;
          }
        } catch (err) {
          this.dispatch({
            type: "action",
            action: "notification",
            notificationType: "error",
            title: getMessageFromError(err as Error),
          });
        }
      },
    );
  }

  /**
   * PUBLIC Methods
   */
  public async restartShellProcess(): Promise<void> {
    if (this.emulatorShellProcess && this.emulatorCommand) {
      // 1. Set the loading state and clean the URL
      this.dispatch({ type: "start", firstLoad: true });
      this.status = "initializing";

      // 2. Exit shell
      await this.emulatorShellProcess.kill();
      this.iframe?.removeAttribute("attr");

      this.emulator.fs.rm("/node_modules/.vite", {
        recursive: true,
        force: true,
      });

      // 3 Run command again
      await this.compile();
    }
  }

  public updateSandbox(setup: SandboxSetup): void {
    this.sandboxSetup = { ...this.sandboxSetup, ...setup };
    void this.updateSandboxAsync(setup);
  }

  private async updateSandboxAsync(setup: SandboxSetup): Promise<void> {
    // With native zenfs support in the Nodebox runtime, file content reaches
    // the emulator through the shared filesystem rather than the compile
    // message. Skip re-dispatching once the shell is already running.
    if (this.emulatorShellProcess?.state === "running") {
      return;
    }

    this.dispatch({
      codesandbox: true,
      template: setup.template,
      type: "compile",
    });
  }

  public async dispatch(message: SandpackNodeMessage): Promise<void> {
    switch (message.type) {
      case "compile":
        this.compile();
        break;

      case "refresh":
        await this.setLocationURLIntoIFrame();
        break;

      case "urlback":
      case "urlforward":
        this.iframe?.contentWindow?.postMessage(message, "*");
        break;

      case "shell/restart":
        this.restartShellProcess();
        break;

      case "shell/openPreview":
        window.open(this.iframePreviewUrl, "_blank");
        break;

      default:
        this.emitter.dispatch(message);
    }
  }

  public listen(listener: ListenerFunction): UnsubscribeFunction {
    return this.emitter.listener(listener);
  }

  public destroy(): void {
    this.emulatorIframe.remove();
    this.emitter.cleanup();
  }
}

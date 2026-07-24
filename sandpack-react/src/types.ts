/* eslint-disable @typescript-eslint/no-explicit-any */

import type { LanguageSupport } from "@codemirror/language";
import type {
  BundlerState,
  FileMetaMap,
  ListenerFunction,
  NpmRegistry,
  ReactDevToolsMode,
  SandpackClient,
  SandpackError,
  SandpackFS,
  SandpackMessage,
  SdkIntegrity,
  FsSnapshot,
  UnsubscribeFunction,
  SandpackLogLevel,
} from "@lofcz/sandpack-client";
import type React from "react";

import type { ClientPropsOverride } from "./contexts/utils/useClient";
import type { SANDBOX_TEMPLATES } from "./templates";

import type { CodeEditorProps } from ".";
import type { BoundContext } from "@zenfs/core";

/**
 * ------------------------ Public documentation ------------------------
 *
 * From this section on, all types are artificially created and maintained
 * for public documentation purposes. So, this might not reflect precisely
 * the component behavior, but it still needs to be reliable and clear for
 * general usage.
 */

export interface SandpackExportOptions {
  /**
   * Workspace API key from codesandbox.io/t/permissions.
   * When set, the sandbox will be created inside the given workspace id.
   */
  apiToken: string;

  /**
   * The default visibility of the new sandboxes inside the workspace.
   *
   * @note Use `private` if there is a private registry or private NPM
   * configured in your workspace.
   */
  privacy: "private" | "public";
}

export interface SandpackProps {
  /**
   * The fully-initialized filesystem to use as the source of truth.
   * Create one with {@link createSandpackFS}.
   */
  fs: SandpackFS;

  /**
   * The theme specifies the color set of the components, syntax highlight,
   * and typography. Use this prop in order to match the design aspect of your website.
   *
   * Set as `auto` to turn it color scheme sensitive
   */
  theme?: SandpackThemeProp;

  /**
   * Pass custom properties to customize the interface and the behavior
   * of the sandbox, such as initialization mode, recompile mode, etc.
   */
  options?: SandpackOptions;

  /**
   * CodeSandbox team id: with this information, bundler can connect to CodeSandbox
   * and unlock a few capabilities, like private dependencies.
   */
  teamId?: string;

  /**
   * Options for exporting the sandbox to CodeSandbox.
   */
  exportOptions?: SandpackExportOptions;

  /**
   * Custom npm registry configuration.
   */
  npmRegistries?: NpmRegistry[];
}

/**
 * @category Setup
 */
export interface SandpackOptions {
  /**
   * List of files that will be visible for the user interacts with.
   * It defaults to the non-hidden files from the filesystem.
   */
  visibleFiles?: string[];

  /**
   * Use this to set a file as active by default in the editor component.
   * It defaults to the first visible file.
   */
  activeFile?: string;

  editorWidthPercentage?: number;
  editorHeight?: React.CSSProperties["height"];
  classes?: Record<string, string>;

  /**
   * right to left layout
   * @default false
   */
  rtl?: boolean;
  showNavigator?: boolean;
  showLineNumbers?: boolean;
  showInlineErrors?: boolean;
  showRefreshButton?: boolean;
  showTabs?: boolean;
  showConsoleButton?: boolean;
  showConsole?: boolean;
  closableTabs?: boolean;
  wrapContent?: boolean;
  resizablePanels?: boolean;
  codeEditor?: SandpackCodeOptions;
  /**
   * This disables editing of content by the user in all files.
   */
  readOnly?: boolean;

  /**
   * Controls the visibility of Read-only label, which will only
   * appears when `readOnly` is `true`
   */
  showReadOnly?: boolean;

  layout?: "preview" | "tests" | "console";

  /**
   * This provides a way to control how some components are going to
   * be initialized on the page. The CodeEditor and the Preview components
   * are quite expensive and might overload the memory usage, so this gives
   * a certain control of when to initialize them.
   */
  initMode?: SandpackInitMode;
  initModeObserverOptions?: IntersectionObserverInit;
  /**
   * Determines whether or not the bundling process should start automatically.
   */
  autorun?: boolean;
  /**
   * Determines whether or not the component should automatically reload when
   * changes are made to the code.
   */
  autoReload?: boolean;
  recompileMode?: "immediate" | "delayed";
  recompileDelay?: number;

  /**
   * By default, Sandpack generates a random value to use as an id.
   * Use this to override this value if you need predictable values.
   */
  id?: string;
  logLevel?: SandpackLogLevel;
  bundlerURL?: string;
  babelWorkerURL?: string;
  startRoute?: string;
  skipEval?: boolean;
  externalResources?: string[];
}

/**
 * @category Setup
 */
export interface SandpackSetup {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  entry?: string;
  environment?: SandboxEnvironment;
  npmRegistries?: NpmRegistry[];
  exportOptions?: SandpackExportOptions;
}

/**
 * @category Setup
 */
export type SandboxEnvironment =
  | "angular-cli"
  | "create-react-app"
  | "create-react-app-typescript"
  | "svelte"
  | "parcel"
  | "vue-cli"
  | "static"
  | "solid"
  | "node";

/**
 * @category Setup
 */
export type SandpackPredefinedTemplate = keyof typeof SANDBOX_TEMPLATES;

/**
 * @category Setup
 */
export interface SandpackFile {
  code: string;
  hidden?: boolean;
  active?: boolean;
  readOnly?: boolean;
}

export type SandpackFiles = Record<string, string | SandpackFile>;

/**
 * `immediate`: It immediately mounts all components, such as the code-editor
 * and the preview - this option might overload the memory usage
 * and resource from the browser on a page with multiple instances;
 *
 * `lazy`: Only initialize the components when the user is about to scroll
 * them to the viewport and keep these components mounted until the user
 * leaves the page - this is the default value;
 *
 * `user-visible`: Only initialize the components when the user is about
 * to scroll them to the viewport, but differently from lazy, this option
 * unmounts those components once it's no longer in the viewport.
 *
 * @category Setup
 */
export type SandpackInitMode = "immediate" | "lazy" | "user-visible";

/**
 * @category Setup
 */
export interface CustomLanguage {
  name: string;
  extensions: string[];
  language: LanguageSupport;
}

/**
 * @category Theme
 */
export type SandpackPredefinedTheme = "light" | "dark" | "auto";

/**
 * @category Theme
 */
export interface SandpackTheme {
  colors: {
    // Surface
    surface1: string;
    surface2: string;
    surface3: string;
    // UI
    disabled: string;
    base: string;
    clickable: string;
    hover: string;
    // Brand
    accent: string;
    // Feedbacks
    error?: string;
    errorSurface?: string;
    warning?: string;
    warningSurface?: string;
  };
  syntax: {
    plain: string | SandpackSyntaxStyle;
    comment: string | SandpackSyntaxStyle;
    keyword: string | SandpackSyntaxStyle;
    definition: string | SandpackSyntaxStyle;
    punctuation: string | SandpackSyntaxStyle;
    property: string | SandpackSyntaxStyle;
    tag: string | SandpackSyntaxStyle;
    static: string | SandpackSyntaxStyle;
    string?: string | SandpackSyntaxStyle; // use static as fallback
  };
  font: {
    body: string;
    mono: string;
    size: string;
    lineHeight: string;
  };
}

/**
 * @category Theme
 */
interface SandpackSyntaxStyle {
  color?: string;
  fontStyle?: "normal" | "italic";
  fontWeight?:
    | "normal"
    | "bold"
    | "100"
    | "200"
    | "300"
    | "400"
    | "500"
    | "600"
    | "700"
    | "800"
    | "900";
  textDecoration?:
    | "none"
    | "underline"
    | "line-through"
    | "underline line-through";
}

/**
 * @category Theme
 */
export type SandpackThemeProp =
  | SandpackPredefinedTheme
  | DeepPartial<SandpackTheme>;

/**
 *
 * ------------------------ Internal types ---------------------------
 *
 * From this section on, all types are hidden because most of them are
 * strictly related to the internal typing system, and they are not
 * helpful for public documentation.
 *
 * For public purpose use SandpackProps instead.
 */

export interface SandpackInternal {
  (props: SandpackInternalProps): React.ReactElement;
}

export interface SandpackInternalProvider {
  (
    props: React.PropsWithChildren<SandpackProviderProps>,
  ): React.ReactElement<
    SandpackProviderProps,
    React.Provider<SandpackProviderState>
  > | null;
}

interface SandpackRootProps {
  fs: SandpackFS;
  theme?: SandpackThemeProp;
  teamId?: string;
  sandboxId?: string;
  exportOptions?: SandpackExportOptions;
  npmRegistries?: NpmRegistry[];
}

export interface SandpackInternalOptions {
  visibleFiles?: string[];
  activeFile?: string;

  initMode?: SandpackInitMode;
  initModeObserverOptions?: IntersectionObserverInit;
  autorun?: boolean;
  autoReload?: boolean;
  recompileMode?: "immediate" | "delayed";
  recompileDelay?: number;
  id?: string;
  logLevel?: SandpackLogLevel;
  bundlerURL?: string;
  babelWorkerURL?: string;
  bundlerTimeOut?: number;
  startRoute?: string;
  skipEval?: boolean;
  externalResources?: string[];
  classes?: Record<string, string>;
  experimental_enableServiceWorker?: boolean;
  experimental_enableStableServiceWorkerId?: boolean;
  /**
   * Host-pinned SDK artifact integrity hashes (SDK_PACKAGING_SPEC §5.2),
   * forwarded to the runtime client and on to the bundler for verify-before-
   * evaluate. Absent ⇒ verification skipped.
   */
  sdkIntegrity?: SdkIntegrity;
  /**
   * The dirty set (PRETRANSPILED_ARTIFACTS_SPEC §5.2): repo-relative paths in the
   * COW writable layer + the journal's deleted set, forwarded to the runtime
   * client and on to the bundler so seeding skips artifacts for paths edited in a
   * previous session. Absent ⇒ nothing dirty.
   */
  dirtyPaths?: string[];
  /**
   * R3-49b ZenFS batch hydration: a bulk snapshot of the mounted tree, forwarded to
   * the runtime client and on to the bundler, which hydrates its read caches before
   * the first compile so reads come from memory instead of per-file Port round-trips.
   * Absent ⇒ reads cross the Port as before.
   */
  fsSnapshot?: FsSnapshot;
}

interface SandpackInternalProps extends SandpackRootProps {
  options?: SandpackInternalOptions & {
    editorWidthPercentage?: number;
    editorHeight?: React.CSSProperties["height"];

    /**
     * right to left layout
     * @default false
     */
    rtl?: boolean;
    showNavigator?: boolean;
    showLineNumbers?: boolean;
    showInlineErrors?: boolean;
    showRefreshButton?: boolean;
    showTabs?: boolean;
    showConsoleButton?: boolean;
    showConsole?: boolean;
    closableTabs?: boolean;
    wrapContent?: boolean;
    resizablePanels?: boolean;
    codeEditor?: SandpackCodeOptions;

    /**
     * This disables editing of content by the user in all files.
     */
    readOnly?: boolean;

    /**
     * Controls the visibility of Read-only label, which will only
     * appears when `readOnly` is `true`
     */
    showReadOnly?: boolean;

    layout?: "preview" | "tests" | "console";
  };
}

export interface SandpackProviderProps
  extends SandpackRootProps, React.HTMLAttributes<HTMLDivElement> {
  options?: SandpackInternalOptions;
  children?: React.ReactNode;
}

export type SandpackClientDispatch = (
  msg: SandpackMessage,
  clientId?: string,
) => void;

export type SandpackClientListen = (
  listener: ListenerFunction,
  clientId?: string,
) => UnsubscribeFunction;

export type SandpackContext = SandpackState & {
  dispatch: SandpackClientDispatch;
  listen: SandpackClientListen;
};

export interface SandpackState {
  bundlerState: BundlerState | undefined;

  /**
   * List the file path listed in the file tab,
   * which will allow the user to interact with.
   */
  visibleFiles: string[];

  /**
   * List the file path listed in the file tab,
   * Can only be changed through the properties of SandpackProvider (fs/options)
   *
   * @internal
   */
  visibleFilesFromProps: string[];

  /**
   * Path to the file will be open in the code editor
   * when the component mounts
   */
  activeFile: string;
  startRoute?: string;

  autoReload: boolean;

  /**
   * Returns the current state of the editor, meaning that any
   * changes from the original `files` must return a `dirty` value;
   * otherwise, it'll return `pristine`
   */
  editorState: EditorState;
  teamId?: string;
  exportOptions?: SandpackExportOptions;
  error: SandpackError | null;
  /**
   * The filesystem backing all files rendered inside Sandpack. Use this for
   * async `readFile`/`writeFile`/`list` access.
   */
  fs: SandpackFS;
  /**
   * Snapshot of every file path known to {@link fs}, updated whenever the
   * filesystem mutates.
   */
  fileList: string[];
  /**
   * Snapshot of the per-file UI metadata (`hidden`, `active`, `readOnly`)
   * stored in the filesystem sidecar, updated whenever metadata changes.
   */
  fileMeta: FileMetaMap;
  environment?: SandboxEnvironment;
  status: SandpackStatus;
  /**
   * True while the async initialization of the filesystem is in flight.
   * Consumers should treat `fileList` and `fileMeta` as not yet
   * available while this is `true`.
   */
  isLoading: boolean;
  initMode: SandpackInitMode;
  clients: Record<string, InstanceType<typeof SandpackClient>>;

  runSandpack: () => Promise<void>;
  registerBundler: (
    iframe: HTMLIFrameElement,
    clientId: string,
    clientPropsOverride?: ClientPropsOverride,
  ) => Promise<void>;
  unregisterBundler: (clientId: string) => void;
  updateFile: (
    path: string,
    code: string,
    shouldUpdatePreview?: boolean,
  ) => Promise<void>;
  addFile: (
    path: string,
    code: string,
    shouldUpdatePreview?: boolean,
  ) => Promise<void>;
  updateCurrentFile: (
    newCode: string,
    shouldUpdatePreview?: boolean,
  ) => Promise<void>;
  openFile: (path: string) => void;
  closeFile: (path: string) => void;
  deleteFile: (path: string, shouldUpdatePreview?: boolean) => Promise<void>;
  setActiveFile: (path: string) => void;
  resetFile: (path: string) => Promise<void>;
  resetAllFiles: () => Promise<void>;
  registerReactDevTools: (value: ReactDevToolsMode) => void;
  /**
   * Element refs
   * Different components inside the SandpackProvider might register certain elements of interest for sandpack
   * eg: lazy anchor - if no component registers this, then the sandpack runs on mount, without lazy mode
   */
  lazyAnchorRef: React.RefObject<HTMLDivElement | null>;

  unsubscribeClientListenersRef: React.MutableRefObject<
    Record<string, Record<string, UnsubscribeFunction>>
  >;
  queuedListenersRef: React.MutableRefObject<
    Record<string, Record<string, ListenerFunction>>
  >;
}

export type SandpackStatus =
  | "initial"
  | "idle"
  | "running"
  | "timeout"
  | "done";

export type EditorState = "pristine" | "dirty";

/**
 * Custom properties to be used in the SandpackCodeEditor component,
 * some of which are exclusive to customize the CodeMirror instance.
 * @hidden
 */
export interface SandpackCodeOptions {
  /**
   * CodeMirror extensions for the editor state, which can
   * provide extra features and functionalities to the editor component.
   */
  extensions?: CodeEditorProps["extensions"];
  /**
   * Property to register CodeMirror extension keymap.
   */
  extensionsKeymap?: CodeEditorProps["extensionsKeymap"];
  /**
   * Provides a way to add custom language modes by supplying a language
   * type, applicable file extensions, and a LanguageSupport instance
   * for that syntax mode
   */
  additionalLanguages?: CodeEditorProps["additionalLanguages"];
}

export type DeepPartial<Type> = {
  [Property in keyof Type]?: DeepPartial<Type[Property]>;
};

export interface SandpackProviderState {
  fs: SandpackFS;
  fileList: string[];
  fileMeta: FileMetaMap;
  environment?: SandboxEnvironment;
  visibleFiles: string[];
  visibleFilesFromProps: string[];
  activeFile: string;
  startRoute?: string;
  initMode: SandpackInitMode;
  bundlerState?: BundlerState;
  error: SandpackError | null;
  sandpackStatus: SandpackStatus;
  editorState: EditorState;
  reactDevTools?: ReactDevToolsMode;
}

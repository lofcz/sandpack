import type { FrameStance } from "./clients/iframe-factory";
import type { SandpackNodeMessage } from "./clients/node/types";
import type { SandpackRuntimeMessage } from "./clients/runtime/types";
import type { SandpackFS } from "./fs/SandpackFS";

/**
 * Host-pinned SDK artifact integrity (SDK_PACKAGING_SPEC §5.2), keyed
 * module → concrete version → `{ relPath: 'sha384-<base64>' }`. The host (the
 * TCB) supplies it; the runtime client forwards it verbatim into the
 * register-frame handshake, and the bundler verifies fetched SDK bytes against
 * it BEFORE evaluation, failing the boot closed on any mismatch. Absent ⇒
 * verification is skipped (the pin is not wired) rather than self-attesting
 * against the origin's own manifest.
 */
export type SdkIntegrity = Record<
  string,
  Record<string, Record<string, string>>
>;

export interface ClientOptions {
  /**
   * Paths to external resources
   */
  externalResources?: string[];
  /**
   * The app's resolved trust stance (TRUST_MODES_SPEC §3 / R3-195). Only `"M3"`
   * (a stranger's app) hardens the emitted iframe (sandbox flags + delegated
   * features); absent or `"M0"`/`"M1"`/`"M2"` keeps the exact baseline. The host
   * resolves this; the client never derives it. The per-frame M3 CSP is delivered
   * with the frame's document (via `bundlerURL`), not here.
   */
  stance?: FrameStance;
  /**
   * Location of the bundler.
   */
  bundlerURL?: string;
  /**
   * URL of the Babel transpiler worker script, served **same-origin with the
   * parent page** (not the bundler origin). The runtime client spawns this
   * worker itself and connects it to the sandboxed iframe over a `MessagePort`,
   * so the iframe no longer needs to load a worker (and can drop
   * `allow-same-origin`). Required for the runtime client to transpile.
   */
  babelWorkerURL?: string;
  /**
   * Extra URL prefixes allowed for the parent-side immutable-fetch proxy
   * (exact-versioned module CDN `/package/` responses). Appended to the
   * built-in allowlist — use this for a self-hosted sandpack-cdn, e.g.
   * `https://<priprava-host>/sandpack-cdn/package/`.
   */
  immutableUrlPrefixes?: string[];
  /**
   * Level of logging to do in the bundler
   */
  logLevel?: SandpackLogLevel;
  /**
   * Relative path that the iframe loads (eg: /about)
   */
  startRoute?: string;
  /**
   * Width of iframe.
   */
  width?: string;
  /**
   * Height of iframe.
   */
  height?: string;
  /**
   * If we should skip the third step: evaluation.
   */
  skipEval?: boolean;

  /**
   * Boolean flags to trigger certain UI elements in the bundler
   */
  showOpenInCodeSandbox?: boolean;
  showErrorScreen?: boolean;
  showLoadingScreen?: boolean;

  /**
   * The bundler will clear the console if you set this to true, everytime the iframe refreshes / starts the first compile
   */
  clearConsoleOnFirstCompile?: boolean;

  reactDevTools?: ReactDevToolsMode;

  /**
   * The custom private npm registry setting makes it possible
   * to retrieve npm packages from your own npm registry.
   */
  customNpmRegistries?: NpmRegistry[];

  /**
   * CodeSandbox sandbox id: used internally by codesandbox
   */
  sandboxId?: string;

  /**
   * CodeSandbox team id: with this information, bundler can connect to CodeSandbox
   * and unlock a few capabilities
   */
  teamId?: string;

  /**
   * Enable the service worker feature for sandpack-bundler
   */
  experimental_enableServiceWorker?: boolean;
  experimental_stableServiceWorkerId?: string;

  /**
   * Host-pinned SDK artifact integrity hashes (SDK_PACKAGING_SPEC §5.2).
   * Forwarded verbatim into the register-frame handshake; the bundler verifies
   * fetched SDK bytes against it before evaluation. Absent ⇒ verification
   * skipped.
   */
  sdkIntegrity?: SdkIntegrity;

  /**
   * The dirty set (PRETRANSPILED_ARTIFACTS_SPEC §5.2): repo-relative paths in the
   * COW writable layer (edited in a previous session) plus the journal's deleted
   * set. Forwarded verbatim into the register-frame handshake so the bundler
   * never seeds a pre-transpiled artifact for a path whose `/app` content no
   * longer matches the zip. Absent ⇒ nothing dirty.
   */
  dirtyPaths?: string[];

  /**
   * The parent's per-commit distrust mark (PRETRANSPILED_ARTIFACTS_SPEC §5.7).
   * When `true`, the host has recorded — keyed `(repo coords, commitSha)` — that a
   * prior session's spot-verification caught a tampered artifact for this commit;
   * forwarded verbatim into the register-frame handshake so the bundler treats the
   * zip's artifact section as absent and transpiles live. Absent/false ⇒ trusted.
   */
  distrustArtifacts?: boolean;

  /**
   * R3-49b ZenFS batch hydration: a bulk snapshot of the mounted tree (`/app`
   * source + bundled `/node_modules` package msgpack) forwarded verbatim into the
   * register-frame handshake. The bundler hydrates its read caches before the first
   * compile so reads come from memory instead of one Port round-trip per file
   * (`loadNodeModules` — ~99% of cold boot). Absent ⇒ reads cross the Port as before.
   */
  fsSnapshot?: FsSnapshot;

  /**
   * The chrome region this app instance occupies, e.g. `"panel.agent"` or
   * `"stage.conversation"` (R3-114). Forwarded verbatim into the register-frame
   * handshake so the bundler can surface it on the `__immediatelyRun__` runtime
   * global for the SDK's `getRegion()`/`useRegion()`. Descriptive only — it grants
   * and gates nothing. Absent ⇒ the app reads no region (`getRegion()` → null).
   */
  region?: string;
}

/** A batch-hydration snapshot entry list: each entry is a sandbox `/app`-rooted path
 *  + its content (text for source, bytes for the bundled package msgpack). R3-49b. */
export type FsSnapshot = Array<{ path: string; content: string | Uint8Array }>;

export interface SandboxSetup {
  /**
   * The Sandpack filesystem used as the source of truth for file contents and
   * UI metadata. Create one via {@link SandpackFS.fromFiles} or
   * {@link SandpackFS.fromFileSystem}.
   */
  fs: SandpackFS;
  dependencies?: Dependencies;
  devDependencies?: Dependencies;
  entry?: string;
  /**
   * What template we use, if not defined we infer the template from the dependencies or files.
   *
   */
  template?: SandpackTemplate;

  /**
   * Only use unpkg for fetching the dependencies, no preprocessing. It's slower, but doesn't talk
   * to AWS.
   */
  disableDependencyPreprocessing?: boolean;
}

export interface Module {
  code: string;
  path: string;
}

export type Modules = Record<
  string,
  {
    code: string;
    path: string;
  }
>;

export type Dependencies = Record<string, string>;

export type ReactDevToolsMode = "latest" | "legacy";

export interface ModuleSource {
  fileName: string;
  compiledCode: string;
  sourceMap: unknown | undefined;
}

export enum SandpackLogLevel {
  None = 0,
  Error = 10,
  Warning = 20,
  Info = 30,
  Debug = 40,
}

export interface ErrorStackFrame {
  columnNumber: number;
  fileName: string;
  functionName: string;
  lineNumber: number;
  _originalColumnNumber: number;
  _originalFileName: string;
  _originalFunctionName: string;
  _originalLineNumber: number;
  _originalScriptCode: Array<{
    lineNumber: number;
    content: string;
    highlight: boolean;
  }>;
}

export interface TranspiledModule {
  module: Module;
  query: string;
  source: ModuleSource | undefined;
  assets: Record<string, ModuleSource>;
  isEntry: boolean;
  isTestFile: boolean;
  childModules: string[];
  /**
   * All extra modules emitted by the loader
   */
  emittedAssets: ModuleSource[];
  initiators: string[];
  dependencies: string[];
  asyncDependencies: string[];
  transpilationDependencies: string[];
  transpilationInitiators: string[];
}

export interface BundlerState {
  entry: string;
  transpiledModules: Record<string, TranspiledModule>;
}

export type SandpackMessage = SandpackRuntimeMessage | SandpackNodeMessage;

export type ListenerFunction = (msg: SandpackMessage) => void;
export type UnsubscribeFunction = () => void;

export type Listen = (
  listener: ListenerFunction,
  clientId?: string,
) => UnsubscribeFunction;
export type Dispatch = (msg: SandpackMessage, clientId?: string) => void;

export interface SandpackError {
  message: string;
  line?: number;
  column?: number;
  path?: string;
  title?: string;
}

export interface SandpackErrorMessage {
  title: string;
  path: string;
  message: string;
  line: number;
  column: number;
  payload: {
    frames?: ErrorStackFrame[];
  };
}

export type ClientStatus =
  | "initializing"
  | "installing-dependencies"
  | "transpiling"
  | "evaluating"
  | "running-tests"
  | "idle"
  | "done"
  /** Bundler is about to `location.reload()` (deps/HTML); not a terminal settle. */
  | "reloading";

export type SandpackMessageConsoleMethods =
  | "log"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "table"
  | "clear"
  | "time"
  | "timeEnd"
  | "count"
  | "assert";

export interface BaseSandpackMessage {
  type: string;
  $id?: number;
  codesandbox?: boolean;
  /**
   * Transferable objects (e.g. a `MessagePort`) to hand to the iframe alongside
   * this message. Stripped from the payload and passed as the `postMessage`
   * transfer list by `IFrameProtocol.dispatch`. Used by `mount-add` to share a
   * mount's filesystem port with the sandbox.
   */
  _transfer?: Transferable[];
}

export interface BaseProtocolMessage {
  type: string;
  msgId: string;
}

export interface ProtocolErrorMessage extends BaseProtocolMessage {
  error: {
    message: string;
  };
}

export interface ProtocolResultMessage extends BaseProtocolMessage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
}

export interface ProtocolRequestMessage extends BaseProtocolMessage {
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any[];
}

export interface NpmRegistry {
  enabledScopes: string[];
  limitToScopes: boolean;
  registryUrl: string;
  /**
   * It must be `false` if you're providing a sef-host solution,
   * otherwise, it'll try to proxy from CodeSandbox Proxy
   */
  proxyEnabled: boolean;
  registryAuthToken?: string;
}

type TestStatus = "running" | "pass" | "fail";

export type TestError = Error & {
  matcherResult?: boolean;
  mappedErrors?: Array<{
    fileName: string;
    _originalFunctionName: string;
    _originalColumnNumber: number;
    _originalLineNumber: number;
    _originalScriptCode: Array<{
      lineNumber: number;
      content: string;
      highlight: boolean;
    }> | null;
  }>;
};

export interface Test {
  name: string;
  blocks: string[];
  status: TestStatus;
  path: string;
  errors: TestError[];
  duration?: number | undefined;
}

export type SandboxTestMessage =
  | RunAllTests
  | RunTests
  | ClearJestErrors
  | ({ type: "test" } & (
      | InitializedTestsMessage
      | TestCountMessage
      | TotalTestStartMessage
      | TotalTestEndMessage
      | AddFileMessage
      | RemoveFileMessage
      | FileErrorMessage
      | DescribeStartMessage
      | DescribeEndMessage
      | AddTestMessage
      | TestStartMessage
      | TestEndMessage
    ));

interface InitializedTestsMessage {
  event: "initialize_tests";
}

interface ClearJestErrors {
  type: "action";
  action: "clear-errors";
  source: "jest";
  path: string;
}

interface TestCountMessage {
  event: "test_count";
  count: number;
}

interface TotalTestStartMessage {
  event: "total_test_start";
}

interface TotalTestEndMessage {
  event: "total_test_end";
}

interface AddFileMessage {
  event: "add_file";
  path: string;
}

interface RemoveFileMessage {
  event: "remove_file";
  path: string;
}

interface FileErrorMessage {
  event: "file_error";
  path: string;
  error: TestError;
}

interface DescribeStartMessage {
  event: "describe_start";
  blockName: string;
}

interface DescribeEndMessage {
  event: "describe_end";
}

interface AddTestMessage {
  event: "add_test";
  testName: string;
  path: string;
}

interface TestStartMessage {
  event: "test_start";
  test: Test;
}

interface TestEndMessage {
  event: "test_end";
  test: Test;
}

interface RunAllTests {
  type: "run-all-tests";
}

interface RunTests {
  type: "run-tests";
  path: string;
}

export type SandpackTemplate =
  | "angular-cli"
  | "create-react-app"
  | "create-react-app-typescript"
  | "svelte"
  | "parcel"
  | "vue-cli"
  | "static"
  | "solid"
  | "nextjs"
  | "node";

import {
  InMemory,
  resolveMountConfig,
  mount,
  umount,
  type BoundContext,
  bindContext,
} from "@zenfs/core";

/**
 * Per-file UI metadata. The file *content* lives in the filesystem as bytes;
 * everything else (visibility, editability, initial focus) is kept in a sidecar
 * file at {@link META_PATH}.
 */
export interface FileMeta {
  hidden?: boolean;
  active?: boolean;
  readOnly?: boolean;
}

export type FileMetaMap = Record<string, FileMeta>;

/** Shape of the sidecar JSON stored at {@link META_PATH}. */
interface MetaSidecar {
  files: FileMetaMap;
  environment?: string;
  mode?: string;
}

/**
 * Path (within the SandpackFS) of the sidecar metadata file. Anything below
 * `/.sandpack/` is treated as internal and excluded from {@link SandpackFS.list}.
 */
export const META_PATH = "/.sandpack/meta.json";
const META_DIR = "/.sandpack";

/**
 * Dev-only flag, using the standard `process.env.NODE_ENV` convention. This dist is
 * always consumed by a bundler (site-main, the sandbox) that statically replaces
 * `process.env.NODE_ENV`, so in a production build this folds to `false` and the
 * `if (IS_DEV)` branch — with the whole {@link installOutOfBandGuard} function it is
 * the only reference to — is dead-code-eliminated (verified with terser: the
 * assertion string is absent once `NODE_ENV="production"`). The bare form (no
 * `typeof` guard) is what lets it fold to a literal; a `typeof process` guard would
 * defeat the elimination.
 */
const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * The ZenFS `fs.promises` methods that mutate the store. In dev these are wrapped
 * (see {@link installOutOfBandGuard}) so a write that reaches this instance's
 * bound-context fs **without** going through `SandpackFS.writeFile` is caught.
 * Reads (`readFile`/`readdir`/`stat`) are never guarded.
 */
const GUARDED_WRITE_METHODS = [
  "writeFile",
  "unlink",
  "mkdir",
  "rename",
  "appendFile",
  "truncate",
  "rm",
  "rmdir",
] as const;

const OUT_OF_BAND_GUARD_KEY = Symbol.for(
  "@immediately-run/sandpack-client:out-of-band-guard",
);

const PRISTINE_WRITE_METHODS_KEY = Symbol.for(
  "@immediately-run/sandpack-client:pristine-write-methods",
);

type WriteMethod = (...args: unknown[]) => unknown;
type PromisesRecord = Record<string | symbol, unknown>;

interface PristineMethods {
  writeFile?: WriteMethod;
  unlink?: WriteMethod;
  mkdir?: WriteMethod;
  [method: string]: WriteMethod | undefined;
}

interface PristineStore {
  receiver: PromisesRecord;
  methods: PristineMethods;
}

interface RawMethods {
  writeFile: (path: string, data: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  mkdir: (
    path: string,
    opts?: { recursive?: boolean },
  ) => Promise<unknown>;
}

const asWriteMethod = (value: unknown): WriteMethod | undefined =>
  typeof value === "function" ? (value as WriteMethod) : undefined;

const isSidecarPath = (path: unknown): boolean =>
  path === META_DIR || path === META_PATH;

const faceAddsWritePolicy = (
  face: PromisesRecord,
  current: PromisesRecord,
): boolean =>
  face.writeFile !== current.writeFile ||
  face.unlink !== current.unlink ||
  face.mkdir !== current.mkdir;

// site-main's `src/filesystem/roEditorContext.ts` returns a fresh write-wrapper
// closure on every `fs.promises` access; that instability distinguishes a policy
// face from a raw ZenFS face when no pristine stash exists yet.
const isLikelyPolicyFace = (face: PromisesRecord): boolean =>
  face.writeFile !== face.writeFile ||
  face.unlink !== face.unlink ||
  face.mkdir !== face.mkdir;

function installOutOfBandGuard(
  face: PromisesRecord,
  pristine: PristineStore,
): void {
  for (const method of GUARDED_WRITE_METHODS) {
    const original = pristine.methods[method];
    if (typeof original !== "function") continue;
    face[method] = (...args: unknown[]) => {
      console.error(
        `[SandpackFS] out-of-band write: '${method}(${String(
          args[0],
        )})' bypassed SandpackFS.writeFile()/handleRemoteChange(), so it emits ` +
          `no onChange — the editor view and bundler relay will miss it. Route the ` +
          `write through SandpackFS (EDITOR_AS_APP_SPEC D-EDIT-1 writer invariant; ` +
          `LOCAL_DEVELOPMENT_SPEC §6.5).`,
      );
      return original.apply(pristine.receiver, args);
    };
  }
  face[OUT_OF_BAND_GUARD_KEY] = true;
}

const capturePristine = (face: PromisesRecord): PristineStore => {
  const methods: PristineMethods = {};
  for (const method of GUARDED_WRITE_METHODS) {
    const original = asWriteMethod(face[method]);
    if (original) methods[method] = original;
  }

  const pristine: PristineStore = { receiver: face, methods };
  face[PRISTINE_WRITE_METHODS_KEY] = pristine;
  return pristine;
};

const captureRaw = (
  face: PromisesRecord,
  pristine: PristineStore,
): RawMethods => {
  const policy = faceAddsWritePolicy(face, pristine.receiver);
  const faceWriteFile = asWriteMethod(face.writeFile);
  const faceUnlink = asWriteMethod(face.unlink);
  const faceMkdir = asWriteMethod(face.mkdir);

  const call = (
    faceMethod: WriteMethod | undefined,
    pristineMethod: WriteMethod | undefined,
    path: unknown,
    args: unknown[],
  ): Promise<unknown> => {
    if (policy && !isSidecarPath(path) && faceMethod) {
      return faceMethod.apply(face, args) as Promise<unknown>;
    }

    const method = (pristineMethod ?? faceMethod) as WriteMethod;
    return method.apply(pristine.receiver, args) as Promise<unknown>;
  };

  return {
    writeFile: (path, data) =>
      call(faceWriteFile, pristine.methods.writeFile, path, [
        path,
        data,
      ]) as Promise<void>,
    unlink: (path) =>
      call(faceUnlink, pristine.methods.unlink, path, [
        path,
      ]) as Promise<void>,
    mkdir: (path, opts) =>
      call(faceMkdir, pristine.methods.mkdir, path, [
        path,
        opts,
      ]) as Promise<unknown>,
  };
};

const capturePolicyRaw = (face: PromisesRecord): RawMethods => {
  const faceWriteFile = face.writeFile as RawMethods["writeFile"];
  const faceUnlink = face.unlink as RawMethods["unlink"];
  const faceMkdir = face.mkdir as RawMethods["mkdir"];

  return {
    writeFile: (path, data) => faceWriteFile.call(face, path, data),
    unlink: (path) => faceUnlink.call(face, path),
    mkdir: (path, opts) => faceMkdir.call(face, path, opts),
  };
};

function ensureGuard(fsContext: BoundContext): RawMethods {
  const face = fsContext.fs.promises as unknown as PromisesRecord &
    RawMethods;
  const existing = face[PRISTINE_WRITE_METHODS_KEY] as
    | PristineStore
    | undefined;

  if (!existing && isLikelyPolicyFace(face)) {
    return capturePolicyRaw(face);
  }

  const pristine = existing ?? capturePristine(face);
  const raw = captureRaw(face, pristine);
  if (IS_DEV && !face[OUT_OF_BAND_GUARD_KEY]) {
    installOutOfBandGuard(face, pristine);
  }
  return raw;
}

/**
 * A filesystem change. `external` is `true` when the change originated from the
 * child iframe (relayed through the ZenFS `Port` / `attachFS` boundary) and
 * `false` for local edits made through this `SandpackFS`. The editor reacts
 * only to `external` changes — that origin tag is what prevents the editor from
 * reacting to its own writes.
 */
export interface SandpackFSChange {
  path: string;
  external: boolean;
}

export type SandpackFSListener = (change: SandpackFSChange) => void;

/**
 * Shape Sandpack accepts at the public boundary. Each entry carries the
 * file body (`code`) and any optional {@link FileMeta} flags. The more
 * permissive `string | {...}` form used in user-facing React props is
 * normalized to this object shape before being handed to
 * {@link SandpackFS.fromFiles}.
 */
export type SandpackFilesInput = Record<
  string,
  FileMeta & { code: string }
>;

let mountCounter = 0;

const normalize = (path: string): string =>
  path.startsWith("/") ? path : `/${path}`;

/**
 * A filesystem-shaped handle over the files Sandpack renders. It wraps a
 * ZenFS @see FileSystem mounted at a unique path prefix so multiple
 * `SandpackProvider` instances stay isolated.
 *
 * All reads / writes are async. Changes emit a single coalesced notification
 * (watcher or explicit helper calls) so React can subscribe via
 * `useSyncExternalStore`.
 *
 * ## Writer invariant (why every mutation must funnel through here)
 *
 * The ZenFS `Port` backend does **not** forward watch events across the iframe
 * boundary, so **every** independent mutator of the shared store MUST route through
 * {@link SandpackFS.writeFile} (local edits → `external: false`) or
 * {@link SandpackFS.handleRemoteChange} (iframe edits relayed by the host's
 * `exportZenFS` → `external: true`). A write that reaches this instance's
 * bound-context fs by any other path emits no `onChange`, so the editor view and
 * the bundler relay silently miss it. This is the conflict-model writer invariant
 * spec'd in **`EDITOR_AS_APP_SPEC.md` → Decisions & rejected alternatives D-EDIT-1**
 * ("Conflict-model note (writer invariant)") and **`LOCAL_DEVELOPMENT_SPEC.md` §6.5**.
 * In dev, {@link installOutOfBandGuard} turns that convention into a loud
 * assertion (roadmap R3-110); in production the guard is compiled out.
 */
export class SandpackFS {
  private readonly listeners = new Set<SandpackFSListener>();
  private metaCache: FileMetaMap = {};
  private sidecarEnvironment: string | undefined = undefined;
  private sidecarMode: string | undefined = undefined;
  private disposed = false;
  /** The ZenFS mount point this instance created and is therefore allowed to
   *  unmount in {@link dispose}. Unset for an adopted context, whose lifecycle
   *  belongs to the caller. */
  private ownedMountPoint: string | undefined = undefined;

  // Pristine fs write methods captured before the dev guard wraps the shared
  // `fsContext.fs.promises` target and stashed once per target under
  // {@link PRISTINE_WRITE_METHODS_KEY} (see {@link ensureGuard}). SandpackFS's own
  // writes go through these so they never trip the dev out-of-band guard, including
  // when later adoptions reach the same target through fresh Proxy faces. When an
  // adopting face adds its own write policy, source writes keep that face's policy
  // and only the exact `/.sandpack` sidecar writes use the pristine methods. Reads
  // keep using `fsContext.fs.promises` directly.
  private readonly rawWriteFile: (
    path: string,
    data: string,
  ) => Promise<void>;
  private readonly rawUnlink: (path: string) => Promise<void>;
  private readonly rawMkdir: (
    path: string,
    opts?: { recursive?: boolean },
  ) => Promise<unknown>;

  private constructor(
    public readonly fsContext: BoundContext,
    public readonly remotePortFactory: (
      onRemoteChange: (path: string) => void,
    ) => Promise<MessagePort>,
    // Invoked after a LOCAL editor write (writeFile) lands in the backing fs,
    // with the normalized repo-relative path. The host uses it to record overlay
    // provenance (COW_OVERLAY_PROVENANCE_SPEC §5 — the writer declares intent);
    // iframe writes go through `remotePortFactory`/`handleRemoteChange` instead.
    private readonly onWrite?: (path: string) => void,
  ) {
    const raw = ensureGuard(fsContext);
    this.rawWriteFile = raw.writeFile;
    this.rawUnlink = raw.unlink;
    this.rawMkdir = raw.mkdir;
  }

  /**
   * Create the `MessagePort` shared with the child iframe, wiring the iframe's
   * write notifications back into this instance. The host's factory forwards
   * `onRemoteChange` to `exportZenFS`, which calls it whenever the iframe writes
   * a file over the Port — surfaced here as an `external` change.
   */
  connectRemote(): Promise<MessagePort> {
    return this.remotePortFactory((path) => this.handleRemoteChange(path));
  }

  /**
   * Create a new filesystem backed by an InMemory store and seed it with the
   * given files.
   */
  static async fromFiles(
    files: SandpackFilesInput = {},
    options: { environment?: string; mode?: string } = {},
    remotePortFactory: (
      onRemoteChange: (path: string) => void,
    ) => Promise<MessagePort>,
    onWrite?: (path: string) => void,
  ): Promise<SandpackFS> {
    const id = ++mountCounter;
    const prefix = `/__sandpack_${id}`;

    const backend = await resolveMountConfig({ backend: InMemory });
    mount(prefix, backend);
    const ctxt = bindContext({ root: prefix });

    const instance = new SandpackFS(ctxt, remotePortFactory, onWrite);
    // We created the mount, so we own it: `dispose()` may unmount it. An adopted
    // context (`fromFileSystemContext`) leaves this unset and is never unmounted.
    instance.ownedMountPoint = prefix;
    if (options.environment !== undefined) {
      instance.sidecarEnvironment = options.environment;
    }
    if (options.mode !== undefined) {
      instance.sidecarMode = options.mode;
    }
    await instance.writeInitial(files);

    return instance;
  }

  /**
   * Adopt an existing ZenFS filesystem. The caller is responsible for its
   * lifecycle; {@link dispose} leaves the adopted mount and store intact.
   */
  static async fromFileSystemContext(
    fsContext: BoundContext,
    remotePortFactory: (
      onRemoteChange: (path: string) => void,
    ) => Promise<MessagePort>,
    onWrite?: (path: string) => void,
  ): Promise<SandpackFS> {
    const instance = new SandpackFS(fsContext, remotePortFactory, onWrite);
    await instance.ensureMetaDir();
    await instance.refreshMetaCache();

    return instance;
  }

  // ------------------------------------------------------------------
  // Core file ops
  // ------------------------------------------------------------------

  /**
   * Return every visible file path (leading `/`). Metadata sidecar and
   * everything under `/.sandpack/` is excluded.
   */
  async list(): Promise<string[]> {
    const paths: string[] = [];
    await this.walk("/", paths);
    paths.sort();
    return paths;
  }

  async readFile(path: string): Promise<string> {
    return (await this.fsContext.fs.promises.readFile(
      this.toAbs(path),
      "utf8",
    )) as string;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const abs = this.toAbs(path);
    await this.ensureParent(abs);
    await this.rawWriteFile(abs, content);
    const normalized = normalize(path);
    this.notify({ path: normalized, external: false });
    // A local editor write — declare it to the host's provenance recorder.
    this.onWrite?.(normalized);
  }

  async unlink(path: string): Promise<void> {
    await this.rawUnlink(this.toAbs(path));

    const normalized = normalize(path);
    if (normalized in this.metaCache) {
      delete this.metaCache[normalized];
      await this.persistMeta();
    }

    this.notify({ path: normalized, external: false });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.fsContext.fs.promises.stat(this.toAbs(path));
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------
  // Metadata
  // ------------------------------------------------------------------

  getAllMetadata(): FileMetaMap {
    return { ...this.metaCache };
  }

  getMetadata(path: string): FileMeta {
    return { ...(this.metaCache[normalize(path)] ?? {}) };
  }

  async setMetadata(path: string, patch: FileMeta): Promise<void> {
    const key = normalize(path);
    const next: FileMeta = { ...(this.metaCache[key] ?? {}), ...patch };

    Object.keys(next).forEach((k) => {
      if ((next as Record<string, unknown>)[k] === undefined) {
        delete (next as Record<string, unknown>)[k];
      }
    });

    if (Object.keys(next).length === 0) {
      delete this.metaCache[key];
    } else {
      this.metaCache[key] = next;
    }

    await this.persistMeta();
    this.notify({ path: key, external: false });
  }

  getEnvironment(): string | undefined {
    return this.sidecarEnvironment;
  }

  async setEnvironment(environment: string): Promise<void> {
    this.sidecarEnvironment = environment;
    await this.persistMeta();
  }

  getMode(): string | undefined {
    return this.sidecarMode;
  }

  async setMode(mode: string): Promise<void> {
    this.sidecarMode = mode;
    await this.persistMeta();
  }

  // ------------------------------------------------------------------
  // Change detection
  // ------------------------------------------------------------------

  /**
   * Subscribe to any mutation. Each change carries its `path` and an `external`
   * flag (`true` = written by the child iframe, `false` = a local edit). See
   * {@link SandpackFSChange}.
   */
  onChange(cb: SandpackFSListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /**
   * Record a write made by the child iframe (relayed from the `attachFS`
   * boundary in the host). Surfaces as an `external` change so the editor can
   * reflect it — distinct from local edits, which never reach here.
   */
  handleRemoteChange(path: string): void {
    if (this.disposed) return;
    this.notify({ path: normalize(path), external: true });
  }

  /**
   * Tear this instance down: drop every subscriber, stop emitting changes, and
   * release the ZenFS mount if we created it ({@link fromFiles}). An *adopted*
   * context ({@link fromFileSystemContext}) is left mounted — its lifecycle
   * belongs to the caller.
   *
   * ZenFS mounts live in a process-global table, so an instance that is never
   * disposed keeps its backing store alive for the page's lifetime. Idempotent.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    if (this.ownedMountPoint) {
      try {
        umount(this.ownedMountPoint);
      } catch {
        /* already unmounted — disposal must never throw */
      }
      this.ownedMountPoint = undefined;
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private toAbs(path: string): string {
    return normalize(path);
  }

  private notify(change: SandpackFSChange): void {
    this.listeners.forEach((listener) => {
      try {
        listener(change);
      } catch (err) {
        console.error("[sandpack-client]: SandpackFS listener threw", err);
      }
    });
  }

  private async ensureMetaDir(): Promise<void> {
    try {
      await this.rawMkdir(META_DIR, {
        recursive: true,
      });
    } catch {
      // already exists
    }
  }

  private async ensureParent(absPath: string): Promise<void> {
    const lastSlash = absPath.lastIndexOf("/");
    if (lastSlash <= 0) return;
    const dir = absPath.slice(0, lastSlash);
    if (!dir || dir === "/") return;
    try {
      await this.rawMkdir(dir, { recursive: true });
    } catch {
      // exists
    }
  }

  private async walk(relDir: string, out: string[]): Promise<void> {
    const absDir = this.toAbs(relDir);
    let entries: string[];
    try {
      entries = (await this.fsContext.fs.promises.readdir(
        absDir,
      )) as string[];
    } catch {
      return;
    }

    for (const entry of entries) {
      const relPath = (relDir === "/" ? "" : relDir) + "/" + entry;
      if (relPath.startsWith(META_DIR)) continue;

      const absEntry = this.toAbs(relPath);
      let isDir = false;
      try {
        const stat = await this.fsContext.fs.promises.stat(absEntry);
        isDir = stat.isDirectory();
      } catch {
        continue;
      }

      if (isDir) {
        await this.walk(relPath, out);
      } else {
        out.push(relPath);
      }
    }
  }

  private async writeInitial(files: SandpackFilesInput): Promise<void> {
    await this.ensureMetaDir();

    const meta: FileMetaMap = {};
    for (const [rawPath, entry] of Object.entries(files)) {
      const path = normalize(rawPath);
      const abs = this.toAbs(path);
      await this.ensureParent(abs);

      await this.rawWriteFile(abs, entry.code);

      const fileMeta: FileMeta = {};
      if (entry.hidden !== undefined) fileMeta.hidden = entry.hidden;
      if (entry.active !== undefined) fileMeta.active = entry.active;
      if (entry.readOnly !== undefined) fileMeta.readOnly = entry.readOnly;
      if (Object.keys(fileMeta).length > 0) meta[path] = fileMeta;
    }

    this.metaCache = meta;
    await this.persistMeta();
  }

  private async persistMeta(): Promise<void> {
    await this.ensureMetaDir();
    const sidecar: MetaSidecar = { files: this.metaCache };
    if (this.sidecarEnvironment !== undefined) {
      sidecar.environment = this.sidecarEnvironment;
    }
    if (this.sidecarMode !== undefined) {
      sidecar.mode = this.sidecarMode;
    }
    await this.rawWriteFile(
      this.toAbs(META_PATH),
      JSON.stringify(sidecar),
    );
  }

  private async refreshMetaCache(): Promise<void> {
    try {
      const raw = (await this.fsContext.fs.promises.readFile(
        this.toAbs(META_PATH),
        "utf8",
      )) as string;
      const parsed = JSON.parse(raw) as MetaSidecar | FileMetaMap;
      if ("files" in parsed && typeof parsed.files === "object") {
        this.metaCache = parsed.files as FileMetaMap;
        this.sidecarEnvironment = parsed.environment as string;
        this.sidecarMode = parsed.mode as string;
      } else {
        // Legacy format: plain FileMetaMap
        this.metaCache = parsed as FileMetaMap;
      }
    } catch {
      this.metaCache = {};
    }
  }
}

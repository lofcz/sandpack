import {
  InMemory,
  bindContext,
  mount,
  mounts,
  resolveMountConfig,
  type BoundContext,
} from "@zenfs/core";
import { SandpackFS, type SandpackFSChange } from "./SandpackFS";

// A stub remote-port factory: `connectRemote()` is never called in these tests,
// so the factory body never runs. It only satisfies the required constructor arg.
const noopPortFactory = (): Promise<MessagePort> =>
  Promise.resolve(undefined as unknown as MessagePort);

/**
 * R3-110 — the writer invariant (EDITOR_AS_APP_SPEC D-EDIT-1; LOCAL_DEVELOPMENT_SPEC
 * §6.5): every mutation of the shared ZenFS store must go through
 * `SandpackFS.writeFile`/`handleRemoteChange` so an `onChange` is emitted. In dev a
 * guard catches a write that reaches the instance's bound-context fs by any other
 * path. Jest sets `NODE_ENV=test` (≠ "production"), so the guard is active here.
 */
describe("SandpackFS — out-of-band write guard (R3-110)", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  const outOfBandCalls = () =>
    errorSpy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("out-of-band write"),
    );

  it("does not trip on a normal writeFile (and it emits onChange)", async () => {
    const fs = await SandpackFS.fromFiles({}, {}, noopPortFactory);
    const changes: SandpackFSChange[] = [];
    fs.onChange((c) => changes.push(c));

    await fs.writeFile("/App.tsx", "export default 1;");

    expect(outOfBandCalls()).toHaveLength(0);
    expect(changes).toContainEqual({ path: "/App.tsx", external: false });
    expect(await fs.readFile("/App.tsx")).toBe("export default 1;");
  });

  it("does not trip on handleRemoteChange (external relay)", async () => {
    const fs = await SandpackFS.fromFiles({}, {}, noopPortFactory);
    const changes: SandpackFSChange[] = [];
    fs.onChange((c) => changes.push(c));

    fs.handleRemoteChange("/remote.ts");

    expect(outOfBandCalls()).toHaveLength(0);
    expect(changes).toContainEqual({ path: "/remote.ts", external: true });
  });

  it("trips a loud console.error on an out-of-band write via the exposed fsContext", async () => {
    const fs = await SandpackFS.fromFiles({}, {}, noopPortFactory);
    const changes: SandpackFSChange[] = [];
    fs.onChange((c) => changes.push(c));

    // A "sixth writer" reaching around SandpackFS.writeFile straight to the store.
    await fs.fsContext.fs.promises.writeFile("/sneaky.ts", "leak");

    const flagged = outOfBandCalls();
    expect(flagged).toHaveLength(1);
    // The message names the offending method + path so the culprit is findable.
    expect(flagged[0][0]).toContain("writeFile");
    expect(flagged[0][0]).toContain("sneaky.ts");
    // The write still lands (the guard warns, it does not block)...
    expect(await fs.readFile("/sneaky.ts")).toBe("leak");
    // ...but precisely because it bypassed SandpackFS, no onChange was emitted —
    // the desync the invariant exists to prevent.
    expect(changes).toHaveLength(0);
  });

  it("also guards unlink routed around SandpackFS", async () => {
    const fs = await SandpackFS.fromFiles(
      { "/keep.ts": { code: "1" } },
      {},
      noopPortFactory,
    );

    await fs.fsContext.fs.promises.unlink("/keep.ts");

    const flagged = outOfBandCalls();
    expect(flagged).toHaveLength(1);
    expect(flagged[0][0]).toContain("unlink");
  });

  it("does not stack the guard when the same context is adopted again (R3-614)", async () => {
    // One mount, then the same context adopted twice more — the shape that previously
    // re-captured the prior instance's wrapper as "raw" and accused SandpackFS's own
    // ensureMetaDir write, once per prior adoption.
    const fs = await SandpackFS.fromFiles({}, {}, noopPortFactory);
    await SandpackFS.fromFileSystemContext(fs.fsContext, noopPortFactory);
    await SandpackFS.fromFileSystemContext(fs.fsContext, noopPortFactory);

    expect(outOfBandCalls()).toHaveLength(0);
  });

  it("fires exactly once for a genuine out-of-band write with three instances sharing the context", async () => {
    const fs = await SandpackFS.fromFiles({}, {}, noopPortFactory);
    await SandpackFS.fromFileSystemContext(fs.fsContext, noopPortFactory);
    await SandpackFS.fromFileSystemContext(fs.fsContext, noopPortFactory);

    const changes: SandpackFSChange[] = [];
    fs.onChange((c) => changes.push(c));

    await fs.fsContext.fs.promises.writeFile("/x", "y");

    const flagged = outOfBandCalls();
    expect(flagged).toHaveLength(1);
    expect(flagged[0][0]).toContain("writeFile");
    expect(flagged[0][0]).toContain("/x");
    expect(await fs.readFile("/x")).toBe("y");
    expect(changes).toHaveLength(0);
  });

  // Models the fresh-face shape of immediately-run-site-main
  // src/filesystem/roEditorContext.ts without its EROFS policy.
  const freshProxyFace = (context: BoundContext): BoundContext => {
    const fs = new Proxy(context.fs, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop === "promises" && value && typeof value === "object") {
          return new Proxy(value as object, {});
        }
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      },
    });

    return new Proxy(context, {
      get(target, prop, receiver) {
        if (prop === "fs") return fs;
        return Reflect.get(target, prop, receiver);
      },
    }) as BoundContext;
  };

  const WRITE_PATH_ARGS: Record<string, number[]> = {
    writeFile: [0],
    appendFile: [0],
    truncate: [0],
    rm: [0],
    rmdir: [0],
    unlink: [0],
    mkdir: [0],
    rename: [0, 1],
  };

  const readOnlyErrno = (): Error => {
    const error = new Error("EROFS: read-only file system") as Error & {
      code?: string;
    };
    error.code = "EROFS";
    return error;
  };

  const isReadOnlySidecarPath = (path: unknown): boolean =>
    typeof path === "string" &&
    (path === "/.sandpack" || path.startsWith("/.sandpack/"));

  const writesOnlyReadOnlySidecar = (
    method: string,
    args: unknown[],
  ): boolean => {
    const indexes = WRITE_PATH_ARGS[method];
    if (!indexes) return true;
    return indexes.every((index) => isReadOnlySidecarPath(args[index]));
  };

  const readOnlyFsFace = <T extends object>(face: T): T =>
    new Proxy(face, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop !== "string" || typeof value !== "function") {
          return value;
        }
        if (!(prop in WRITE_PATH_ARGS)) return value.bind(target);
        return (...args: unknown[]) => {
          if (!writesOnlyReadOnlySidecar(prop, args))
            throw readOnlyErrno();
          return (value as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );
        };
      },
    }) as T;

  // Models immediately-run-site-main src/filesystem/roEditorContext.ts: fresh
  // Proxy faces, symbol-get pass-through, no set trap, and EROFS source writes.
  const readOnlyEditorFace = (context: BoundContext): BoundContext => {
    const fs = new Proxy(context.fs, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop === "promises" && value && typeof value === "object") {
          return readOnlyFsFace(value as object);
        }
        if (typeof prop === "string" && typeof value === "function") {
          if (prop in WRITE_PATH_ARGS) {
            return (...args: unknown[]) => {
              if (!writesOnlyReadOnlySidecar(prop, args))
                throw readOnlyErrno();
              return (value as (...a: unknown[]) => unknown).apply(
                target,
                args,
              );
            };
          }
          return value.bind(target);
        }
        return value;
      },
    });

    return new Proxy(context, {
      get(target, prop, receiver) {
        if (prop === "fs") return fs;
        return Reflect.get(target, prop, receiver);
      },
    }) as BoundContext;
  };

  let rawContextCounter = 0;
  const createRawContext = async (): Promise<BoundContext> => {
    rawContextCounter += 1;
    const prefix = `/__sandpack_test_${rawContextCounter}`;
    const backend = await resolveMountConfig({ backend: InMemory });
    mount(prefix, backend);
    return bindContext({ root: prefix });
  };

  it("does not stack the guard when six adoptions see fresh proxy faces over one promises target (R3-422)", async () => {
    const fs = await SandpackFS.fromFiles({}, {}, noopPortFactory);

    for (let i = 0; i < 5; i += 1) {
      await SandpackFS.fromFileSystemContext(
        freshProxyFace(fs.fsContext),
        noopPortFactory,
      );
    }

    expect(outOfBandCalls()).toHaveLength(0);
  });

  it("keeps a later proxy-face instance's own writes quiet", async () => {
    const fs = await SandpackFS.fromFiles({}, {}, noopPortFactory);
    const later = await SandpackFS.fromFileSystemContext(
      freshProxyFace(fs.fsContext),
      noopPortFactory,
    );
    const changes: SandpackFSChange[] = [];
    later.onChange((c) => changes.push(c));

    await later.writeFile("/later.ts", "later");

    expect(outOfBandCalls()).toHaveLength(0);
    expect(changes).toContainEqual({ path: "/later.ts", external: false });
    expect(await later.readFile("/later.ts")).toBe("later");
  });

  it("fires exactly once for a genuine out-of-band write through a fresh proxy face", async () => {
    const fs = await SandpackFS.fromFiles({}, {}, noopPortFactory);
    await SandpackFS.fromFileSystemContext(
      freshProxyFace(fs.fsContext),
      noopPortFactory,
    );
    await SandpackFS.fromFileSystemContext(
      freshProxyFace(fs.fsContext),
      noopPortFactory,
    );
    const changes: SandpackFSChange[] = [];
    fs.onChange((c) => changes.push(c));

    await freshProxyFace(fs.fsContext).fs.promises.writeFile(
      "/proxy.ts",
      "y",
    );

    const flagged = outOfBandCalls();
    expect(flagged).toHaveLength(1);
    expect(flagged[0][0]).toContain("writeFile");
    expect(flagged[0][0]).toContain("/proxy.ts");
    expect(await fs.readFile("/proxy.ts")).toBe("y");
    expect(changes).toHaveLength(0);
  });

  it("preserves a later EROFS face's source refusal after a raw adoption (R3-422)", async () => {
    const raw = await SandpackFS.fromFiles({}, {}, noopPortFactory);
    const ro = await SandpackFS.fromFileSystemContext(
      readOnlyEditorFace(raw.fsContext),
      noopPortFactory,
    );

    await raw.writeFile("/raw.ts", "raw");
    await expect(ro.writeFile("/App.tsx", "ro")).rejects.toMatchObject({
      code: "EROFS",
    });
    await ro.setMetadata("/raw.ts", { hidden: true });

    expect(outOfBandCalls()).toHaveLength(0);
    expect(await raw.readFile("/raw.ts")).toBe("raw");
    expect(await raw.exists("/App.tsx")).toBe(false);
  });

  it("preserves both face policies when an EROFS face adopts before a raw face (R3-422)", async () => {
    const context = await createRawContext();
    const ro = await SandpackFS.fromFileSystemContext(
      readOnlyEditorFace(context),
      noopPortFactory,
    );
    const raw = await SandpackFS.fromFileSystemContext(
      context,
      noopPortFactory,
    );

    await expect(ro.writeFile("/App.tsx", "ro")).rejects.toMatchObject({
      code: "EROFS",
    });
    await raw.writeFile("/raw.ts", "raw");
    await ro.setMetadata("/raw.ts", { hidden: true });

    expect(outOfBandCalls()).toHaveLength(0);
    expect(await raw.readFile("/raw.ts")).toBe("raw");
    expect(await raw.exists("/App.tsx")).toBe(false);
  });

  it("fires exactly once for a raw out-of-band write after an EROFS-first adoption", async () => {
    const context = await createRawContext();
    await SandpackFS.fromFileSystemContext(
      readOnlyEditorFace(context),
      noopPortFactory,
    );
    const raw = await SandpackFS.fromFileSystemContext(
      context,
      noopPortFactory,
    );
    const changes: SandpackFSChange[] = [];
    raw.onChange((c) => changes.push(c));

    await context.fs.promises.writeFile("/oob.ts", "y");

    const flagged = outOfBandCalls();
    expect(flagged).toHaveLength(1);
    expect(flagged[0][0]).toContain("writeFile");
    expect(flagged[0][0]).toContain("/oob.ts");
    expect(await raw.readFile("/oob.ts")).toBe("y");
    expect(changes).toHaveLength(0);
  });

  it("keeps an EROFS face's out-of-band source refusal ahead of the guard", async () => {
    const context = await createRawContext();
    await SandpackFS.fromFileSystemContext(
      readOnlyEditorFace(context),
      noopPortFactory,
    );
    await SandpackFS.fromFileSystemContext(context, noopPortFactory);

    await expect(
      (async () =>
        readOnlyEditorFace(context).fs.promises.writeFile(
          "/oob.ts",
          "y",
        ))(),
    ).rejects.toMatchObject({ code: "EROFS" });

    expect(outOfBandCalls()).toHaveLength(0);
  });
});

describe("SandpackFS mount ownership", () => {
  it("unmounts a store it created and stops notifying after disposal", async () => {
    const before = new Set(mounts.keys());
    const fs = await SandpackFS.fromFiles({}, {}, noopPortFactory);
    const owned = [...mounts.keys()].filter((path) => !before.has(path));
    expect(owned).toHaveLength(1);
    const changed = jest.fn();
    fs.onChange(changed);
    fs.dispose();
    fs.dispose();
    fs.handleRemoteChange("/late.ts");
    expect(changed).not.toHaveBeenCalled();
    expect(mounts.has(owned[0])).toBe(false);
  });

  it("leaves an adopted store mounted and usable by its owner", async () => {
    const owner = await SandpackFS.fromFiles(
      { "/owned.ts": { code: "original" } },
      {},
      noopPortFactory,
    );
    const adopted = await SandpackFS.fromFileSystemContext(
      owner.fsContext,
      noopPortFactory,
    );
    const before = [...mounts.keys()];
    adopted.dispose();
    expect([...mounts.keys()]).toEqual(before);
    await owner.writeFile("/owned.ts", "updated");
    expect(await owner.readFile("/owned.ts")).toBe("updated");
    owner.dispose();
  });
});

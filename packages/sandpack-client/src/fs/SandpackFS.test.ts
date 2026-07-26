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
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
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
});

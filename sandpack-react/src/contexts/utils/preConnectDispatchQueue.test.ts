import type { SandpackMessage } from "@lofcz/sandpack-client";

import {
  createPreConnectDispatchQueue,
  DEFAULT_MAX_QUEUED_DISPATCHES,
  type QueuedDispatch,
} from "./preConnectDispatchQueue";

// Minimal stand-ins for the two message shapes this queue actually carries at
// boot: a mount announcement and an fs-change. Only `type`/`path` are read here.
const mountAdd = (path: string): SandpackMessage =>
  ({ type: "mount-add", path }) as unknown as SandpackMessage;
const fsChange = (path: string): SandpackMessage =>
  ({ type: "fs-change", path }) as unknown as SandpackMessage;

describe("createPreConnectDispatchQueue", () => {
  it("delivers pre-connect dispatches in FIFO order, exactly once, on flush", () => {
    const queue = createPreConnectDispatchQueue();
    // The R3-109 adversarial case: a mount-add and an fs-change issued at t=0,
    // BEFORE connect. The mount must arrive before the fs-change that needs it.
    queue.enqueue({ message: mountAdd("/space/a") });
    queue.enqueue({ message: fsChange("/space/a/notes.md") });
    expect(queue.size).toBe(2);

    const delivered: QueuedDispatch[] = [];
    queue.flush((item) => delivered.push(item));

    expect(delivered.map((d) => d.message.type)).toEqual([
      "mount-add",
      "fs-change",
    ]);
    expect(queue.size).toBe(0);

    // A second flush (the next "done" the client emits) delivers nothing —
    // exactly-once.
    const again: QueuedDispatch[] = [];
    queue.flush((item) => again.push(item));
    expect(again).toEqual([]);
  });

  it("preserves the addressed clientId per entry", () => {
    const queue = createPreConnectDispatchQueue();
    queue.enqueue({ message: mountAdd("/a"), clientId: "preview" });
    queue.enqueue({ message: mountAdd("/b") }); // broadcast

    const delivered: QueuedDispatch[] = [];
    queue.flush((item) => delivered.push(item));

    expect(delivered).toEqual([
      { message: mountAdd("/a"), clientId: "preview" },
      { message: mountAdd("/b") },
    ]);
  });

  it("bounds the buffer, dropping the OLDEST on overflow with a single warn", () => {
    const warn = jest.fn();
    const queue = createPreConnectDispatchQueue({ max: 3, warn });

    queue.enqueue({ message: fsChange("/1") });
    queue.enqueue({ message: fsChange("/2") });
    queue.enqueue({ message: fsChange("/3") });
    expect(warn).not.toHaveBeenCalled();

    queue.enqueue({ message: fsChange("/4") }); // overflow → drop "/1"
    expect(queue.size).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("exceeded 3");

    const delivered: string[] = [];
    queue.flush((item) =>
      delivered.push((item.message as { path: string }).path),
    );
    // Oldest ("/1") dropped; the most recent three survive, still in order.
    expect(delivered).toEqual(["/2", "/3", "/4"]);
  });

  it("defaults to a generous cap so a normal boot burst never warns", () => {
    const warn = jest.fn();
    const queue = createPreConnectDispatchQueue({ warn });
    for (let i = 0; i < DEFAULT_MAX_QUEUED_DISPATCHES; i++) {
      queue.enqueue({ message: fsChange(`/${i}`) });
    }
    expect(queue.size).toBe(DEFAULT_MAX_QUEUED_DISPATCHES);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reset() discards buffered state so it never replays into the next cycle", () => {
    const queue = createPreConnectDispatchQueue();
    queue.enqueue({ message: mountAdd("/stale") });
    queue.reset();
    expect(queue.size).toBe(0);

    const delivered: QueuedDispatch[] = [];
    queue.flush((item) => delivered.push(item));
    expect(delivered).toEqual([]);
  });

  it("flush is re-entrancy safe when deliver re-enqueues", () => {
    const queue = createPreConnectDispatchQueue();
    queue.enqueue({ message: mountAdd("/a") });

    const delivered: string[] = [];
    queue.flush((item) => {
      delivered.push((item.message as { path: string }).path);
      // A pathological deliver that re-enqueues must not recurse into a drain.
      if (delivered.length === 1) queue.enqueue({ message: mountAdd("/b") });
    });

    // Only the originally-buffered item is delivered in this drain; the
    // re-enqueued one stays buffered for a later flush (not lost, not doubled).
    expect(delivered).toEqual(["/a"]);
    expect(queue.size).toBe(1);
  });
});

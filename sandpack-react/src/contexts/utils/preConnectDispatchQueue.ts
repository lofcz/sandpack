import type { SandpackMessage } from "@lofcz/sandpack-client";

/**
 * A single buffered `dispatch` call: the message plus the optional client id the
 * caller addressed (`undefined` = broadcast to every client).
 */
export interface QueuedDispatch {
  message: SandpackMessage;
  clientId?: string;
}

/** Backstop cap on the pre-connect buffer — a stuck client that never connects
 *  must not grow it without bound. This is far above any real boot burst. */
export const DEFAULT_MAX_QUEUED_DISPATCHES = 500;

/**
 * A bounded FIFO buffer for `dispatch` calls made *before* the bundler client
 * has connected.
 *
 * Sandpack's `dispatch` only reaches a client once it is out of "idle" mode; a
 * message sent earlier used to be dropped with a warning, so the host had to
 * re-announce all of its state once the client connected. This queue instead
 * holds those early messages **in order** and replays them, **exactly once**,
 * when the client first connects — letting the host dispatch eagerly and delete
 * its replay-on-connect workaround (immediately.run R3-109 /
 * `sandpack-seam-hardening` Phase 2).
 */
export interface PreConnectDispatchQueue {
  /**
   * Buffer a dispatch. If the buffer is already at the cap, the OLDEST entry is
   * dropped (with a single `warn` naming the cap) — a backstop against a client
   * that never connects, not an expected path.
   */
  enqueue(item: QueuedDispatch): void;
  /**
   * Drain the buffer in FIFO order through `deliver`, then clear it. Idempotent:
   * once drained (or when empty) a further call delivers nothing, so it is safe
   * to call on every "connected"/"done" the client emits.
   */
  flush(deliver: (item: QueuedDispatch) => void): void;
  /** Discard everything buffered (a full client teardown, so stale pre-connect
   *  state never replays into the next connect cycle). */
  reset(): void;
  /** Current buffered count (observability + tests). */
  readonly size: number;
}

/**
 * Create a {@link PreConnectDispatchQueue}. `max` caps the buffer (drop-oldest on
 * overflow); `warn` is the sink for the single overflow warning (defaults to
 * `console.warn`, injectable for tests).
 */
export const createPreConnectDispatchQueue = (
  options: { max?: number; warn?: (message: string) => void } = {},
): PreConnectDispatchQueue => {
  const max = options.max ?? DEFAULT_MAX_QUEUED_DISPATCHES;
  const warn =
    options.warn ?? ((message: string): void => console.warn(message));

  let buffer: QueuedDispatch[] = [];
  let draining = false;

  return {
    enqueue(item: QueuedDispatch): void {
      buffer.push(item);
      if (buffer.length > max) {
        buffer.shift(); // drop-oldest — keep the most recent state
        warn(
          `[sandpack-react]: pre-connect dispatch queue exceeded ${max} messages; ` +
            `dropping the oldest (a bundler client that never connected?).`,
        );
      }
    },

    flush(deliver: (item: QueuedDispatch) => void): void {
      // Re-entrancy guard: if a deliver() somehow dispatches (re-enqueuing),
      // don't recurse into a second drain.
      if (draining) return;
      draining = true;
      try {
        // Snapshot-and-clear first so the queue is empty during delivery — a
        // second flush (the next "done") then finds nothing, giving exactly-once.
        const pending = buffer;
        buffer = [];
        for (const item of pending) deliver(item);
      } finally {
        draining = false;
      }
    },

    reset(): void {
      buffer = [];
    },

    get size(): number {
      return buffer.length;
    },
  };
};

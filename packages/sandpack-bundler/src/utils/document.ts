export function getDocumentHeight(): number {
  if (typeof window === 'undefined') return 0;

  const { body } = document;
  const html = document.documentElement;

  return Math.max(body.scrollHeight, body.offsetHeight, html.offsetHeight);
}

/**
 * Reports changes of the document, at most once per `throttleMs`. `start()` is
 * asked for after every evaluation and keeps the one observer it has: observers
 * are never collected while they observe, and each one costs a callback (and
 * the layout read behind it) on every mutation batch.
 */
export class DocumentMutationWatcher {
  private observer: MutationObserver | undefined;
  private throttle: ReturnType<typeof setTimeout> | undefined;

  constructor(private onMutation: () => void, private throttleMs: number) {}

  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(() => {
      if (this.throttle === undefined) {
        this.onMutation();

        this.throttle = setTimeout(() => {
          this.throttle = undefined;
        }, this.throttleMs);
      }
    });
    this.observer.observe(document, { attributes: true, childList: true, subtree: true });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    clearTimeout(this.throttle);
    this.throttle = undefined;
  }
}

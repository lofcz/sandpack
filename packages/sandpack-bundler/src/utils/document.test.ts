import { DocumentMutationWatcher } from './document';

class FakeMutationObserver {
  static live = new Set<FakeMutationObserver>();
  constructor(public callback: () => void) {}
  observe() {
    FakeMutationObserver.live.add(this);
  }
  disconnect() {
    FakeMutationObserver.live.delete(this);
  }
}

describe('DocumentMutationWatcher', () => {
  const g = globalThis as Record<string, unknown>;
  const previous = { MutationObserver: g.MutationObserver, document: g.document };

  beforeEach(() => {
    jest.useFakeTimers();
    FakeMutationObserver.live.clear();
    g.MutationObserver = FakeMutationObserver;
    g.document = {};
  });

  afterEach(() => {
    jest.useRealTimers();
    g.MutationObserver = previous.MutationObserver;
    g.document = previous.document;
  });

  it('keeps one observer however often it is started', () => {
    const watcher = new DocumentMutationWatcher(() => {}, 300);
    // Once per evaluation, as the bundler asks for it.
    for (let evaluation = 0; evaluation < 5; evaluation++) watcher.start();
    expect(FakeMutationObserver.live.size).toBe(1);

    watcher.stop();
    expect(FakeMutationObserver.live.size).toBe(0);
  });

  it('reports a burst of mutations once per throttle window', () => {
    const onMutation = jest.fn();
    const watcher = new DocumentMutationWatcher(onMutation, 300);
    watcher.start();
    watcher.start();
    const [observer] = [...FakeMutationObserver.live];

    observer.callback();
    observer.callback();
    expect(onMutation).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(300);
    observer.callback();
    expect(onMutation).toHaveBeenCalledTimes(2);
    watcher.stop();
  });
});

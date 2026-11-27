import { MessageEndpoint, WorkerMessageBus } from './WorkerMessageBus';

type Listener = (evt: { data: any }) => void;

/** One side of a port whose other side is the test: it sees what is posted and answers by hand. */
function fakeEndpoint() {
  const listeners = new Set<Listener>();
  const posted: any[] = [];
  const endpoint: MessageEndpoint = {
    postMessage: (message: any) => {
      posted.push(message);
    },
    addEventListener: (type: string, listener: Listener) => {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: Listener) => {
      listeners.delete(listener);
    },
  };
  const deliver = (data: any) => listeners.forEach((listener) => listener({ data }));
  return { endpoint, posted, deliver, respond: (request: any, result: any) => deliver({ channel: request.channel, id: request.id, result }) };
}

function createBus(endpoint: MessageEndpoint, timeoutMs = 30000): WorkerMessageBus {
  return new WorkerMessageBus({
    channel: 'test',
    endpoint,
    handleNotification: () => Promise.resolve(),
    handleRequest: () => Promise.reject(new Error('Unknown method')),
    handleError: () => Promise.resolve(),
    timeoutMs,
  });
}

describe('WorkerMessageBus', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('never resolves a request with the response to another bus on the same endpoint', async () => {
    const port = fakeEndpoint();
    const first = createBus(port.endpoint);
    const stale = first.request('transform', 'a.ts');
    // A second bus on the same port, as a re-initialized transformer creates.
    const second = createBus(port.endpoint);
    const fresh = second.request('transform', 'b.ts');

    const [staleRequest, freshRequest] = port.posted;
    expect(staleRequest.id).not.toBe(freshRequest.id);

    let freshResult: unknown;
    void fresh.then((result) => {
      freshResult = result;
    });
    port.respond(staleRequest, 'code of a.ts');
    await expect(stale).resolves.toBe('code of a.ts');
    expect(freshResult).toBeUndefined();

    port.respond(freshRequest, 'code of b.ts');
    await expect(fresh).resolves.toBe('code of b.ts');
  });

  it('does not time out requests that wait behind others while the endpoint keeps answering', async () => {
    jest.useFakeTimers();
    const port = fakeEndpoint();
    const bus = createBus(port.endpoint, 30000);
    const results = [bus.request('transform', 1), bus.request('transform', 2), bus.request('transform', 3)];
    const settled: string[] = [];
    results.forEach((result, index) => result.then(() => settled.push(`ok ${index}`), () => settled.push(`failed ${index}`)));

    // A serial worker that needs 20 s per request: the last answer arrives 60 s after posting.
    for (const request of [...port.posted]) {
      jest.advanceTimersByTime(20000);
      port.respond(request, 'done');
      await Promise.resolve();
    }
    await Promise.all(results);
    expect(settled).toEqual(['ok 0', 'ok 1', 'ok 2']);
  });

  it('fails every unanswered request once the endpoint has been silent for the timeout', async () => {
    jest.useFakeTimers();
    const port = fakeEndpoint();
    const bus = createBus(port.endpoint, 30000);
    const answered = bus.request('transform', 1);
    const silent = [bus.request('transform', 2), bus.request('transform', 3)];
    const failures = silent.map((result) => result.then(() => null, (err: Error) => err.message));

    jest.advanceTimersByTime(10000);
    port.respond(port.posted[0], 'done');
    await expect(answered).resolves.toBe('done');

    // 29 s after the last answer nothing has failed yet.
    jest.advanceTimersByTime(29000);
    await Promise.resolve();
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(1000);
    jest.runOnlyPendingTimers();
    expect(await Promise.all(failures)).toEqual([
      'Request on channel test timed out: no response for 30000 ms',
      'Request on channel test timed out: no response for 30000 ms',
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('handles a response that was already queued when the timer fired late', async () => {
    jest.useFakeTimers();
    const port = fakeEndpoint();
    const bus = createBus(port.endpoint, 30000);
    const result = bus.request('transform', 1);

    jest.advanceTimersByTime(30000);
    // The page was busy: the answer is handled right after the overdue timer.
    port.respond(port.posted[0], 'late but there');
    jest.runOnlyPendingTimers();
    await expect(result).resolves.toBe('late but there');
  });

  it('leaves no timer running once every request is answered', async () => {
    jest.useFakeTimers();
    const port = fakeEndpoint();
    const bus = createBus(port.endpoint);
    const result = bus.request('transform', 1);
    port.respond(port.posted[0], 'done');
    await result;
    expect(jest.getTimerCount()).toBe(0);
  });
});

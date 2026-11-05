import { IFrameParentMessageBus } from './iframe';

describe('refresh capability negotiation', () => {
  const originalWindow = globalThis.window;
  let receive: (event: MessageEvent) => void;
  let reload: jest.Mock;
  let postMessage: jest.Mock;

  beforeEach(() => {
    reload = jest.fn();
    postMessage = jest.fn();
    (globalThis as any).window = {
      location: { reload },
      parent: { postMessage },
      addEventListener: (_type: string, listener: typeof receive) => { receive = listener; },
    };
  });

  afterEach(() => { (globalThis as any).window = originalWindow; });

  it.each([undefined, false, true])('supports hostControlledRefresh=%s', (capability) => {
    const bus = new IFrameParentMessageBus();
    receive({ source: window.parent, data: { type: 'register-frame', id: 'host-channel', hostControlledRefresh: capability } } as MessageEvent);
    bus.requestRefresh();
    if (capability === true) {
      expect(reload).not.toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledWith({
        codesandbox: true, type: 'request-refresh', $id: 'host-channel',
      }, '*');
    } else {
      expect(reload).toHaveBeenCalledTimes(1);
      expect(postMessage).not.toHaveBeenCalled();
    }
  });
});

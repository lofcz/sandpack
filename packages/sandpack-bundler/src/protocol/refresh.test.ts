import type { Mock } from '@rstest/core';
import { IFrameParentMessageBus } from './iframe';

describe('refresh capability negotiation', () => {
  const originalWindow = globalThis.window;
  let receive: (event: MessageEvent) => void;
  let reload: Mock;
  let postMessage: Mock;

  beforeEach(() => {
    reload = rs.fn();
    postMessage = rs.fn();
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

import { IFrameParentMessageBus } from './iframe';

describe('iframe parent message ownership', () => {
  const originalWindow = globalThis.window;
  let receive: (event: MessageEvent) => void;
  let bus: IFrameParentMessageBus;

  const deliver = (data: Record<string, unknown>, source: unknown = window.parent, ports: unknown[] = []) => {
    receive({ data, source, ports } as unknown as MessageEvent);
  };
  const register = () => deliver({ type: 'register-frame', id: 'host-channel', template: 'react' });

  beforeEach(() => {
    (globalThis as any).window = {
      parent: { postMessage: jest.fn() },
      addEventListener: (_type: string, listener: typeof receive) => { receive = listener; },
    };
    bus = new IFrameParentMessageBus();
  });

  afterEach(() => { (globalThis as any).window = originalWindow; });

  it('ignores registration and transferred ports from another window', async () => {
    const port = { start: jest.fn() };
    deliver({ type: 'register-frame', id: 'foreign-channel', template: 'foreign' }, {}, [port]);
    expect(port.start).not.toHaveBeenCalled();

    register();
    expect((await bus.getInitConfig()).template).toBe('react');
    deliver({ type: 'register-frame', id: 'foreign-channel', template: 'foreign' }, {});
    expect((await bus.getInitConfig()).template).toBe('react');
  });

  it('accepts commands only from the actual parent, even when another sender knows the channel id', () => {
    register();
    const listener = jest.fn();
    bus.onMessage(listener);
    const command = { type: 'evaluate', codesandbox: true, $id: 'host-channel', command: '1 + 1' };
    for (const source of [{}, window, null]) deliver(command, source);
    expect(listener).not.toHaveBeenCalled();
    deliver(command);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(command);
  });

  it('ignores commands before registration and messages for a different host channel', () => {
    const listener = jest.fn();
    bus.onMessage(listener);
    const message = { type: 'fs-change', codesandbox: true, $id: 'host-channel', paths: ['/App.tsx'] };
    deliver(message);
    register();
    deliver({ ...message, $id: 'stale-channel' });
    deliver({ ...message, $id: undefined });
    expect(listener).not.toHaveBeenCalled();
    deliver(message);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('preserves transferred mount ports on the registered parent channel', () => {
    register();
    const listener = jest.fn();
    bus.onMessage(listener);
    const port = { start: jest.fn() };
    const message = { type: 'mount-add', codesandbox: true, $id: 'host-channel', path: '/assets' };
    deliver(message, window.parent, [port]);
    expect(listener).toHaveBeenCalledWith({ ...message, ports: [port] });
  });

  it('settles a protocol request only from a matching parent reply', async () => {
    register();
    const response = bus.protocolRequest('immutable-fetch', 'fetch', ['https://cdn.example/pkg']);
    const reply = { type: 'protocol-immutable-fetch', codesandbox: true, $id: 'host-channel', msgId: 0 };
    deliver({ ...reply, result: 'foreign bytes' }, {});
    deliver({ ...reply, $id: 'stale-channel', result: 'stale bytes' });
    deliver({ ...reply, result: 'parent bytes' });
    await expect(response).resolves.toBe('parent bytes');
  });
});

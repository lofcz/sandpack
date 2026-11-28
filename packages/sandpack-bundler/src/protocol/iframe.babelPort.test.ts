/**
 * @rstest-environment jsdom
 */
import { IFrameParentMessageBus } from './iframe';

type Listener = (event: { source: unknown; data: unknown; ports: unknown[] }) => void;

/** Deliver the handshake as the host window does, with the ports it transfers. */
const registerFrame = (bus: IFrameParentMessageBus, ports: unknown[]) =>
  (bus as unknown as { _messageListener: Listener })._messageListener({
    source: window.parent,
    data: { type: 'register-frame', id: 'frame-1', template: 'react' },
    ports,
  });

const port = () => ({ start: rs.fn() });

describe('IFrameParentMessageBus Babel port', () => {
  it('hands over the Babel port the handshake transferred', async () => {
    const bus = new IFrameParentMessageBus();
    const waiting = bus.getBabelPort();
    const babelPort = port();
    registerFrame(bus, [port(), babelPort]);

    await expect(waiting).resolves.toBe(babelPort);
    await expect(bus.getBabelPort()).resolves.toBe(babelPort);
  });

  it('fails instead of waiting forever when the handshake carried no Babel port', async () => {
    const bus = new IFrameParentMessageBus();
    const waiting = bus.getBabelPort();
    registerFrame(bus, [port()]);

    await expect(waiting).rejects.toThrow(/without a Babel worker port/);
    await expect(bus.getBabelPort()).rejects.toThrow(/without a Babel worker port/);
  });

  it('accepts the port from a later handshake', async () => {
    const bus = new IFrameParentMessageBus();
    registerFrame(bus, [port()]);
    const babelPort = port();
    registerFrame(bus, [port(), babelPort]);

    await expect(bus.getBabelPort()).resolves.toBe(babelPort);
  });
});

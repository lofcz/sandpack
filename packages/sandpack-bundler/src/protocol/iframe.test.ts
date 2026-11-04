/**
 * @jest-environment jsdom
 *
 * register-frame handshake parsing — the §5.2 dirty set rides IInitConfig
 * alongside sdkIntegrity (PRETRANSPILED_ARTIFACTS_SPEC §5.2).
 */
import { IFrameParentMessageBus } from './iframe';

const registerFrame = (extra: Record<string, unknown>) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'register-frame', id: 'frame-1', template: 'react', ...extra },
    }),
  );

describe('IFrameParentMessageBus register-frame', () => {
  it.each(['0123456789abcdef', 12345])('echoes the host channel id unchanged: %s', (id) => {
    const bus = new IFrameParentMessageBus();
    registerFrame({ id });
    const post = jest.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    try {
      bus.sendMessage('request-refresh');
      expect(post).toHaveBeenCalledWith({ type: 'request-refresh', codesandbox: true, $id: id }, '*');
    } finally {
      post.mockRestore();
    }
  });
  it('reads dirtyPaths into the init config', async () => {
    const bus = new IFrameParentMessageBus();
    registerFrame({ dirtyPaths: ['/src/App.tsx', '/src/old.ts'] });
    const config = await bus.getInitConfig();
    expect(config.dirtyPaths).toEqual(['/src/App.tsx', '/src/old.ts']);
    expect(config.template).toBe('react');
  });

  it('leaves dirtyPaths undefined when the host omits it', async () => {
    const bus = new IFrameParentMessageBus();
    registerFrame({});
    const config = await bus.getInitConfig();
    expect(config.dirtyPaths).toBeUndefined();
  });

  it('reads sandpackCdnRoot into the init config', async () => {
    const bus = new IFrameParentMessageBus();
    registerFrame({ sandpackCdnRoot: 'http://localhost:44298/sandpack-cdn/' });
    const config = await bus.getInitConfig();
    expect(config.sandpackCdnRoot).toBe('http://localhost:44298/sandpack-cdn/');
  });
});

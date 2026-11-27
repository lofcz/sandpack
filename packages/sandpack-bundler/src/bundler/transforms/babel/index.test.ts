import type { Bundler } from '../../bundler';
import { BabelTransformer, failBabelRequests } from './index';

describe('BabelTransformer', () => {
  it('drives one port with one message bus, however often it is initialized', async () => {
    const listeners: string[] = [];
    const port = {
      start: jest.fn(),
      postMessage: jest.fn(),
      addEventListener: (type: string) => listeners.push(type),
      removeEventListener: () => {},
    };
    const bundler = { messageBus: { getBabelPort: () => Promise.resolve(port) } } as unknown as Bundler;

    // A preset set up again (a build that starts over) creates a new transformer on the same port.
    await new BabelTransformer().init(bundler);
    await new BabelTransformer().init(bundler);
    await new BabelTransformer().init(bundler);

    expect(listeners.filter((type) => type === 'message')).toHaveLength(1);
    expect(port.start).toHaveBeenCalledTimes(1);
  });

  it('fails the files waiting for a worker the host reports dead', async () => {
    const port = {
      start: jest.fn(),
      postMessage: jest.fn(),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const bundler = { messageBus: { getBabelPort: () => Promise.resolve(port) } } as unknown as Bundler;
    const transformer = new BabelTransformer();
    await transformer.init(bundler);

    const pending = (transformer as unknown as { messageBus: { request(method: string): Promise<unknown> } }).messageBus
      .request('transform');
    failBabelRequests('https://host.example/babel-worker.js: failed to load');

    await expect(pending).rejects.toThrow('The Babel worker failed: https://host.example/babel-worker.js: failed to load');
  });
});

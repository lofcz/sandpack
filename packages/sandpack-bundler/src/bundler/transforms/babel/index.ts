import type { Bundler } from '../../bundler';
import { CompilationError } from '../../../errors/CompilationError';
import * as logger from '../../../utils/logger';
import { WorkerMessageBus } from '../../../utils/WorkerMessageBus';
import { ITranspilationContext, ITranspilationResult, Transformer } from '../Transformer';
import type { ITransformData } from './babel-worker';

// One bus per port: a preset initialized again must not attach a second
// listener (and a second timeout clock) to the worker the first one still uses.
const busByPort = new WeakMap<MessagePort, WorkerMessageBus>();
const buses = new Set<WorkerMessageBus>();

/**
 * The host owns the worker behind the port and is the only one who sees it
 * die; files waiting for it fail now instead of after the silence timeout.
 */
export const failBabelRequests = (reason: string): void => {
  for (const bus of buses) {
    bus.failPendingRequests(new Error(`The Babel worker failed: ${reason}`));
  }
};

export class BabelTransformer extends Transformer {
  private messageBus: null | WorkerMessageBus = null;

  constructor() {
    super('babel-transformer');
  }

  async init(bundler: Bundler) {
    // The Babel worker runs in the *parent* page, not this (now opaque-origin)
    // iframe — an opaque origin can't load a same-origin worker script. The
    // parent transfers a `MessagePort` connected to that worker via the
    // `register-frame` handshake; we drive it with the same `WorkerMessageBus`
    // protocol the worker speaks, since a `MessagePort` is a valid endpoint.
    const port = await bundler.messageBus.getBabelPort();
    let messageBus = busByPort.get(port);
    if (!messageBus) {
      port.start();
      messageBus = new WorkerMessageBus({
        channel: 'sandpack-babel',
        endpoint: port,
        handleNotification: () => Promise.resolve(),
        handleRequest: () => Promise.reject(new Error('Unknown method')),
        handleError: (err) => {
          logger.error(err);
          return Promise.resolve();
        },
        timeoutMs: 30000,
      });
      busByPort.set(port, messageBus);
      buses.add(messageBus);
    }
    this.messageBus = messageBus;
  }

  async transform(ctx: ITranspilationContext, config: any): Promise<ITranspilationResult> {
    if (!this.messageBus) {
      throw new Error('Babel worker has not been initialized');
    }

    const data: ITransformData = {
      code: ctx.code,
      filepath: ctx.module.filepath,
      config,
    };

    try {
      return await this.messageBus.request('transform', data);
    } catch (err: unknown) {
      return new CompilationError(err as Error, ctx.module.filepath);
    }
  }
}

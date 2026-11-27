export type RequestHandlerFn = (method: string, ...params: any[]) => Promise<any>;
export type NotificationHandlerFn = (method: string, data: any) => Promise<any>;
export type ErrorHandlerFn = (error: Error) => Promise<any>;

import * as logger from '../utils/logger';

export interface MessageEndpoint {
  postMessage(message: any, ...params: any[]): void;
  addEventListener(type: string, listener: (ev: any) => any): any;
  removeEventListener(type: string, listener: (ev: any) => any): any;
}

export interface WorkerMessageBusOpts {
  /** name for the channel */
  channel: string;
  // worker ref (on main) or self (on worker)
  endpoint: MessageEndpoint;
  handleRequest: RequestHandlerFn;
  handleNotification: NotificationHandlerFn;
  handleError: ErrorHandlerFn;
  timeoutMs: number;
}

export interface PendingRequest {
  resolve: (result: any) => void;
  reject: (err: Error) => void;
}

// One id sequence for every bus of this realm: responses are matched by
// channel and id alone, so two buses on one endpoint must never share an id.
let lastMessageId = 0;

const serializeError = (originalError: any): any => {
  if (typeof originalError !== 'object') {
    return { message: originalError };
  } else {
    return {
      message: originalError.message,
      name: originalError.name,
      stack: originalError.stack,
      ...originalError,
    };
  }
};

const parseError = (serializedError: any): Error => {
  const error = new Error(serializedError.message);
  for (const key of Object.keys(serializedError)) {
    // @ts-ignore
    error[key] = serializedError[key];
  }
  return error;
};

export class WorkerMessageBus {
  private endpoint: MessageEndpoint;
  private handleRequest: RequestHandlerFn;
  private handleNotification: NotificationHandlerFn;
  private handleError: ErrorHandlerFn;
  private channel: string;
  private timeoutMs: number;

  private pendingRequests = new Map<number, PendingRequest>();
  // Runs while requests are unanswered; each response restarts it.
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: WorkerMessageBusOpts) {
    this.channel = opts.channel;
    this.endpoint = opts.endpoint;
    this.handleRequest = opts.handleRequest;
    this.handleNotification = opts.handleNotification;
    this.handleError = opts.handleError;
    this.timeoutMs = opts.timeoutMs;

    this.endpoint.addEventListener('message', async (evt) => {
      const data = evt.data;
      if (data.channel !== this.channel) {
        return;
      }

      const messageId = data.id;
      if (data.method) {
        if (messageId == null) {
          this.handleNotification(data.method, data.data);
        } else if (data.method && data.params) {
          // It's a request
          try {
            const result = await this.handleRequest(data.method, ...data.params);
            this.endpoint.postMessage({
              id: messageId,
              channel: this.channel,
              result,
            });
          } catch (err) {
            logger.error(err);

            this.endpoint.postMessage({
              id: messageId,
              channel: this.channel,
              error: serializeError(err),
            });
          }
        }
      } else if (messageId != null) {
        // It's a response
        const pendingRequest = this.pendingRequests.get(messageId);
        if (!pendingRequest) {
          return;
        }
        this.pendingRequests.delete(messageId);
        this.watch();

        if (data.error !== undefined) {
          pendingRequest.reject(parseError(data.error));
        } else {
          pendingRequest.resolve(data.result);
        }
      }
    });

    this.endpoint.addEventListener('error', (err) => this.handleError(err));
  }

  nextMessageId() {
    lastMessageId++;
    return lastMessageId;
  }

  /**
   * The timeout measures the endpoint's silence, not a request's age: the
   * other side answers one request at a time, so a request queued behind
   * others is waiting, not stuck, for as long as responses keep arriving.
   */
  private watch(expired = false): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    if (this.pendingRequests.size === 0) {
      return;
    }
    this.watchdog = setTimeout(
      () => {
        this.watchdog = null;
        if (expired) {
          this.failPendingRequests(
            new Error(`Request on channel ${this.channel} timed out: no response for ${this.timeoutMs} ms`)
          );
        } else {
          // A timer can fire late (a long task, a resumed page) while responses
          // already wait in this page's queue: let them be handled first.
          this.watch(true);
        }
      },
      expired ? 0 : this.timeoutMs
    );
  }

  /**
   * Nothing sent to the endpoint will be answered: it went silent with work in
   * hand, or whoever owns it reported that it died.
   */
  failPendingRequests(error: Error): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    const pendingRequests = [...this.pendingRequests.values()];
    this.pendingRequests.clear();
    for (const pendingRequest of pendingRequests) {
      pendingRequest.reject(error);
    }
  }

  request(method: string, ...params: any): Promise<any> {
    const messageId = this.nextMessageId();
    const message = {
      channel: this.channel,
      id: messageId,
      method,
      params,
    };
    const promise = new Promise((resolve, reject) => {
      this.pendingRequests.set(messageId, { resolve, reject });
    });
    // Only the first unanswered request starts the clock; later ones wait behind it.
    if (this.pendingRequests.size === 1) {
      this.watch();
    }
    try {
      this.endpoint.postMessage(message);
    } catch (err) {
      // Never sent, so never answered: it must not hold the clock.
      this.pendingRequests.delete(messageId);
      this.watch();
      throw err;
    }
    return promise;
  }
}

import { SandpackError } from './SandpackError';

/** An error status, no usable connection, no answer in time, or a body that is not what was asked for. */
export type FetchFailure = 'http' | 'network' | 'timeout' | 'body';

export interface FetchErrorContext {
  failure?: FetchFailure;
  /** What was being fetched, in the caller's terms (e.g. `react@19.1.0`). */
  subject?: string;
  /** Attempts made before giving up. */
  attempts?: number;
  /** The bound a `timeout` failure ran into. */
  timeoutMs?: number;
  cause?: unknown;
}

/** The `message` of a JSON error body (the package CDN's `ErrorReply`), if the body is one. */
function serviceMessageOf(text: string): string | undefined {
  if (!text) return undefined;
  try {
    const body: unknown = JSON.parse(text);
    const message = body !== null && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
    return typeof message === 'string' && message.length > 0 ? message : undefined;
  } catch {
    return undefined;
  }
}

function causeMessage(cause: unknown): string | undefined {
  const message = (cause as { message?: unknown } | null | undefined)?.message;
  if (typeof message === 'string') return message || undefined;
  return cause == null ? undefined : String(cause);
}

export class FetchError extends SandpackError {
  code = 'FETCH_ERROR';

  url: string;
  /** HTTP status; 0 when no response arrived (`network`, `timeout`). */
  status: number;
  text: string;
  failure: FetchFailure;
  subject?: string;
  attempts?: number;
  /** What the service said went wrong, when its error body carried a message. */
  serviceMessage?: string;

  constructor(res: Pick<Response, 'status' | 'statusText' | 'url'>, text: string, context: FetchErrorContext = {}) {
    const failure = context.failure ?? 'http';
    const serviceMessage = failure === 'http' ? serviceMessageOf(text) : undefined;
    // A browser's own message ("Failed to fetch") names neither the URL nor the package.
    const target =
      context.subject && res.url ? `${context.subject} (${res.url})` : context.subject || res.url || 'an unknown URL';
    let summary: string;
    let detail: string | undefined;
    if (failure === 'http') {
      // statusText is empty under HTTP/2, so the status alone has to carry the meaning.
      summary = `Fetch failed with status ${res.status}${res.statusText ? ` ${res.statusText}` : ''} for ${target}`;
      detail = serviceMessage;
    } else if (failure === 'timeout') {
      summary = `Request timed out${context.timeoutMs ? ` after ${context.timeoutMs} ms` : ''} for ${target}`;
    } else if (failure === 'network') {
      summary = `Network request failed for ${target}`;
      detail = causeMessage(context.cause);
    } else {
      summary = `Unreadable response body for ${target}`;
      detail = causeMessage(context.cause);
    }
    const attempts = context.attempts && context.attempts > 1 ? ` (after ${context.attempts} attempts)` : '';
    super(`${summary}${detail ? `: ${detail}` : ''}${attempts}`);

    this.status = res.status;
    this.text = text;
    this.url = res.url;
    this.failure = failure;
    this.subject = context.subject;
    this.attempts = context.attempts;
    this.serviceMessage = serviceMessage;
    if (context.cause !== undefined) this.cause = context.cause;
  }
}

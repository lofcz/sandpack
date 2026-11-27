// A `throw` or a rejection can carry any value. Only an Error has a stack; the
// rest must be described by what they hold, never by `String(value)`, which
// reads "[object Object]" or "[object Event]".

const MAX_TEXT_LENGTH = 600;

const truncate = (text: string): string =>
  text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}… [${text.length} chars]` : text;

const typeTag = (value: object): string => Object.prototype.toString.call(value).slice(8, -1);

/** An Error of this realm, or of another one (a nested frame): message and stack are what the pipeline reads. */
function isErrorLike(value: unknown): value is Error {
  if (value instanceof Error) return true;
  const candidate = value as { message?: unknown; stack?: unknown } | null;
  return typeof candidate === 'object' && candidate !== null && typeof candidate.message === 'string' && typeof candidate.stack === 'string';
}

function isEvent(value: object): value is Event {
  return (typeof Event !== 'undefined' && value instanceof Event) || typeTag(value).endsWith('Event');
}

/** `<img src="…">` for an element, the constructor name for any other event target. */
function describeEventTarget(target: unknown): string | null {
  if (typeof target !== 'object' || target === null) return null;
  const element = target as { tagName?: unknown; getAttribute?: (name: string) => string | null };
  if (typeof element.tagName !== 'string') {
    const name = typeTag(target);
    return name === 'Object' ? null : name;
  }
  let text = `<${element.tagName.toLowerCase()}`;
  for (const name of ['src', 'href']) {
    const value = typeof element.getAttribute === 'function' ? element.getAttribute(name) : null;
    if (value) text += ` ${name}="${value}"`;
  }
  return `${text}>`;
}

function describeEvent(event: Event): string {
  const target = describeEventTarget(event.target);
  const message = (event as { message?: unknown }).message;
  let text = `"${event.type}" event`;
  if (target) text += ` on ${target}`;
  if (typeof message === 'string' && message) text += `: ${message}`;
  return text;
}

function toJson(value: object): string | undefined {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return `${item}n`;
      if (typeof item === 'function') return `[Function ${item.name || 'anonymous'}]`;
      if (typeof item === 'symbol') return item.toString();
      if (typeof item !== 'object' || item === null) return item;
      // An Error has no enumerable fields and would read "{}".
      if (item instanceof Error) return { name: item.name, message: item.message };
      if (seen.has(item)) return '[Circular]';
      seen.add(item);
      return item;
    });
  } catch {
    return undefined;
  }
}

/** What a thrown or rejected value says, as one bounded line of text. */
export function describeThrown(value: unknown): string {
  if (typeof value === 'string') return truncate(value);
  if (typeof value !== 'object' || value === null) return String(value);
  if (isErrorLike(value)) return value.message || value.name || 'Error';
  if (isEvent(value)) return truncate(describeEvent(value));
  const json = toJson(value);
  const name = typeTag(value);
  if (json === undefined) return name;
  return truncate(name === 'Object' || name === 'Array' ? json : `${name} ${json}`);
}

/** Real errors pass through untouched; anything else becomes an Error that says what it was. */
export function toError(value: unknown): Error {
  return isErrorLike(value) ? value : new Error(describeThrown(value));
}

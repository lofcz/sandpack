import { describeThrown, toError } from './thrown-value';
import { registerUnhandledError } from './unhandled-error';
import { registerUnhandledRejection } from './unhandled-rejection';

/** An element as an event target reports it: a tag and attributes. */
const element = (tagName: string, attributes: Record<string, string>) => ({
  tagName,
  getAttribute: (name: string) => attributes[name] ?? null,
});

function eventOn(type: string, target: unknown): Event {
  const event = new Event(type);
  Object.defineProperty(event, 'target', { value: target });
  return event;
}

describe('describeThrown', () => {
  it('names an event by its type and the element it fired on', () => {
    const failedImage = eventOn('error', element('IMG', { src: 'https://cdn.example/missing.png' }));
    expect(describeThrown(failedImage)).toBe('"error" event on <img src="https://cdn.example/missing.png">');

    const failedStylesheet = eventOn('error', element('LINK', { href: '/theme.css' }));
    expect(describeThrown(failedStylesheet)).toBe('"error" event on <link href="/theme.css">');

    expect(describeThrown(new Event('abort'))).toBe('"abort" event');
  });

  it('names a non-element event target by what it is', () => {
    class FakeSocket {
      get [Symbol.toStringTag]() {
        return 'WebSocket';
      }
    }
    expect(describeThrown(eventOn('error', new FakeSocket()))).toBe('"error" event on WebSocket');
  });

  it('serializes a plain object as JSON', () => {
    expect(describeThrown({ status: 404, body: { reason: 'not found' } })).toBe('{"status":404,"body":{"reason":"not found"}}');
    expect(describeThrown([1, 'two'])).toBe('[1,"two"]');
  });

  it('serializes what JSON cannot: cycles, bigints, functions and nested errors', () => {
    const cyclic: Record<string, unknown> = { id: 1n, retry() {}, cause: new TypeError('bad input') };
    cyclic.self = cyclic;
    expect(describeThrown(cyclic)).toBe(
      '{"id":"1n","retry":"[Function retry]","cause":{"name":"TypeError","message":"bad input"},"self":"[Circular]"}'
    );
  });

  it('names the class of an object that is not a plain one', () => {
    class ApiFailure {
      code = 'E_QUOTA';
      get [Symbol.toStringTag]() {
        return 'ApiFailure';
      }
    }
    expect(describeThrown(new ApiFailure())).toBe('ApiFailure {"code":"E_QUOTA"}');
  });

  it('bounds the length of what it serializes', () => {
    const text = describeThrown({ rows: Array.from({ length: 5000 }, (_, index) => index) });
    expect(text.length).toBeLessThan(700);
    expect(text).toMatch(/… \[\d+ chars\]$/);
  });

  it('keeps strings and other primitives readable', () => {
    expect(describeThrown('plain message')).toBe('plain message');
    expect(describeThrown(42)).toBe('42');
    expect(describeThrown(undefined)).toBe('undefined');
    expect(describeThrown(null)).toBe('null');
  });
});

describe('toError', () => {
  it('returns a real error untouched', () => {
    const error = new RangeError('out of range');
    expect(toError(error)).toBe(error);
  });

  it('keeps an error of another realm: it has a message and a stack', () => {
    const foreign = { name: 'TypeError', message: 'x is not a function', stack: 'TypeError: x is not a function\n    at f (a.js:1:1)' };
    expect(toError(foreign)).toBe(foreign);
  });

  it('never yields "[object Object]" or "[object Event]"', () => {
    for (const value of [{ a: 1 }, new Event('error'), Object.create(null), new Map([[1, 2]])]) {
      expect(toError(value)).toBeInstanceOf(Error);
      expect(toError(value).message).not.toMatch(/^\[object /);
    }
  });
});

describe('runtime error listeners', () => {
  it('reports a rejected event with its type and target', () => {
    const target = new EventTarget();
    const reported: Error[] = [];
    const unregister = registerUnhandledRejection(target, (error) => reported.push(error));

    const rejection = new Event('unhandledrejection');
    Object.assign(rejection, { reason: eventOn('error', element('SCRIPT', { src: 'https://maps.example/api.js' })) });
    target.dispatchEvent(rejection);
    unregister();

    expect(reported.map((error) => error.message)).toEqual(['"error" event on <script src="https://maps.example/api.js">']);
  });

  it('reports a rejected or thrown object as JSON and passes errors through', () => {
    const target = new EventTarget();
    const reported: Error[] = [];
    const unregisterRejection = registerUnhandledRejection(target, (error) => reported.push(error));
    const unregisterError = registerUnhandledError(target, (error) => reported.push(error));
    const real = new Error('real error');

    target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: { code: 'E_FAIL' } }));
    target.dispatchEvent(Object.assign(new Event('error'), { error: { code: 'E_THROWN' } }));
    target.dispatchEvent(Object.assign(new Event('error'), { error: real }));
    unregisterRejection();
    unregisterError();

    expect(reported.map((error) => error.message)).toEqual(['{"code":"E_FAIL"}', '{"code":"E_THROWN"}', 'real error']);
    expect(reported[2]).toBe(real);
  });
});

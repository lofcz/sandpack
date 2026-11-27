import { FetchError } from './FetchError';

const URL_A = 'https://cdn.example/package/abc';

it('reads the message out of a JSON error body', () => {
  const text = JSON.stringify({ status: 502, message: 'npm registry answered 503', details: 'RequestErrorStatus' });
  const error = new FetchError({ status: 502, statusText: 'Bad Gateway', url: URL_A }, text);
  expect(error.message).toBe('Fetch failed with status 502 Bad Gateway for ' + URL_A + ': npm registry answered 503');
  expect(error.serviceMessage).toBe('npm registry answered 503');
  expect(error.text).toBe(text);
});

it.each(['', '<html><body>502 Bad Gateway</body></html>', '"just a string"', '{"message":42}', 'null'])(
  'adds nothing for a body without one (%j)',
  (text) => {
    // statusText is empty under HTTP/2.
    const error = new FetchError({ status: 502, statusText: '', url: URL_A }, text);
    expect(error.message).toBe('Fetch failed with status 502 for ' + URL_A);
    expect(error.serviceMessage).toBeUndefined();
  },
);

it('puts what was being fetched in front of the URL', () => {
  const error = new FetchError({ status: 404, statusText: '', url: URL_A }, '', { subject: 'react@19.1.0 (entry .)' });
  expect(error.message).toBe('Fetch failed with status 404 for react@19.1.0 (entry .) (' + URL_A + ')');
});

it('describes a failure that has no response', () => {
  const none = { status: 0, statusText: '', url: URL_A };
  const cause = new TypeError('Failed to fetch');
  const network = new FetchError(none, '', { failure: 'network', cause, attempts: 6 });
  expect(network.message).toBe('Network request failed for ' + URL_A + ': Failed to fetch (after 6 attempts)');
  expect(network.cause).toBe(cause);
  expect(new FetchError(none, '', { failure: 'timeout', timeoutMs: 30000 }).message).toBe(
    'Request timed out after 30000 ms for ' + URL_A,
  );
  expect(new FetchError(none, '', { failure: 'body', cause: new RangeError('Insufficient data') }).message).toBe(
    'Unreadable response body for ' + URL_A + ': Insufficient data',
  );
});

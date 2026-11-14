import { readBootNonce } from './bootNonce';

function fakeWindow(href: string) {
  const win = {
    location: { href },
    history: {
      state: { kept: true },
      replaceState: jest.fn((_state: unknown, _title: string, url: string) => {
        win.location.href = url;
      }),
    },
  };
  return win;
}

describe('readBootNonce', () => {
  it('returns the nonce and takes it off the URL, keeping the rest', () => {
    const win = fakeWindow('https://app.example/sandpack/index.html?x=1&sandpack-boot=abc123#top');
    expect(readBootNonce(win as unknown as Window)).toEqual({ boot: 'abc123' });
    expect(win.location.href).toBe('https://app.example/sandpack/index.html?x=1#top');
    expect(win.history.replaceState).toHaveBeenCalledWith({ kept: true }, '', win.location.href);
  });

  it('returns nothing for a page loaded without one', () => {
    const win = fakeWindow('https://app.example/sandpack/index.html');
    expect(readBootNonce(win as unknown as Window)).toEqual({});
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });

  it('still reports the nonce when the URL cannot be rewritten', () => {
    const win = fakeWindow('https://app.example/?sandpack-boot=n1');
    win.history.replaceState.mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(readBootNonce(win as unknown as Window)).toEqual({ boot: 'n1' });
  });
});

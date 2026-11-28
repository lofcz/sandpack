// The bundler page as the host sees it: every way a build can end without
// succeeding must reach the host as the messages a compile error sends, or the
// host waits out its stall timer for an error that already happened.

interface Posted {
  type: string;
  [key: string]: unknown;
}

type MessageListener = (event: { source: unknown; data: unknown; ports?: unknown[] }) => void;

const g = globalThis as Record<string, any>;
const posted: Posted[] = [];
const messageListeners: MessageListener[] = [];

/** Deliver a message the way the host window does. */
const fromHost = (data: Record<string, unknown>, ports: unknown[] = []) =>
  messageListeners.forEach((listener) => listener({ source: g.parent, data, ports }));

const settle = async (turns = 20) => {
  for (let turn = 0; turn < turns; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const errorsShown = () => posted.filter((message) => message.type === 'action' && message.action === 'show-error');
const typesSince = (index: number) => posted.slice(index).map((message) => message.type);

let instance: Record<string, any>;

beforeAll(() => {
  rs.spyOn(console, 'error').mockImplementation(() => {});
  rs.spyOn(console, 'log').mockImplementation(() => {});
  rs.spyOn(console, 'debug').mockImplementation(() => {});
  g.window = g;
  g.parent = { postMessage: (message: Posted) => posted.push(message) };
  g.addEventListener = (type: string, listener: MessageListener) => {
    if (type === 'message') messageListeners.push(listener);
  };
  g.removeEventListener = () => {};
  // A sandboxed frame: a real URL, an opaque origin.
  g.location = { href: 'https://preview.example/index.html', origin: 'null', reload() {} };
  g.history = { state: null, replaceState() {} };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./index');
  instance = g.sandpack;
});

afterAll(() => {
  rs.restoreAllMocks();
});

describe('a build that fails outside compile and evaluation', () => {
  const bundler = (overrides: Record<string, unknown>) => ({
    isFirstLoad: true,
    isReloading: false,
    initPreset: () => Promise.resolve(),
    compile: () => Promise.resolve(() => {}),
    replaceHTML: () => Promise.resolve(),
    ...overrides,
  });

  it('reports a preset that cannot be set up', async () => {
    const before = posted.length;
    instance.bundler = bundler({ initPreset: () => Promise.reject(new Error('The Babel worker port never arrived')) });

    await instance.runCompile();

    expect(errorsShown().pop()).toMatchObject({ title: 'Build failed', message: 'The Babel worker port never arrived' });
    expect(typesSince(before)).toEqual(['start', 'status', 'action', 'done', 'status']);
    expect(posted[posted.length - 2]).toMatchObject({ type: 'done', compilatonError: true });
  });

  it('reports an HTML entry that cannot be applied', async () => {
    const before = posted.length;
    instance.bundler = bundler({ replaceHTML: () => Promise.reject(new Error('index.html could not be read')) });

    await instance.runCompile();

    expect(errorsShown().pop()).toMatchObject({ message: 'index.html could not be read' });
    expect(typesSince(before).slice(-3)).toEqual(['action', 'done', 'status']);
    expect(posted[posted.length - 2]).toMatchObject({ type: 'done', compilatonError: true });
    expect(typesSince(before)).not.toContain('success');
  });

  it('says what was thrown when it is not an error', async () => {
    instance.bundler = bundler({ compile: () => Promise.reject({ code: 'E_PORT', detail: 'closed' }) });

    await instance.runCompile();

    expect(errorsShown().pop()).toMatchObject({ title: 'Build failed', message: '{"code":"E_PORT","detail":"closed"}' });
    expect(posted[posted.length - 2]).toMatchObject({ type: 'done', compilatonError: true });
  });

  it('keeps the location of a compile error', async () => {
    const compileError = Object.assign(new Error('Unexpected token (3:7)'), {
      title: 'Compilation error',
      path: '/app/src/App.tsx',
      line: 3,
      column: 7,
    });
    instance.bundler = bundler({ compile: () => Promise.reject(compileError) });

    await instance.runCompile();

    expect(errorsShown().pop()).toMatchObject({
      title: 'Compilation error',
      message: 'Unexpected token (3:7)',
      path: '/app/src/App.tsx',
      line: 3,
      column: 7,
    });
  });
});

describe('a boot that fails', () => {
  it('ends the build the host is waiting for, and says so again after every change', async () => {
    const before = posted.length;
    // What arrives as the filesystem port cannot be mounted: ZenFS rejects it.
    const unusablePort = { start() {} };
    fromHost({ type: 'register-frame', id: 7, template: 'create-react-app' }, [unusablePort]);
    const bootError: Error = await instance.readyPromise.then(
      () => new Error('the boot did not fail'),
      (error: Error) => error
    );
    await settle();

    const shown = errorsShown().pop();
    expect(bootError.message).not.toBe('the boot did not fail');
    expect(shown).toMatchObject({ title: 'Preview failed to start', message: bootError.message, $id: 7 });
    expect(typesSince(before).slice(-4)).toEqual(['start', 'action', 'done', 'status']);
    expect(posted[posted.length - 2]).toMatchObject({ type: 'done', compilatonError: true });

    // An edit opens a new build on the host: it must not wait for one that cannot run.
    const beforeChange = posted.length;
    fromHost({ type: 'fs-change', codesandbox: true, $id: 7, paths: ['/src/App.tsx'] });
    await settle();
    expect(typesSince(beforeChange)).toEqual(['start', 'action', 'done', 'status']);
    expect(posted[beforeChange + 1]).toMatchObject({ action: 'show-error', message: bootError.message });
  });
});

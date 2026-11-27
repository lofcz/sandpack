import { createBundlerHarness, installEvalGlobals, type BundlerHarness } from '../bundler/testHarness/bundlerHarness';
import { getStackFrames } from './get-stack-frames';
import { modulePathOfSourceURL, moduleSourceURL } from './source-url';

const FIXTURE: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'error-location-fixture', main: 'src/main' }),
  'index.html': '<!doctype html><div id="root"></div>',
  'src/main.ts': [
    "import { explode } from './widgets/explode';",
    '(globalThis as Record<string, unknown>).__explode = explode;',
    'export default 1;',
  ].join('\n'),
  'src/widgets/explode.ts': [
    'interface Options {',
    '  label: string;',
    '}',
    '',
    'export function explode(options: Options): never {',
    '  const label: string = options.label;',
    '  throw new Error(`exploded: ${label}`);',
    '}',
  ].join('\n'),
};

describe('runtime error locations in the opaque-origin preview frame', () => {
  let h: BundlerHarness;
  let restore: () => void;

  beforeAll(async () => {
    restore = installEvalGlobals();
    // A sandboxed frame without allow-same-origin: the URL is real, the origin is not.
    Object.assign((globalThis as unknown as { location: object }).location, {
      href: 'https://preview.example/sandbox/index.html',
      origin: 'null',
    });
    h = await createBundlerHarness(FIXTURE, { forCompile: true });
    const evaluate = await h.bundler.compile();
    (evaluate as () => unknown)();
  }, 60000);

  afterAll(async () => {
    delete (globalThis as Record<string, unknown>).__explode;
    await h.teardown();
    restore();
  });

  it('maps an error thrown in an evaluated module to its file and line', async () => {
    let thrown: Error | undefined;
    try {
      (globalThis as unknown as { __explode: (options: { label: string }) => never }).__explode({ label: 'now' });
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toBe('exploded: now');

    const frames = await getStackFrames(h.bundler, thrown as Error);
    const frame = frames?.[0];
    expect(frame?._originalFileName).toBe('/app/src/widgets/explode.ts');
    expect(frame?._originalLineNumber).toBe(7);
    expect(frame?._originalScriptCode?.find((line) => line.highlight)?.content).toContain('throw new Error');
  });
});

describe('module sourceURLs', () => {
  it('round-trips a module path without reading the page location', () => {
    for (const path of ['/app/src/App.tsx', '/app/src/my component (copy).tsx', '/node_modules/@scope/pkg/index.js']) {
      const url = moduleSourceURL(path);
      expect(url).not.toMatch(/\s/);
      expect(modulePathOfSourceURL(url)).toBe(path);
    }
  });

  it('does not take other scripts for modules', () => {
    expect(modulePathOfSourceURL('https://preview.example/sandbox/index.4f2a.js')).toBeNull();
    expect(modulePathOfSourceURL('null/app/src/App.tsx')).toBeNull();
    expect(modulePathOfSourceURL('<anonymous>')).toBeNull();
  });
});

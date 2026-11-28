import evaluate, { getBrowserProcess } from './eval';
import { awaitsAtTopLevel } from './topLevelAwait';

const run = (code: string, exports: any = {}, require: (specifier: string) => unknown = () => undefined) =>
  evaluate(code, require, { id: '/node_modules/pkg/index.js', exports });

describe('the module wrapper', () => {
  beforeEach(() => {
    rs.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    rs.restoreAllMocks();
  });

  it('lets a module declare the names that are globals in Node', () => {
    // readable-stream 4 and commander start their files this way.
    const mine = { nextTick: 'mine' };
    const exports = run(
      `const process = require('process/');
       let global = 'my global';
       class Buffer {}
       const setImmediate = 1, clearImmediate = 2, swcHelpers = 3;
       module.exports = { process, global, Buffer: typeof Buffer, setImmediate, clearImmediate, swcHelpers };`,
      {},
      () => mine,
    );
    expect(exports).toEqual({ process: mine, global: 'my global', Buffer: 'function', setImmediate: 1, clearImmediate: 2, swcHelpers: 3 });
  });

  it('declares a hoisted var of such a name as Node does: it is the module\'s own, undefined until assigned', () => {
    expect(run(`var before = typeof process; var process = { mine: true }; module.exports = { before, after: process };`)).toEqual({
      before: 'undefined',
      after: { mine: true },
    });
  });

  it('keeps module, exports and require the parameters of the module function, as in Node', () => {
    // A var of a parameter's name is that parameter, so this must still export.
    expect(run(`var exports = exports || {}; var module = module || {}; exports.kept = typeof require;`)).toEqual({ kept: 'function' });
  });

  it('makes top-level this the module\'s exports', () => {
    // libtess: `this.libtess = …; module.exports = this.libtess`.
    expect(run(`this.libtess = { tessellate: true }; if (typeof module !== 'undefined') { module.exports = this.libtess; }`)).toEqual({ tessellate: true });
    const exports = {};
    expect(run(`module.exports.same = this === exports && this === module.exports;`, exports)).toEqual({ same: true });
    expect((globalThis as Record<string, unknown>).libtess).toBeUndefined();
  });

  it('keeps a "use strict" directive in force and a sloppy module sloppy', () => {
    expect(run(`"use strict"; module.exports = (function () { return this; })();`)).toBeUndefined();
    expect(run(`module.exports = (function () { return typeof this; })();`)).toBe('object');
  });

  it('provides what webpack 5 gives a browser build for __dirname and __filename, and setImmediate', async () => {
    const seen: unknown[] = [];
    const exports = evaluate(
      `var cancelled = setImmediate(function () { seen.push('cancelled'); });
       clearImmediate(cancelled);
       setImmediate(function (a, b) { seen.push(a + b); }, 1, 2);
       module.exports = { __dirname, __filename };`,
      () => undefined,
      { id: '/node_modules/pkg/lib/deep.js', exports: {} },
      {},
      { seen },
    );
    expect(exports).toEqual({ __dirname: '/', __filename: '/index.js' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(seen).toEqual([3]);
  });

  it('adds no line before the code: an error is on the line it was thrown from', () => {
    let stack = '';
    try {
      run(`var a = 1;\nvar b = 2;\nthrow new Error('third line');\n//# sourceURL=sandpack:///node_modules/pkg/index.js`);
    } catch (error) {
      stack = (error as Error).stack ?? '';
    }
    expect(stack).toMatch(/sandpack:\/\/\/node_modules\/pkg\/index\.js:3:\d+/);
  });

  it('reports top-level await as unsupported, naming the file', () => {
    // What Babel leaves of `const data = await load()` in an ES module.
    const code = `"use strict";\nconst data = await Promise.resolve(1);\nexports.default = data;`;
    let error: any;
    try {
      evaluate(code, () => undefined, { id: '/app/src/App.tsx', exports: {} });
    } catch (thrown) {
      error = thrown;
    }
    expect(error.message).toBe(
      'Top-level await is not supported: /app/src/App.tsx uses `await` outside a function. Move that code into an async function and call it.',
    );
    expect(error.path).toBe('/app/src/App.tsx');
    expect(error.title).toBe('Top-level await is not supported');
  });

  it('leaves any other syntax error as it is', () => {
    expect(() => run(`const a = ;`)).toThrow(SyntaxError);
  });

  it('finds an await only outside functions', () => {
    expect(awaitsAtTopLevel(`const a = await b;`)).toBe(true);
    expect(awaitsAtTopLevel(`for await (const x of y) {}`)).toBe(true);
    expect(awaitsAtTopLevel(`if (a) { try { await b; } catch (e) {} }`)).toBe(true);
    expect(awaitsAtTopLevel(`async function f() { await b; } const g = async () => { for await (const x of y) {} }; class C { async m() { await b; } }`)).toBe(false);
    expect(awaitsAtTopLevel(`const text = "await b"; // await c`)).toBe(false);
  });
});

describe('module evaluation', () => {
  it('gives modules a browser process with the methods packages call', () => {
    const warn = rs.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // three 0.187's CommonJS entry warns before re-exporting the ES module.
      const exports = evaluate(
        "process.emitWarning('The CommonJS build of three is deprecated.', 'DeprecationWarning'); module.exports = { env: process.env.NODE_ENV, browser: process.browser, cwd: process.cwd() };",
        () => undefined,
        { id: '/node_modules/three/build/three.cjs', exports: {} }
      );
      expect(exports).toEqual({ env: 'development', browser: true, cwd: '/' });
      expect(warn).toHaveBeenCalledWith('DeprecationWarning: The CommonJS build of three is deprecated.');
    } finally {
      warn.mockRestore();
    }
  });

  it('shares one process between modules and runs nextTick callbacks', async () => {
    evaluate("process.env.SHARED_FLAG = 'on';", () => undefined, { id: '/a.js', exports: {} });
    const seen: unknown[] = [];
    evaluate('process.nextTick(function (value) { seen.push(value); }, 42);', () => undefined, { id: '/b.js', exports: {} }, {}, { seen });
    expect(getBrowserProcess().env.SHARED_FLAG).toBe('on');
    await Promise.resolve();
    expect(seen).toEqual([42]);
    delete getBrowserProcess().env.SHARED_FLAG;
  });
});

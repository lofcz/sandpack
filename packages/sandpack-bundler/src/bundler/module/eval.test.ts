import evaluate, { getBrowserProcess } from './eval';

describe('module evaluation', () => {
  it('gives modules a browser process with the methods packages call', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
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

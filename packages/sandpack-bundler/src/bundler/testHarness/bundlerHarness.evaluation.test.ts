import { createBundlerHarness, installEvalGlobals } from './bundlerHarness';
import { Module } from '../module/Module';

let h: Awaited<ReturnType<typeof createBundlerHarness>>;
let restore: () => void;
beforeAll(async () => {
  restore = installEvalGlobals();
  h = await createBundlerHarness({
    'package.json': JSON.stringify({ main: 'main.ts' }),
    'index.html': '<!doctype html><div id="root"></div>',
    'main.ts': 'globalThis.__cycleResult = require("./a");',
    'a.ts': 'exports.ready = false; exports.self = require("./a") === exports; const b = require("./b"); exports.seen = b.seen; exports.ready = true;',
    'b.ts': 'exports.seen = require("./a").ready;',
    'value.ts': 'export default 42;',
    'data.json': '{"answer":42,"__proto__":{"inherited":true}}',
    'invalid.json': '{broken',
  }, { forCompile: true });
}, 60000);
afterAll(async () => {
  delete (globalThis as any).__cycleResult;
  await h.teardown();
  restore();
});

it('publishes CommonJS exports before executing a cycle and evaluates each module once', async () => {
  const run = await h.bundler.compile();
  expect(run).not.toBeNull();
  run!();
  expect((globalThis as any).__cycleResult).toEqual({ ready: true, self: true, seen: false });
});

it('dynamically imports a compiled module that has not yet been evaluated', async () => {
  const target = await h.bundler.transformModule('/app/value.ts');
  expect(target.evaluation).toBeNull();
  const importer = new Module('/app/main.ts', '', true, h.bundler);
  await expect(importer.evaluate().context.dynamicImport('./value')).resolves.toBe(42);
});

it('imports JSON data without changing __proto__ into an object prototype', async () => {
  const module = await h.bundler.transformModule('/app/data.json');
  await h.bundler.moduleFinishedPromise('/app/data.json');
  const value = module.evaluate().context.exports;
  expect(value.answer).toBe(42);
  expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(true);
  expect(value.inherited).toBeUndefined();
  await h.bundler.transformModule('/app/invalid.json');
  await expect(h.bundler.moduleFinishedPromise('/app/invalid.json')).rejects.toThrow();
});

it('preserves reassigned and null CommonJS exports, and clears failed evaluations for retry', async () => {
  const a = new Module('/app/a.js', 'module.exports = { name: "a" }; module.exports.b = require("b");', true, h.bundler);
  const b = new Module('/app/b.js', 'module.exports = require("a");', true, h.bundler);
  h.bundler.modules.set(a.filepath, a); h.bundler.modules.set(b.filepath, b);
  a.dependencyMap.set('b', b.filepath); b.dependencyMap.set('a', a.filepath);
  const result = a.evaluate().context.exports;
  expect(result.b).toBe(result);
  expect(a.evaluate().context.exports).toBe(result);

  const failed = new Module('/app/fail.js', 'throw new Error("once");', true, h.bundler);
  expect(() => failed.evaluate()).toThrow('once');
  expect(failed.evaluation).toBeNull();
  expect(h.bundler.evaluationStack).toEqual([]);
  failed.compiled = 'module.exports = null;';
  h.bundler.modules.set(failed.filepath, failed);
  a.dependencyMap.set('null', failed.filepath);
  expect(a.evaluate().require('null')).toBeNull();
});

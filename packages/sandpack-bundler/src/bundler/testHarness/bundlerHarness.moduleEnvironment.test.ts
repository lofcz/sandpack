import { fs, mounts } from '@zenfs/core';

import { fetchManifest, fetchModule, fetchModuleEntries, type ICDNModule } from '../module-registry/module-cdn';
import { createBundlerHarness, installEvalGlobals, type BundlerHarness } from './bundlerHarness';

jest.mock('../module-registry/module-cdn', () => ({
  ...jest.requireActual('../module-registry/module-cdn'),
  fetchManifest: jest.fn(),
  fetchModule: jest.fn(),
  fetchModuleEntries: jest.fn(),
}));

const manifest = fetchManifest as jest.MockedFunction<typeof fetchManifest>;
const download = fetchModule as jest.MockedFunction<typeof fetchModule>;

/** A CDN package: its package.json fields, the files it inlines, the packages its code uses. */
interface Package {
  manifest?: Record<string, unknown>;
  files: ICDNModule['f'];
  uses?: string[];
}

const compiled = (code: string, d: string[] = []) => ({ c: code, d, t: true });
const raw = (code: string) => ({ c: code, d: [], t: false });
// A stand-in for an npm implementation of a Node built-in: it says which package it is.
const named = (name: string): Package => ({
  files: { 'index.js': compiled(`module.exports = { implementation: ${JSON.stringify(name)} };`) },
});

const packages: Record<string, Package> = {
  // import.meta in a package file.
  located: {
    files: {
      'lib/where.js': compiled('module.exports = $ir_import_meta.url;'),
      'index.js': compiled('module.exports = require("./lib/where.js");', ['./lib/where.js']),
    },
  },
  // Browser implementations of Node built-ins.
  'path-browserify': named('path-browserify'),
  'stream-browserify': named('stream-browserify'),
  events: named('events'),
  'os-browserify': { files: { 'browser.js': compiled('module.exports = { implementation: "os-browserify/browser" };') } },
  // An npm package that merely carries a built-in's name: never what loads.
  stream: named('the npm package named stream'),
  // A package the app declares under a built-in's name: the app's choice.
  querystring: { files: { 'index.js': compiled('module.exports = { mine: true };') } },
  // As the CDN serves a file today: `stream` is listed as a used package, `node:path` and `node:tls` are not listed at all.
  streams: {
    files: {
      'index.js': compiled(
        'var s = require("stream"), p = require("node:path"), tls = require("node:tls"); module.exports = { stream: s.implementation, path: p.implementation, tls: tls };',
        ['stream'],
      ),
    },
    uses: ['stream'],
  },
  // Dependencies that do not link.
  guarded: {
    files: {
      'index.js': compiled(
        `var optional; try { optional = require("ghost"); } catch (error) { optional = { code: error.code, message: error.message }; }
         module.exports = { optional: optional, load: function () { return require("phantom"); }, peer: function () { return require("late-peer"); }, where: function () { return require.resolve("./index.js"); } };`,
        ['ghost', 'phantom', 'late-peer', './index.js'],
      ),
    },
  },
  // Files the CDN did not compile: the bundler collects their requires itself.
  rawGuarded: {
    files: { 'index.js': raw('var fast; try { fast = require("native-addon"); } catch (e) { fast = null; } module.exports = { fast: fast };') },
  },
  rawImporter: {
    manifest: {
      dependencies: { helper: '^2.0.0' },
      peerDependencies: { 'optional-peer': '*' },
      peerDependenciesMeta: { 'optional-peer': { optional: true } },
    },
    files: {
      'index.js': raw('var peer = null; try { peer = require("optional-peer"); } catch (e) {} module.exports = { helper: require("helper"), peer: peer };'),
    },
  },
  helper: { files: { 'index.js': compiled('module.exports = "helper";') } },
  'optional-peer': { files: { 'index.js': compiled('module.exports = "peer";') } },
  '@scope/a': named('@scope/a'),
  '@scope/b': named('@scope/b'),
  '@scope/c': named('@scope/c'),
};

const MAIN = `
import where from 'located';
import path from 'path';
import { implementation as events } from 'node:events';
import os from 'os';
import proc from 'process';
import nodeProc from 'node:process';
import * as childProcess from 'child_process';
import net from 'node:net';
import fs from 'fs';
import later from 'node:some_future_builtin';
import querystring from 'querystring';
import streams from 'streams';
import guarded from 'guarded';
import rawGuarded from 'rawGuarded';
import rawImporter from 'rawImporter';
import computed from './computed';

let accepted = false;
if (import.meta.hot) { import.meta.hot.accept(); import.meta.hot.on('vite:beforeUpdate', () => {}); accepted = true; }

(globalThis as any).__moduleEnvironment = {
  meta: { where, url: import.meta.url, env: import.meta.env, dev: import.meta.env.DEV, accepted },
  builtins: {
    path: path.implementation, events, os: os.implementation,
    sameProcess: proc === process && nodeProc === process,
    childProcess: typeof childProcess.spawn, net: Object.keys(net), netType: typeof net, fs: typeof fs, later: typeof later,
  },
  querystring, streams, guarded, rawGuarded, rawImporter, computed,
};
`;

// The collector sees a require() whose specifier it cannot know.
const COMPUTED = `
declare const require: (name: string) => unknown;
const load = (name: string) => require(name);
let message = '';
try { load('./nowhere'); } catch (error) { message = (error as Error).message; }
export default { message, builtin: load('node:worker_threads') };
`;

jest.setTimeout(30000);

describe('what a module sees when it runs', () => {
  let h: BundlerHarness;
  let restore: () => void;
  let silenced: jest.SpyInstance[] = [];
  let env: Record<string, any>;
  // Every /dep_tree request of the build: [deps, entries].
  let requests: Array<[Record<string, string>, Record<string, string[]> | undefined]>;

  // One build for every case: the Babel loopback connects once per test file.
  beforeAll(async () => {
    restore = installEvalGlobals();
    silenced = (['log', 'info', 'warn', 'error', 'groupCollapsed'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation(() => {}),
    );
    manifest.mockImplementation(async (deps, _pins, entries) =>
      Object.keys(deps)
        .filter((n) => packages[n])
        .map((n) => ({ n, v: '1.0.0', d: 0, e: entries?.[n] })),
    );
    download.mockImplementation(async (name) => {
      const found = packages[name];
      if (!found) throw new Error(`no such package: ${name}`);
      return {
        f: { 'package.json': raw(JSON.stringify({ name, main: 'index.js', ...found.manifest })), ...found.files },
        m: found.uses ?? [],
      };
    });
    (fetchModuleEntries as jest.MockedFunction<typeof fetchModuleEntries>).mockImplementation((name, version, entries) =>
      download(name, version, entries),
    );
    const declared = Object.fromEntries(
      ['located', 'streams', 'guarded', 'rawGuarded', 'rawImporter', 'late-peer'].map((name) => [name, '1.0.0']),
    );
    h = await createBundlerHarness(
      {
        'package.json': JSON.stringify({ main: 'src/main', dependencies: { ...declared, querystring: '^5.0.0' } }),
        'index.html': '<!doctype html><div id="root"></div>',
        'src/main.ts': MAIN,
        'src/computed.ts': COMPUTED,
      },
      { forCompile: true },
    );
    const evaluate = await h.bundler.compile();
    expect(evaluate).not.toBeNull();
    evaluate!();
    env = (globalThis as Record<string, any>).__moduleEnvironment;
    requests = manifest.mock.calls.map(([deps, , entries]) => [deps, entries]);
  });

  afterAll(async () => {
    for (const spy of silenced) spy.mockRestore();
    await h?.teardown();
    restore();
    delete (globalThis as Record<string, unknown>).__moduleEnvironment;
  });

  const requested = () => Object.assign({}, ...requests.map(([deps]) => deps)) as Record<string, string>;

  it('gives import.meta the Vite dev environment, the hot context, and a fetchable URL in a package', () => {
    expect(env.meta).toEqual({
      // A real, CORS-readable address: the file of the npm release.
      where: 'https://unpkg.com/located@1.0.0/lib/where.js',
      url: 'http://localhost/app/src/main.ts',
      env: { MODE: 'development', DEV: true, PROD: false, SSR: false, BASE_URL: '/' },
      dev: true,
      accepted: true,
    });
  });

  it('resolves Node built-ins, with or without node:, to browser implementations installed with the boot request', () => {
    expect(env.builtins).toEqual({
      path: 'path-browserify',
      events: 'events',
      os: 'os-browserify/browser',
      sameProcess: true,
      // Server-only modules are an empty object: properties read off them are undefined.
      childProcess: 'undefined',
      net: [],
      netType: 'object',
      fs: 'object',
      later: 'object',
    });
    // The first request, at the pinned versions; nothing is installed for what the bundler provides.
    const [boot, entries] = requests[0];
    expect(boot).toMatchObject({ 'path-browserify': '1.0.1', events: '3.3.0', 'os-browserify': '0.3.0' });
    expect(entries).toMatchObject({ 'os-browserify': ['./browser'] });
    for (const name of ['path', 'os', 'process', 'fs', 'child_process', 'net']) expect(requested()).not.toHaveProperty(name);
  });

  it('lets a package the app declares win over the built-in of the same name', () => {
    expect(env.querystring).toEqual({ mine: true });
    expect(requested()).toMatchObject({ querystring: '^5.0.0' });
    expect(requested()).not.toHaveProperty('querystring-es3');
  });

  it('links the built-ins a CDN package requires, including the node: ones its dependency list leaves out', () => {
    expect(env.streams).toEqual({ stream: 'stream-browserify', path: 'path-browserify', tls: {} });
    expect(requested()).toMatchObject({ 'stream-browserify': '3.0.0' });
    expect(requested()).not.toHaveProperty('stream');
  });

  it('keeps why a dependency did not link, and throws it only when the require runs', () => {
    // A guarded require sees Node's error shape, with the specifier, the importer and the reason.
    expect(env.guarded.optional.code).toBe('MODULE_NOT_FOUND');
    expect(env.guarded.optional.message).toBe(
      `Cannot load "ghost" required by "/node_modules/guarded/index.js": Cannot find module 'ghost' from '/node_modules/guarded/index.js'`,
    );
    expect(() => env.guarded.load()).toThrow(
      /Cannot load "phantom" required by "\/node_modules\/guarded\/index\.js": Cannot find module 'phantom'/,
    );
    expect(env.guarded.where()).toBe('/node_modules/guarded/index.js');
  });

  it('builds a package file compiled here although a guarded require of it cannot resolve', () => {
    expect(env.rawGuarded).toEqual({ fast: null });
  });

  it('installs what a package file compiled here imports, at the range its package declares', () => {
    // An optional peer may be absent, as with npm.
    expect(env.rawImporter).toEqual({ helper: 'helper', peer: null });
    expect(requested()).toMatchObject({ helper: '^2.0.0' });
    expect(requested()).not.toHaveProperty('optional-peer');
  });

  it('builds a module whose require() specifier is not a literal, and says so when it runs', () => {
    expect(env.computed.message).toMatch(
      /^Cannot load ".\/nowhere" required by "\/app\/src\/computed\.ts": it was not resolved when the module was built/,
    );
    // A built-in the bundler provides needs no build step.
    expect(env.computed.builtin).toEqual({});
  });

  it('links again after a later install what an earlier one could not', async () => {
    expect(() => env.guarded.peer()).toThrow(/Cannot load "late-peer"/);
    packages['late-peer'] = { files: { 'index.js': compiled('module.exports = "peer";') } };
    await h.bundler.moduleRegistry.ensurePackages(['late-peer']);
    await h.bundler.moduleFinishedPromise('/node_modules/guarded/index.js');
    expect(env.guarded.peer()).toBe('peer');
  });

  it('reads a package file without writing anything', async () => {
    const names = ['@scope/a', '@scope/b', '@scope/c'];
    for (const name of names) await h.bundler.moduleRegistry.fetchNodeModule(name, '1.0.0');
    const reads = await Promise.allSettled(
      names.map((name) => fs.promises.readFile(`/node_modules/${name}/package.json`, 'utf8')),
    );
    expect(reads.map((read) => read.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
    // A read that updates the access time is a write to a copy-on-write mount:
    // the file is copied up, and the first reads below one directory (the
    // packages of a scope) race to create it there. The loser failed with
    // EEXIST and its package.json was taken for absent.
    const writable = (mounts.get('/node_modules') as unknown as { writable: { exists(path: string): Promise<boolean> } }).writable;
    for (const name of names) expect(await writable.exists(`/${name}/package.json`)).toBe(false);
    expect(await writable.exists('/@scope')).toBe(false);
  });
});

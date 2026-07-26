// Phase 01 exit harness (R3-149): the prebuilt classic Babel worker
// (`worker/babel-worker.js`), spawned as a classic worker, answers a `transform`
// request over the MessagePort transport with real compiled output.
//
// A classic Web Worker can't run under node:worker_threads directly (different API:
// `self`/`importScripts`/`MessagePort`), so we evaluate the bundle in a vm context
// that shims those globals, deliver the `{type:'connect'}` handshake with a
// node MessagePort, and speak the WorkerMessageBus wire protocol from the parent side.
//
// Run via `npm run test:worker` (which builds dist + the worker first). Not named
// `*.test.mjs` so it stays out of the golden `node --test test/*.test.mjs` run,
// which must not depend on the esbuild worker build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';

import { compileMdx } from '../dist/index.js';
import { CORPUS } from './corpus.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = resolve(HERE, '..', 'worker');
const FIXTURES_DIR = join(HERE, 'fixtures');
const ENTRY = join(WORKER_DIR, 'babel-worker.js');
const CHANNEL = 'sandpack-babel';

function loadWorker() {
  const listeners = { message: [], error: [] };
  const context = {
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    TextEncoder,
    TextDecoder,
    URL,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    performance,
    process,
  };
  context.globalThis = context;
  context.self = context;
  context.window = context;
  context.global = context;
  context.importScripts = (...urls) => {
    for (const u of urls) {
      const p = resolve(WORKER_DIR, u.toString().replace(/^.*\//, ''));
      vm.runInContext(readFileSync(p, 'utf8'), context, { filename: p });
    }
  };
  context.addEventListener = (type, cb) => {
    (listeners[type] ||= []).push(cb);
  };
  context.removeEventListener = (type, cb) => {
    const a = listeners[type] || [];
    const i = a.indexOf(cb);
    if (i >= 0) a.splice(i, 1);
  };
  context.postMessage = () => {};
  vm.createContext(context);
  vm.runInContext(readFileSync(ENTRY, 'utf8'), context, { filename: ENTRY });
  return listeners;
}

function adapt(port) {
  return {
    postMessage: (msg) => port.postMessage(msg),
    addEventListener: (type, cb) => {
      if (type === 'message') port.on('message', (data) => cb({ data }));
      if (type === 'error') port.on('messageerror', (e) => cb(e));
    },
    removeEventListener: () => {},
    start: () => port.start(),
  };
}

// Spawn the classic worker in the vm shim, complete the handshake, and return a
// `{ request, close }` pair that speaks the WorkerMessageBus wire protocol.
function openWorker() {
  assert.ok(
    existsSync(ENTRY),
    `worker bundle missing at ${ENTRY} — run "npm run build:worker" first`,
  );

  const listeners = loadWorker();
  const { port1: parentPort, port2: workerPort } = new MessageChannel();

  // deliver the one-time connect handshake carrying the worker's port
  for (const cb of listeners.message.slice()) {
    cb({ data: { type: 'connect' }, ports: [adapt(workerPort)] });
  }

  parentPort.start();
  let msgId = 0;
  const request = (method, ...params) =>
    new Promise((res, rej) => {
      const id = ++msgId;
      const to = setTimeout(() => rej(new Error('worker request timed out')), 20000);
      const onMsg = (data) => {
        if (data && data.channel === CHANNEL && data.id === id) {
          parentPort.off('message', onMsg);
          clearTimeout(to);
          if (data.error) rej(Object.assign(new Error(data.error.message), data.error));
          else res(data.result);
        }
      };
      parentPort.on('message', onMsg);
      parentPort.postMessage({ channel: CHANNEL, id, method, params });
    });

  return { request, close: () => parentPort.close() };
}

test('prebuilt classic worker compiles TS+JSX and collects deps over the MessagePort', async () => {
  const { request, close } = openWorker();

  const SRC = `import {useState} from 'react';
export const Counter = (props: {start: number}) => {
  const [n, setN] = useState<number>(props.start);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
};
`;
  const result = await request('transform', {
    code: SRC,
    filepath: '/app/Counter.tsx',
    config: { presets: ['react'], plugins: [] },
  });

  const code = result?.code ?? '';
  const deps = result?.dependencies;
  const depsArr = deps instanceof Set ? [...deps] : Array.isArray(deps) ? deps : [];

  assert.ok(code.length > 0, 'worker returned empty code');
  assert.doesNotMatch(code, /:\s*number/, 'TypeScript annotations were not stripped');
  assert.match(code, /createElement|_jsx/, 'JSX was not compiled');
  assert.ok(depsArr.includes('react'), `dep collection failed (got ${JSON.stringify(depsArr)})`);

  close();
});

// R3-150: the worker now also answers `mdx-compile`. The whole point of moving the
// MDX compile into the worker is that the compiled bytes must be IDENTICAL to the
// in-process `compileMdx` the CLI runs (MDX_CONTENT_COLLECTIONS_SPEC §1.1) — and it
// must run in a DOM-free worker (the reason it historically compiled in-iframe).
// The vm shim above provides NO `document`, so a regression to a DOM-using package
// variant (e.g. decode-named-character-reference's browser build) fails here.
test('worker `mdx-compile` is byte-identical to in-process compileMdx across the MDX corpus', async () => {
  const { request, close } = openWorker();
  const mdxCases = CORPUS.filter((c) => /\.mdx?$/.test(c.file));
  assert.ok(mdxCases.length >= 3, 'expected several MDX fixtures in the corpus');

  for (const c of mdxCases) {
    const source = readFileSync(join(FIXTURES_DIR, c.file), 'utf8');
    const [expected, viaWorker] = await Promise.all([
      compileMdx(source, c.path),
      request('mdx-compile', { code: source, path: c.path }),
    ]);
    assert.equal(viaWorker, expected, `worker mdx-compile drifted from compileMdx for ${c.id}`);
  }

  close();
});

test('worker `mdx-compile` surfaces a positioned error for malformed MDX', async () => {
  const { request, close } = openWorker();
  // An unterminated JSX expression — @mdx-js/mdx reports a line/column.
  await assert.rejects(
    () => request('mdx-compile', { code: '# ok\n\n<Broken\n', path: '/app/content/bad.mdx' }),
    (err) => {
      assert.ok(err instanceof Error);
      // line/column ride across the transport as own props (serializeError spread).
      assert.equal(typeof err.line, 'number', 'expected a line number on the error');
      return true;
    },
  );
  close();
});

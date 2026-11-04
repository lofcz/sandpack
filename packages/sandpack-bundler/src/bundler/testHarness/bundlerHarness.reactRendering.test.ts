/** @jest-environment jsdom */
import { readFileSync } from 'fs';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { decode } from '@msgpack/msgpack';

import { fetchManifest, fetchModule, fetchModuleEntries, type ICDNModule } from '../module-registry/module-cdn';
import { createBundlerHarness, type BundlerHarness } from './bundlerHarness';

jest.mock('../module-registry/module-cdn', () => ({
  ...jest.requireActual('../module-registry/module-cdn'),
  fetchManifest: jest.fn(),
  fetchModule: jest.fn(),
  fetchModuleEntries: jest.fn(),
}));

const versions: Record<string, string> = { react: '19.1.0', 'react-dom': '19.1.0', scheduler: '0.26.0' };
const packages = new Map(Object.entries(versions).map(([name, version]) => [name, decode(gunzipSync(
  readFileSync(join(__dirname, 'fixtures/react-cdn', `${name}-${version}.msgpack.gz`)),
)) as ICDNModule]));

const fixture = {
  'package.json': JSON.stringify({ main: 'src/main', dependencies: { react: '19.1.0', 'react-dom': '19.1.0' } }),
  'index.html': '<!doctype html><div id="root"></div>',
  'src/main.ts': [
    "import { createElement, useState } from 'react';",
    "import { createRoot } from 'react-dom/client';",
    'function Counter() {',
    '  const [count, setCount] = useState(0);',
    "  return createElement('button', { onClick: () => setCount(count + 1) }, String(count));",
    '}',
    "const root = createRoot(document.getElementById('root')!);",
    '(globalThis as any).__renderedRoot = root;',
    'root.render(createElement(Counter));',
  ].join('\n'),
};

async function waitForButton(text: string): Promise<HTMLButtonElement> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const button = document.querySelector('button');
    if (button?.textContent === text) return button;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Expected button ${text}; DOM: ${document.body.innerHTML}`);
}

it('boots real CDN React/React DOM, renders, and responds to a state-changing click', async () => {
  document.body.innerHTML = '<div id="root"></div>';
  (fetchManifest as jest.MockedFunction<typeof fetchManifest>).mockImplementation(async (deps, _pins, entries) =>
    Object.keys(deps).map(n => ({ n, v: versions[n] ?? '1.0.0', d: 0, e: entries?.[n] })),
  );
  (fetchModule as jest.MockedFunction<typeof fetchModule>).mockImplementation(async name => packages.get(name) ?? {
    f: {
      'package.json': { c: JSON.stringify({ name, main: 'index.js' }), d: [], t: true },
      'index.js': { c: 'module.exports = {};', d: [], t: true },
    },
    m: [],
  });
  (fetchModuleEntries as jest.MockedFunction<typeof fetchModuleEntries>).mockImplementation(
    (name, version, entries) => fetchModule(name, version, entries),
  );
  let h: BundlerHarness | undefined;
  try {
    h = await createBundlerHarness(fixture, { forCompile: true });
    const evaluate = await h.bundler.compile();
    expect(evaluate).not.toBeNull();
    evaluate!();
    const button = await waitForButton('0');
    button.click();
    expect(await waitForButton('1')).toBe(button);
    expect(h.bundler.getModule('/node_modules/react-dom/cjs/react-dom-client.development.js')?.dependencyMap.has('react')).toBe(true);
  } finally {
    const globals = globalThis as unknown as { __renderedRoot?: { unmount(): void } };
    globals.__renderedRoot?.unmount();
    delete globals.__renderedRoot;
    await h?.teardown();
    document.body.innerHTML = '';
  }
}, 60000);

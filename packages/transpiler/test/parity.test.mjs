// Byte-identity merge gate (PRETRANSPILED_ARTIFACTS_SPEC §4.4 [parity]).
//
// transformFile must reproduce the committed golden corpus byte-for-byte. The
// goldens were generated (scripts/gen-golden.mjs) from this package's chain,
// which is a verbatim move of the sandbox bundler's chain (babel-worker +
// react-refresh wrap + ReactPreset.mapTransformers config). A single byte of
// drift — a bumped @babel/standalone, a changed plugin option — fails here, by
// design: such drift silently strips HMR instrumentation or changes emitted
// modules under every cached repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transformFile } from '../dist/index.js';
import { CORPUS } from './corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const goldenDir = join(here, 'golden');
const manifest = JSON.parse(readFileSync(join(goldenDir, 'manifest.json'), 'utf8'));
const manifestById = new Map(manifest.map((e) => [e.id, e]));

for (const entry of CORPUS) {
  test(`parity: ${entry.id} (${entry.path})`, async () => {
    const code = readFileSync(join(fixturesDir, entry.file), 'utf8');
    const golden = readFileSync(join(goldenDir, `${entry.id}.out.js`), 'utf8');
    const result = await transformFile({ path: entry.path, code });
    assert.ok(!('error' in result), `transform errored: ${JSON.stringify(result)}`);
    assert.equal(result.code, golden, `emitted bytes drifted for ${entry.id}`);
    assert.deepEqual(result.deps, manifestById.get(entry.id).deps);
  });
}

test('parity: react-refresh variant carries HMR instrumentation', async () => {
  const code = readFileSync(join(fixturesDir, 'App.tsx'), 'utf8');
  const result = await transformFile({ path: '/app/src/App.tsx', code });
  assert.ok(!('error' in result));
  assert.match(result.code, /\$RefreshReg\$/);
  assert.match(result.code, /\$RefreshSig\$/);
  assert.match(result.code, /__csb_bust\/refresh-helper\.js/);
});

test('parity: plain variant has no HMR instrumentation', async () => {
  const code = readFileSync(join(fixturesDir, 'helpers.ts'), 'utf8');
  const result = await transformFile({ path: '/app/src/helpers.ts', code });
  assert.ok(!('error' in result));
  assert.doesNotMatch(result.code, /\$RefreshReg\$/);
  assert.doesNotMatch(result.code, /refresh-helper/);
});

#!/usr/bin/env node
/*
 * Regenerate the byte-identity golden corpus (PRETRANSPILED_ARTIFACTS_SPEC §4.4).
 * Runs every corpus fixture through the BUILT package's transformFile and writes
 * the emitted bytes to test/golden/<id>.out.js plus a manifest of deps. Commit
 * the result; parity.test.mjs asserts transformFile keeps reproducing it.
 *
 * Run `npm run build` first — this imports from dist/. Regenerating intentionally
 * (a deliberate toolchain bump) is the only time these files should change, and
 * the diff must be reviewed: it is the artifact every cached repo will execute.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transformFile } from '../dist/index.js';
import { CORPUS } from '../test/corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const fixturesDir = join(root, 'test', 'fixtures');
const goldenDir = join(root, 'test', 'golden');
mkdirSync(goldenDir, { recursive: true });

const manifest = [];
for (const entry of CORPUS) {
  const code = readFileSync(join(fixturesDir, entry.file), 'utf8');
  const result = await transformFile({ path: entry.path, code });
  if ('error' in result) {
    throw new Error(`fixture ${entry.id} failed to transform: ${result.error.message}`);
  }
  writeFileSync(join(goldenDir, `${entry.id}.out.js`), result.code);
  manifest.push({ id: entry.id, path: entry.path, deps: result.deps });
}

writeFileSync(join(goldenDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${manifest.length} golden outputs -> ${goldenDir}`);

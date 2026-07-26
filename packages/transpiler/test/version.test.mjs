import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRANSPILER_VERSION, PRESET_NAME } from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('TRANSPILER_VERSION is baked from package.json (the toolchain stamp)', () => {
  assert.equal(TRANSPILER_VERSION, pkg.version);
});

test('PRESET_NAME is the v1 react preset', () => {
  assert.equal(PRESET_NAME, 'react');
});

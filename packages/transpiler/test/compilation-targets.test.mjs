// The build hands the polyfill-provider a remembering `isRequired`
// (shims/compilation-targets.mjs). It must answer exactly as the real one does.
import { test } from '@rstest/core';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isRequired } from '@babel/helper-compilation-targets';

import getTargets, { isRequired as remembered } from '../shims/compilation-targets.mjs';

const compatData = createRequire(import.meta.url)('core-js-compat/data.json');
const names = Object.keys(compatData);

test('answers every core-js module as the real isRequired does, first and repeated', () => {
  const targetSets = [
    { chrome: '147.0.0', edge: '148.0.0', ios: '26.4.0' },
    { chrome: '90.0.0', firefox: '78.0.0', safari: '14.0.0' },
    { node: '22.0.0' },
    {},
  ];
  assert.ok(names.length > 500, 'the compat data must be the real table');
  for (const targets of targetSets) {
    for (const round of [1, 2]) {
      for (const name of names) {
        assert.equal(
          remembered(name, targets, { compatData }),
          isRequired(name, targets, { compatData }),
          `${name} for ${JSON.stringify(targets)} (round ${round})`,
        );
      }
    }
  }
});

test('a remembered answer never overrides an include or exclude list', () => {
  const targets = { chrome: '147.0.0' };
  const needed = names.find((name) => isRequired(name, targets, { compatData }));
  const notNeeded = names.find((name) => !isRequired(name, targets, { compatData }));
  assert.ok(needed && notNeeded);
  assert.equal(remembered(needed, targets, { compatData }), true);
  assert.equal(remembered(notNeeded, targets, { compatData }), false);
  assert.equal(remembered(needed, targets, { compatData, excludes: new Set([needed]) }), false);
  assert.equal(remembered(notNeeded, targets, { compatData, includes: new Set([notNeeded]) }), true);
  assert.equal(remembered(needed, targets, { compatData, excludes: new Set() }), true);
});

test('the rest of the module is passed through', () => {
  assert.equal(typeof getTargets, 'function');
});

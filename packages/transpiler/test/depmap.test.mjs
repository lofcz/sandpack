import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDependenciesResolved,
  computeInputDepMap,
  filterBuildDeps,
  isBuildDep,
} from '../dist/index.js';

test('assertDependenciesResolved: passes when every requested dep is in the resolved set', () => {
  assert.doesNotThrow(() =>
    assertDependenciesResolved({ react: '^19.0.0', 'react-dom': '^19.0.0' }, [
      { n: 'react', v: '19.2.0', d: 0 },
      { n: 'react-dom', v: '19.2.0', d: 0 },
      { n: 'scheduler', v: '0.28.0', d: 1 }, // transitive — irrelevant
    ]),
  );
});

test('assertDependenciesResolved: throws naming a silently-dropped package', () => {
  assert.throws(
    () =>
      assertDependenciesResolved({ react: '^19.0.0', 'lucide-react': '^1.21.0' }, [
        { n: 'react', v: '19.3.0', d: 0 },
      ]),
    /Could not resolve package from the package CDN: "lucide-react@\^1\.21\.0"/,
  );
});

test('assertDependenciesResolved: lists every missing package and pluralizes', () => {
  assert.throws(
    () => assertDependenciesResolved({ a: '^1.0.0', b: '^2.0.0' }, [{ n: 'c', v: '3.0.0', d: 0 }]),
    /Could not resolve packages from the package CDN: "a@\^1\.0\.0", "b@\^2\.0\.0"/,
  );
});

test('assertDependenciesResolved: presence anywhere (no depth assumption), empty is a no-op', () => {
  assert.doesNotThrow(() => assertDependenciesResolved({ react: '^19.0.0' }, [{ n: 'react', v: '19.2.0', d: 7 }]));
  assert.doesNotThrow(() => assertDependenciesResolved({}, []));
});

test('computeInputDepMap: augments, filters build deps, strips self-hosted, sorts', () => {
  const out = computeInputDepMap({
    react: '^19.0.0',
    vite: '^5.0.0',
    'babel-plugin-macros': '^3.0.0',
    '@immediately-run/sdk': '^0.4.0',
  });
  // self-hosted + build deps removed; preset augments added; keys sorted.
  assert.deepEqual(out, {
    'core-js': '3.22.7',
    react: '^19.0.0',
    'react-error-boundary': '^6.1.0',
    'react-refresh': '^0.11.0',
  });
  // key order is sorted
  assert.deepEqual(Object.keys(out), Object.keys(out).slice().sort());
});

test('computeInputDepMap: keeps an app-declared react-refresh range', () => {
  const out = computeInputDepMap({ 'react-refresh': '^0.14.0' });
  assert.equal(out['react-refresh'], '^0.14.0');
});

test('computeInputDepMap: does not mutate the caller input', () => {
  const input = { react: '^19.0.0' };
  computeInputDepMap(input);
  assert.deepEqual(input, { react: '^19.0.0' });
});

test('computeInputDepMap: extra registryResolved names are stripped', () => {
  const out = computeInputDepMap({ left: '1.0.0', right: '2.0.0' }, ['left']);
  assert.ok(!('left' in out));
  assert.equal(out.right, '2.0.0');
});

test('isBuildDep / filterBuildDeps', () => {
  assert.equal(isBuildDep('vite'), true);
  assert.equal(isBuildDep('@babel/plugin-transform-runtime'), true);
  assert.equal(isBuildDep('babel-preset-react-app'), true);
  assert.equal(isBuildDep('react'), false);
  assert.deepEqual(filterBuildDeps({ react: '^19', vite: '^5' }), { react: '^19' });
});

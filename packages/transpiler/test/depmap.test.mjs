import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDependenciesResolved,
  computeInputDepMap,
  concreteVersion,
  filterBuildDeps,
  findUnrequestedPrereleases,
  isBuildDep,
  isPrereleaseVersion,
  rootRuntimeDependencies,
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

// --- rootRuntimeDependencies (R3-289) ---------------------------------------

test('rootRuntimeDependencies: a peer-only declaration is fetched (the root has no consumer)', () => {
  const out = rootRuntimeDependencies({ peerDependencies: { react: '^19.0.0' } });
  assert.deepEqual(out, { react: '^19.0.0' });
});

test('rootRuntimeDependencies: dependencies win when both declare the same name', () => {
  const out = rootRuntimeDependencies({
    dependencies: { react: '^18.2.0' },
    peerDependencies: { react: '^19.0.0' },
  });
  assert.equal(out.react, '^18.2.0');
});

test('rootRuntimeDependencies: peerDependenciesMeta optional entries are skipped', () => {
  const out = rootRuntimeDependencies({
    peerDependencies: { react: '^19.0.0', '@types/react': '^19.0.0' },
    peerDependenciesMeta: { '@types/react': { optional: true } },
  });
  assert.deepEqual(out, { react: '^19.0.0' });
});

test('rootRuntimeDependencies: empty/absent everything yields {}', () => {
  assert.deepEqual(rootRuntimeDependencies({}), {});
  assert.deepEqual(rootRuntimeDependencies(undefined), {});
});

// --- concreteVersion (moved from the sandbox; the re-pin floor) ---------------

test('concreteVersion: a caret range reduces to its floor', () => {
  assert.equal(concreteVersion('^0.2.7'), '0.2.7');
  assert.equal(concreteVersion('~1.2.3'), '1.2.3');
  assert.equal(concreteVersion('>=2.0.0'), '2.0.0');
  assert.equal(concreteVersion('v1.2.3'), '1.2.3');
});

test('concreteVersion: keeps prerelease and build suffixes of the first token', () => {
  assert.equal(concreteVersion('^1.0.0-beta.1'), '1.0.0-beta.1');
  assert.equal(concreteVersion('^1.0.0+build.7'), '1.0.0+build.7');
});

test('concreteVersion: a bare exact version is concrete (no operator needed)', () => {
  assert.equal(concreteVersion('0.2.8'), '0.2.8');
  assert.equal(concreteVersion('0.3.0-rc.1'), '0.3.0-rc.1');
});

test('concreteVersion: a two-component version is NOT concrete (three-component core required)', () => {
  assert.equal(concreteVersion('1.2'), undefined);
});

test('concreteVersion: a tag, URL, star or multi-range is not concrete (the caller fails loud)', () => {
  assert.equal(concreteVersion('latest'), undefined);
  assert.equal(concreteVersion('*'), undefined);
  assert.equal(concreteVersion('github:a/b'), undefined);
  assert.equal(concreteVersion('1.x || 2.x'), undefined);
  assert.equal(concreteVersion(undefined), undefined);
});

// --- findUnrequestedPrereleases (R3-600) — the recorded 2026-09-11 CDN answers,
// verbatim: the primary /dep_tree/ resolved caret ranges to a canary while
// stable 19.3.0 was on npm. ------------------------------------------------------

const CANARY = '19.3.0-canary-ff7445e6-20260831';

test('the recorded canary answer names react', () => {
  const out = findUnrequestedPrereleases(
    { react: '^19.2.5' },
    [{ n: 'react', v: CANARY, d: 0 }],
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].n, 'react');
  assert.equal(out[0].v, CANARY);
  assert.equal(out[0].range, '^19.2.5');
});

test('the recorded two-dep answer names react, react-dom and the scheduler', () => {
  const out = findUnrequestedPrereleases(
    { react: '^19.2.5', 'react-dom': '^19.2.5' },
    [
      { n: 'react', v: CANARY, d: 0 },
      { n: 'react-dom', v: CANARY, d: 0 },
      { n: 'scheduler', v: '0.28.0-canary-ff7445e6-20260831', d: 1 },
    ],
  );
  assert.deepEqual(
    out.map((e) => e.n).sort(),
    ['react', 'react-dom', 'scheduler'],
  );
  // The scheduler was not REQUESTED, so it carries no re-pin range; react and
  // react-dom were, so they do.
  assert.equal(out.find((e) => e.n === 'scheduler').range, undefined);
});

test('the recorded exact-pin and ^18 answers name nothing', () => {
  assert.deepEqual(
    findUnrequestedPrereleases({ react: '19.2.5' }, [{ n: 'react', v: '19.2.5', d: 0 }]),
    [],
  );
  assert.deepEqual(
    findUnrequestedPrereleases({ react: '^18.3.1' }, [{ n: 'react', v: '18.3.1', d: 0 }]),
    [],
  );
});

test('a requested prerelease range allows prereleases anywhere in the answer', () => {
  assert.deepEqual(
    findUnrequestedPrereleases(
      { react: '^19.3.0-rc.1' },
      [
        { n: 'react', v: '19.3.0-rc.2', d: 0 },
        { n: 'scheduler', v: '0.28.0-rc.1', d: 1 },
      ],
    ),
    [],
  );
});

test('build metadata alone is not a prerelease', () => {
  assert.equal(isPrereleaseVersion('19.3.0+build.1'), false);
  assert.deepEqual(
    findUnrequestedPrereleases({ react: '^19.2.5' }, [{ n: 'react', v: '19.3.0+build.1', d: 0 }]),
    [],
  );
});

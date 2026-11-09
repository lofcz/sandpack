import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDependenciesResolved,
  computeDeclaredDepMap,
  computeRequestDepMap,
  importedPackages,
  packageEntry,
  packageName,
  transformFile,
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

test('computeDeclaredDepMap: augments, strips self-hosted, keeps tooling, sorts', () => {
  const out = computeDeclaredDepMap({
    react: '^19.0.0',
    vite: '^5.0.0',
    '@immediately-run/sdk': '^0.4.0',
  });
  // self-hosted removed; preset augments added; tooling stays declared (it is
  // only excluded from the request when nothing imports it); keys sorted.
  assert.deepEqual(out, {
    'core-js': '3.22.7',
    react: '^19.0.0',
    'react-error-boundary': '^6.1.0',
    'react-refresh': '^0.11.0',
    vite: '^5.0.0',
  });
  assert.deepEqual(Object.keys(out), Object.keys(out).slice().sort());
});

test('computeDeclaredDepMap: keeps an app-declared react-refresh range', () => {
  const out = computeDeclaredDepMap({ 'react-refresh': '^0.14.0' });
  assert.equal(out['react-refresh'], '^0.14.0');
});

test('computeDeclaredDepMap: does not mutate the caller input', () => {
  const input = { react: '^19.0.0' };
  computeDeclaredDepMap(input);
  assert.deepEqual(input, { react: '^19.0.0' });
});

test('computeDeclaredDepMap: extra registryResolved names are stripped', () => {
  const out = computeDeclaredDepMap({ left: '1.0.0', right: '2.0.0' }, ['left']);
  assert.ok(!('left' in out));
  assert.equal(out.right, '2.0.0');
});

test('packageName: maps specifiers to the package they load from node_modules', () => {
  const cases = {
    react: 'react',
    'react-dom/client': 'react-dom',
    'lodash/fp/map.js': 'lodash',
    '@scope/pkg': '@scope/pkg',
    '@scope/pkg/sub/path': '@scope/pkg',
    JSONStream: 'JSONStream',
    './local': null,
    '../up': null,
    '/abs/path': null,
    '#internal': null,
    'node:fs': null,
    'https://esm.sh/react': null,
    'data:text/css,x': null,
    '@/components/Button': null,
    '@scope': null,
    '': null,
  };
  for (const [specifier, expected] of Object.entries(cases)) {
    assert.equal(packageName(specifier), expected, specifier);
  }
  assert.equal(packageName(undefined), null);
});

test('packageEntry: the entry a specifier imports, in the CDN\'s form', () => {
  assert.equal(packageEntry('react'), '.');
  assert.equal(packageEntry('react-dom/client'), './client');
  assert.equal(packageEntry('@scope/pkg/a/b.js'), './a/b.js');
  assert.equal(packageEntry('lodash/'), '.');
  assert.equal(packageEntry('./local'), null);
});

test('importedPackages: dedupes package roots and drops local specifiers', () => {
  assert.deepEqual(
    [...importedPackages(['react', 'react/jsx-runtime', './App', '@mui/material/Button', undefined])],
    ['react', '@mui/material'],
  );
});

test('computeRequestDepMap: requests only imported declared packages plus preset implicits', () => {
  const declared = computeDeclaredDepMap({
    react: '^19.0.0',
    three: '0.160.0',
    vite: '^5.0.0',
    '@types/three': '0.160.0',
    '@vitejs/plugin-react': '^4.0.0',
    eslint: '^9.0.0',
  });
  const request = computeRequestDepMap(declared, importedPackages(['react', 'three/addons/controls', 'undeclared']));
  assert.deepEqual(request, {
    'core-js': '3.22.7',
    react: '^19.0.0',
    'react-error-boundary': '^6.1.0',
    'react-refresh': '^0.11.0',
    three: '0.160.0',
  });
});

test('computeRequestDepMap: ignores inherited object keys', () => {
  assert.deepEqual(computeRequestDepMap({}, ['constructor', 'toString']), {});
});

// Regression (sciobot-next session 2026-11-04): a generated three.js game
// declared `three` + `@types/three`. The declared map went to /dep_tree whole;
// the CDN skips `@types/*`, the registry read that as a dropped package and
// executed `@types/three` from the esm.sh fallback as JavaScript. With
// import-driven requests a declaration package is never requested: the app's
// specifiers, after the real transform chain erases type-only imports, only
// name `three`.
test('a declared @types package behind a namespace import is never requested', async () => {
  const declared = computeDeclaredDepMap({ react: '^19.0.0', three: '0.160.0', '@types/three': '0.160.0' });
  const result = await transformFile({
    path: '/app/src/Game.tsx',
    code: [
      "import * as THREE from 'three';",
      "import type { Mesh } from 'three';",
      'export function Game() {',
      '  const mesh: Mesh = new THREE.Mesh();',
      '  return <canvas data-id={mesh.id} />;',
      '}',
    ].join('\n'),
  });
  assert.ok(!('error' in result), JSON.stringify(result));
  const request = computeRequestDepMap(declared, importedPackages(result.deps));
  assert.equal(request.three, '0.160.0');
  assert.ok(!('@types/three' in request));
  assert.deepEqual(Object.keys(request).filter(name => name.startsWith('@types/')), []);
});

/**
 * @jest-environment jsdom
 *
 * Lockset consumption tests (PRETRANSPILED_ARTIFACTS_SPEC §5.4 + plan phase 01
 * exit criteria): a valid, exactly-matching sidecar lockset replaces the
 * blocking dep_tree request; every mismatch falls back to live resolution.
 * (jsdom: importing ModuleRegistry transitively loads the evaluation runtime,
 * which references `window`/`self` at module scope.)
 */
import { ModuleRegistry } from '.';
import { Bundler } from '../bundler';
import { depMapsEqual, locksetClosureValid, validateLockset } from './lockset';
import { CDN_VERSION, fetchManifest } from './module-cdn';

jest.mock('./module-cdn', () => ({
  ...jest.requireActual('./module-cdn'),
  fetchManifest: jest.fn(),
  fetchModule: jest.fn(),
}));

const mockedFetchManifest = fetchManifest as jest.MockedFunction<typeof fetchManifest>;

// A realistic resolved set: every requested dep present at depth 0 (the registry
// enforces this completeness on the lockset path too — a lockset missing a
// requested dep is the silent-drop bug it guards against), plus a transitive.
const RESOLVED = [
  { n: 'core-js', v: '3.22.7', d: 0 },
  { n: 'react', v: '18.3.1', d: 0 },
  { n: 'react-error-boundary', v: '6.1.0', d: 0 },
  { n: 'react-refresh', v: '0.11.0', d: 0 },
  { n: 'scheduler', v: '0.23.0', d: 1 },
];

// The request loadNodeModules computes for an app importing react under the
// react preset (implicit deps + the imported package).
const DEPS = {
  'core-js': '3.22.7',
  react: '^18.2.0',
  'react-error-boundary': '^6.1.0',
  'react-refresh': '^0.11.0',
};

// The declared map behind it: tooling and types are declared but never imported.
const DECLARED = { ...DEPS, vite: '^5.0.0', '@types/react': '^18.2.0' };

const lockset = (overrides: Record<string, unknown> = {}) => ({
  cdnVersion: CDN_VERSION,
  dependencies: { ...DECLARED },
  requested: { ...DEPS },
  resolved: RESOLVED,
  ...overrides,
});

describe('validateLockset', () => {
  it('accepts a well-formed lockset at the current CDN version', () => {
    expect(validateLockset(lockset())).not.toBeNull();
  });

  it.each([
    ['null', null],
    ['non-object', 'lockset'],
    ['wrong cdnVersion', lockset({ cdnVersion: CDN_VERSION + 1 })],
    ['non-string range', lockset({ dependencies: { react: 18 } })],
    ['dependencies array', lockset({ dependencies: ['react'] })],
    ['missing requested', lockset({ requested: undefined })],
    ['malformed resolved entry', lockset({ resolved: [{ n: 'react', v: 18, d: 0 }] })],
    ['resolved not an array', lockset({ resolved: {} })],
  ])('rejects %s', (_label, value) => {
    expect(validateLockset(value)).toBeNull();
  });
});

describe('locksetClosureValid (PT-2: no injected package)', () => {
  it('accepts a declared request whose depth-0 entries are all requested', () => {
    expect(locksetClosureValid(lockset())).toBe(true);
  });

  it('rejects a request for an undeclared package', () => {
    expect(locksetClosureValid(lockset({ requested: { ...DEPS, 'evil-pkg': '1.0.0' } }) as never)).toBe(false);
  });

  it('rejects a request outside the declared range', () => {
    expect(locksetClosureValid(lockset({ requested: { ...DEPS, react: '^19.0.0' } }) as never)).toBe(false);
  });

  it('rejects a depth-0 entry the request never named, even if declared', () => {
    const widened = lockset({ resolved: [...RESOLVED, { n: 'vite', v: '5.0.0', d: 0 }] });
    expect(locksetClosureValid(widened as never)).toBe(false);
  });

  it('rejects a lockset with an injected top-level package not in declared deps', () => {
    const poisoned = lockset({
      resolved: [...RESOLVED, { n: 'evil-pkg', v: '1.0.0', d: 0 }],
    });
    expect(locksetClosureValid(poisoned as never)).toBe(false);
  });

  it('does NOT reject an extra transitive (depth>0) entry — documented residual', () => {
    const withTransitive = lockset({
      resolved: [...RESOLVED, { n: 'some-transitive', v: '2.0.0', d: 2 }],
    });
    expect(locksetClosureValid(withTransitive as never)).toBe(true);
  });
});

describe('depMapsEqual', () => {
  it('is order-independent and exact', () => {
    expect(depMapsEqual({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
    expect(depMapsEqual({ a: '1' }, { a: '2' })).toBe(false);
    expect(depMapsEqual({ a: '1' }, { a: '1', b: '2' })).toBe(false);
    expect(depMapsEqual({ a: '1', b: '2' }, { a: '1' })).toBe(false);
    expect(depMapsEqual({}, {})).toBe(true);
  });
});

describe('ModuleRegistry.fetchManifest with a lockset', () => {
  // fetchManifest never touches the bundler; a bare stub suffices.
  const registry = () => new ModuleRegistry({} as Bundler);

  beforeEach(() => {
    mockedFetchManifest.mockReset();
    // The live CDN echoes every requested top-level dep back in the resolved
    // manifest; stub it that way so the resolution-completeness invariant
    // (assertDependenciesResolved) holds. These tests exercise the lockset-vs-live
    // decision; the silent-drop failure mode itself is unit-tested in the shared
    // @immediately-run/transpiler package (depmap.test.mjs).
    mockedFetchManifest.mockImplementation(async (deps) =>
      Object.keys(deps).map((n) => ({ n, v: '1.0.0', d: 0 })),
    );
  });

  it('uses a matching lockset and skips the dep_tree request', async () => {
    const r = registry();
    await r.fetchManifest({ ...DECLARED }, { ...DEPS }, lockset());
    expect(r.manifest).toEqual(RESOLVED);
    expect(mockedFetchManifest).not.toHaveBeenCalled();
  });

  it("adopts the lockset's request over the runtime's own import set", async () => {
    const r = registry();
    // A live boot without seeded artifacts only knows the implicit deps; the
    // lockset (the CLI's full import scan) still applies.
    const implicitOnly = { 'core-js': '3.22.7', 'react-error-boundary': '^6.1.0', 'react-refresh': '^0.11.0' };
    await r.fetchManifest({ ...DECLARED }, implicitOnly, lockset());
    expect(r.manifest).toEqual(RESOLVED);
    expect(mockedFetchManifest).not.toHaveBeenCalled();
  });

  it('resolves live when the dependency echo mismatches (edited deps)', async () => {
    const r = registry();
    await r.fetchManifest({ ...DECLARED, zod: '^3.0.0' }, { ...DEPS, zod: '^3.0.0' }, lockset());
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);
    // Live resolution, not the lockset's RESOLVED: includes the edited-in dep.
    expect(r.manifest.map((d) => d.n)).toContain('zod');
  });

  it('resolves live with no lockset, pinning the whole declared map', async () => {
    const r = registry();
    await r.fetchManifest({ ...DECLARED }, { ...DEPS }, undefined);
    expect(mockedFetchManifest).toHaveBeenCalledWith(DEPS, expect.objectContaining(DECLARED));
  });

  it('rejects a lockset with an injected root and resolves live (PT-2)', async () => {
    const r = registry();
    // Echo matches the declared deps, but `resolved` smuggles an extra
    // top-level package — the whole lockset is rejected, not partially trusted.
    const poisoned = lockset({ resolved: [...RESOLVED, { n: 'evil-pkg', v: '1.0.0', d: 0 }] });
    await r.fetchManifest({ ...DECLARED }, { ...DEPS }, poisoned as never);
    expect(mockedFetchManifest).toHaveBeenCalledTimes(1);
    // Came from live resolution, not the rejected lockset (no smuggled evil-pkg).
    expect(r.manifest.map((d) => d.n)).not.toContain('evil-pkg');
    expect(r.manifest.map((d) => d.n)).toEqual(Object.keys(DEPS).sort());
  });

  it('catches a lockset MISSING a requested dep (baked-in CDN drop), not silently skipping it', async () => {
    // Fallback disabled (null) to isolate the completeness guard: the CLI builds
    // the sidecar lockset against the SAME primary CDN, so a CDN drop is frozen
    // out of `resolved`. The echo matches and closure passes (closure only rejects
    // INJECTED roots), so the guard must fire on the lockset path too. (With the
    // fallback enabled it would instead route the dropped dep to esm.sh; that
    // path is covered in esmFallback.test.ts.)
    const r = new ModuleRegistry({} as Bundler, null);
    const declared = { ...DECLARED, 'lucide-react': '^1.21.0' };
    const requested = { ...DEPS, 'lucide-react': '^1.21.0' };
    const incomplete = lockset({ dependencies: declared, requested }); // resolved=RESOLVED lacks lucide-react
    await expect(r.fetchManifest(declared, requested, incomplete)).rejects.toThrow(/Could not resolve.*lucide-react@\^1\.21\.0/);
    expect(mockedFetchManifest).not.toHaveBeenCalled(); // lockset echo matched; no live fetch attempted
  });
});

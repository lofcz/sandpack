import { NodeModule } from './module-registry/NodeModule';
import { createBundlerHarness, type BundlerHarness } from './testHarness/bundlerHarness';

// A host keeps a material on the releases it was built with: the bundler says
// which release each declared package resolved to, and a manifest rewritten to
// name exactly those releases is the install it already has, not a new one.

interface Internals {
  installedDependencyChanged(declared: Record<string, string>): boolean;
  reportResolvedDependencies(): void;
}

describe('resolved dependency versions', () => {
  let h: BundlerHarness;
  let internals: Internals;

  beforeEach(async () => {
    h = await createBundlerHarness();
    internals = h.bundler as unknown as Internals;
    const registry = h.bundler.moduleRegistry;
    registry.setDeclared({ three: 'latest', d3: '^7', alias: 'npm:other@latest' });
    registry.modules.set('three', new NodeModule('three', '0.187.0', {}, [], { name: 'three', version: '0.187.0' }));
    registry.modules.set('d3', new NodeModule('d3', '7.9.0', {}, [], { name: 'd3', version: '7.9.0' }));
    registry.modules.set('alias', new NodeModule('alias', '2.0.0', {}, [], { name: 'other', version: '2.0.0' }));
    // Installed for another package, not declared by the app.
    registry.modules.set('d3-array', new NodeModule('d3-array', '3.2.4', {}, [], { name: 'd3-array', version: '3.2.4' }));
  });

  afterEach(() => h.teardown());

  it('reports the release of every declared package once, and again only when it changes', () => {
    internals.reportResolvedDependencies();
    internals.reportResolvedDependencies();

    const reports = h.sentMessages.filter((message) => message.type === 'dependencies-resolved');
    expect(reports).toEqual([{ type: 'dependencies-resolved', data: { versions: { three: '0.187.0', d3: '7.9.0' } } }]);

    h.bundler.moduleRegistry.modules.set('three', new NodeModule('three', '0.188.0', {}, [], { name: 'three', version: '0.188.0' }));
    internals.reportResolvedDependencies();
    expect(h.sentMessages.filter((message) => message.type === 'dependencies-resolved')).toHaveLength(2);
  });

  it('takes a manifest that names the installed releases for the same install', () => {
    const declared = { three: '0.187.0', d3: '7.9.0', alias: 'npm:other@latest' };
    expect(internals.installedDependencyChanged(declared)).toBe(false);
  });

  it('still sees another version, a removed package and a changed alias as a change', () => {
    const same = { three: 'latest', d3: '^7', alias: 'npm:other@latest' };
    expect(internals.installedDependencyChanged(same)).toBe(false);
    expect(internals.installedDependencyChanged({ ...same, three: '0.186.0' })).toBe(true);
    expect(internals.installedDependencyChanged({ d3: '^7', alias: 'npm:other@latest' })).toBe(true);
    expect(internals.installedDependencyChanged({ ...same, alias: '2.0.0' })).toBe(true);
  });
});

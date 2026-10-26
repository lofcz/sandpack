import { configure, mount, umount, fs, resolveMountConfig, CopyOnWrite, InMemory, bindContext } from '@zenfs/core';
import { ModuleRegistry } from '../bundler/module-registry';
import { NodeModule } from '../bundler/module-registry/NodeModule';
import { resolveAsync } from '../resolver/resolver';
import { CachedFS } from './CachedFS';
import { RegistryFS } from './RegistryFS';

it('reads and resolves packages through the runtime copy-on-write mount', async () => {
  await configure({ disableAccessChecks: true, disableAsyncCache: true });
  const inline = (c: string) => ({ c, d: [], t: false });
  const pkg = JSON.stringify({ name: 'widget', main: 'index.js', exports: { '.': { default: './index.js' } } });
  const registry = { modules: new Map([
    ['widget', new NodeModule('widget', '1.0.0', {
      'package.json': inline(pkg), 'index.js': inline('module.exports = 42;'),
    }, [])],
  ]) } as unknown as ModuleRegistry;
  const readable = new RegistryFS(registry);
  const backend = await resolveMountConfig({ backend: CopyOnWrite, readable, writable: { backend: InMemory } });
  await fs.promises.mkdir('/node_modules').catch(() => undefined);
  mount('/node_modules', backend);
  try {
    // Closing a read handle updates atime, which can copy the parent directory
    // into the writable layer. Incomplete inode metadata used to throw here.
    expect(await fs.promises.readFile('/node_modules/widget/package.json', 'utf8')).toBe(pkg);
    const cached = new CachedFS(bindContext({}));
    expect(await resolveAsync('widget', {
      filename: '/node_modules/consumer/index.js', extensions: ['.js'],
      isFile: cached.isFile, readFile: cached.readFile,
    })).toBe('/node_modules/widget/index.js');
    await fs.promises.writeFile('/node_modules/widget/index.js', 'module.exports = 7;');
    expect(await fs.promises.readFile('/node_modules/widget/index.js', 'utf8')).toBe('module.exports = 7;');
    expect(registry.modules.get('widget')!.files['index.js']).toEqual(inline('module.exports = 42;'));
  } finally {
    umount('/node_modules');
  }
});

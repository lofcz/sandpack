import { scanLocalImports } from './importScan';

describe('scanLocalImports', () => {
  // Raw specifiers per module, as the transform chain reports them.
  const graph: Record<string, string[]> = {
    '/app/src/App.tsx': ['./Game', './app.css', 'react', 'react/jsx-runtime'],
    '/app/src/Game.tsx': ['three', './App'],
    '/app/src/app.css': ['@fontsource/inter/400.css', '@tailwindcss/browser'],
    '/app/src/main.tsx': ['./index.css'],
    '/app/src/index.css': [],
  };
  const resolveLocal = async (specifier: string, from: string): Promise<string> => {
    if (!specifier.startsWith('.')) throw new Error(`Cannot find module '${specifier}'`);
    const dir = from.slice(0, from.lastIndexOf('/'));
    const base = `${dir}/${specifier.slice(2)}`;
    const found = [base, `${base}.tsx`].find((candidate) => candidate in graph);
    if (!found) throw new Error(`Cannot find module '${specifier}'`);
    return found;
  };
  const moduleSpecifiers = jest.fn(async (path: string) => {
    if (!(path in graph)) throw new Error('ENOENT');
    return graph[path];
  });

  it('walks the local graph once per module and reports the package imports', async () => {
    const external = await scanLocalImports({
      entries: ['/app/src/App.tsx', '/app/src/main.tsx'],
      appRoot: '/app',
      moduleSpecifiers,
      resolveLocal,
    });
    expect(external.sort()).toEqual(
      ['@fontsource/inter/400.css', '@tailwindcss/browser', 'react', 'react/jsx-runtime', 'three'].sort(),
    );
    expect(moduleSpecifiers.mock.calls.map(([path]) => path).sort()).toEqual(Object.keys(graph).sort());
  });

  it('reports what resolves outside the app root, and never throws on unreadable modules', async () => {
    const external = await scanLocalImports({
      entries: ['/app/missing.tsx', '/app/src/Game.tsx'],
      appRoot: '/app',
      moduleSpecifiers: async (path) => {
        if (path !== '/app/src/Game.tsx') throw new Error('ENOENT');
        return ['/node_modules/__csb_bust/refresh-helper.js'];
      },
      resolveLocal: async (specifier) => specifier,
    });
    expect(external).toEqual(['/node_modules/__csb_bust/refresh-helper.js']);
  });
});

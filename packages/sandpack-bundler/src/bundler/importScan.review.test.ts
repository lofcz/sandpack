import { transformFile } from '@lofcz/transpiler';
import { scanLocalImports } from './importScan';

it.each([
  "import { type Properties } from 'csstype'; export const style: Properties = { color: 'red' };",
  "import { Properties } from 'csstype'; export const style: Properties = { color: 'red' };",
])('does not boot-install packages erased by the real transform: %s', async code => {
  const compiled = await transformFile({ path: '/app/typed-style.ts', code });
  if ('error' in compiled) throw new Error(JSON.stringify(compiled));
  expect(compiled.deps).not.toContain('csstype');
  // The boot scan reads each module's specifiers from the same transform.
  const scanned = await scanLocalImports({
    entries: ['/app/typed-style.ts'],
    appRoot: '/app',
    moduleSpecifiers: async () => compiled.deps,
    resolveLocal: async (specifier) => { throw new Error(`Cannot find module '${specifier}'`); },
  });
  expect(scanned).not.toContain('csstype');
});

import { fs } from '@zenfs/core';

import { underAppRoot } from '../fsLayout';
import { Module } from './module/Module';
import { createBundlerHarness, EVAL_FIXTURE, installEvalGlobals, type BundlerHarness } from './testHarness/bundlerHarness';

// The `state` message lists every module of the build. Building it by spreading
// an ever-growing object once per module is quadratic: measured on Node 24 it took
// 5 s for 5000 modules and 22 s for 10000, on every compile.
describe('the state message of a large module graph', () => {
  const MODULE_COUNT = 8000;
  let h: BundlerHarness;
  let restore: () => void;

  beforeAll(async () => {
    restore = installEvalGlobals();
    h = await createBundlerHarness(EVAL_FIXTURE, { forCompile: true });
    const evaluate = await h.bundler.compile();
    (evaluate as () => unknown)();
  }, 60000);

  afterAll(async () => {
    await h.teardown();
    restore();
  });

  it('is built in time linear in the number of modules', async () => {
    // The file closure of a few real packages.
    for (let index = 0; index < MODULE_COUNT; index++) {
      const path = `/node_modules/big-package/file-${index}.js`;
      h.bundler.modules.set(path, new Module(path, `module.exports = ${index};`, true, h.bundler));
    }
    const hot = h.bundler.getModule(underAppRoot('/src/answer.ts'))!.hot.ensureHMRConfig();
    hot.setType('accept');
    hot.setSelfAccepted(true);
    await fs.promises.writeFile(underAppRoot('/src/answer.ts'), 'const answer: number = 7;\nexport default answer;\n');
    h.bundler.markFilesChanged([underAppRoot('/src/answer.ts')]);
    h.sentMessages.length = 0;

    const startedAt = Date.now();
    await h.bundler.compile();
    const elapsed = Date.now() - startedAt;

    const state = h.sentMessages.find((message) => message.type === 'state')?.data as {
      state: { transpiledModules: Record<string, { source: { isEntry: boolean; fileName: string; compiledCode: string } }> };
    };
    const modules = state.state.transpiledModules;
    expect(Object.keys(modules).length).toBeGreaterThan(MODULE_COUNT);
    expect(modules['/node_modules/big-package/file-41.js:']).toEqual({
      source: { isEntry: false, fileName: '/node_modules/big-package/file-41.js', compiledCode: 'module.exports = 41;' },
    });
    expect(modules[`${underAppRoot('/src/main.ts')}:`].source.isEntry).toBe(true);
    expect(modules[`${underAppRoot('/src/answer.ts')}:`].source.compiledCode).toContain('7');
    expect(elapsed).toBeLessThan(3000);
  }, 120000);
});

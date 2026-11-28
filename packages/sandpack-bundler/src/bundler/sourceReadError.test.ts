import { underAppRoot } from '../fsLayout';
import { Module } from './module/Module';
import { BundlerHarness, createBundlerHarness, installEvalGlobals } from './testHarness/bundlerHarness';

// Sources reach the bundler over the mounted filesystem (a MessagePort to the
// host). A read that fails there is reported as what it was: this file, this
// error. It is not a network fetch and has nothing to do with GitHub.
describe('a source that cannot be read', () => {
  let h: BundlerHarness;
  const answer = underAppRoot('/src/answer.ts');
  const index = underAppRoot('/src/index.ts');

  beforeAll(async () => {
    h = await createBundlerHarness();
    await h.bundler.initPreset('create-react-app');
    const realRead = h.bundler.fs.readFileAsync.bind(h.bundler.fs);
    rs.spyOn(h.bundler.fs, 'readFileAsync').mockImplementation(async (path: string) =>
      path === answer ? Promise.reject(new Error('RPC request timed out after 30000 ms')) : realRead(path)
    );
  }, 60000);

  afterAll(async () => {
    await h.teardown();
  });

  it('names the file and the underlying error, and blames nothing else', async () => {
    const failure = await h.bundler.transformModule(answer).then(
      () => undefined,
      (error: Error & { path?: string }) => error
    );
    expect(failure?.message).toContain(answer);
    expect(failure?.message).toContain('RPC request timed out after 30000 ms');
    expect(failure?.message).not.toMatch(/github|rate limit|network|fetch/i);
    expect(failure?.path).toBe(answer);
  });

  it('reports the same read failure for the module that imports it', async () => {
    await h.bundler.transformModule(index);
    const failure = await h.bundler.moduleFinishedPromise(index).then(
      () => undefined,
      (error: Error) => error
    );
    expect(failure?.message).toContain(answer);
    expect(failure?.message).toContain('RPC request timed out after 30000 ms');
    expect(failure?.message).not.toMatch(/github|rate limit|network|fetch/i);
  });

  it('says so when evaluated code requires a module that never loaded', () => {
    const restore = installEvalGlobals();
    try {
      const importer = new Module('/app/importer.js', 'module.exports = require("./answer");', true, h.bundler);
      importer.dependencyMap.set('./answer', answer);
      let message = '';
      try {
        importer.evaluate();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(answer);
      expect(message).toContain('/app/importer.js');
      expect(message).toContain('RPC request timed out after 30000 ms');
      expect(message).not.toMatch(/github|rate limit|network|fetch/i);
    } finally {
      restore();
    }
  });
});

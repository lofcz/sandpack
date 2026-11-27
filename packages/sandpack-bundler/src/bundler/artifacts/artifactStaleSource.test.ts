import { ArtifactStore, type ArtifactFs } from './artifactStore';

// `/transpiled` is keyed by path and survives a build that starts over. The
// host does not announce every edit before the bundler reads the filesystem
// again (after a dependency change it sends package.json alone and the build
// boots from all files), so a written-through entry has to prove it was made
// from the file as it is now.

const memoryFs = (): ArtifactFs & { files: Map<string, string> } => {
  const files = new Map<string, string>();
  return {
    files,
    readFileAsync: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error('ENOENT ' + path);
      return content;
    },
    writeFile: async (path, content) => void files.set(path, content),
    isFileAsync: async (path) => files.has(path),
    deleteFile: async (path) => void files.delete(path),
  };
};

const store = (fs: ArtifactFs) => new ArtifactStore(fs, { version: 'test', toolchainHash: 'test' } as never);

describe('a written-through artifact and the source it was made from', () => {
  it('is served while the source is the one it was compiled from', async () => {
    const fs = memoryFs();
    const artifacts = store(fs);
    await artifacts.writeThrough('/app/App.tsx', 'compiled A', ['p5'], 'source A');

    const hit = await artifacts.consult('/app/App.tsx', async () => 'source A');

    expect(hit).toEqual({ content: 'compiled A', deps: ['p5'] });
  });

  it('is dropped when the file changed without the bundler being told', async () => {
    const fs = memoryFs();
    const artifacts = store(fs);
    await artifacts.writeThrough('/app/App.tsx', 'compiled A', ['p5'], 'source A');

    expect(await artifacts.consult('/app/App.tsx', async () => 'source B')).toBeNull();

    // Gone for good, with the imports recorded for it: the next install must not ask for them.
    expect(await artifacts.consult('/app/App.tsx', async () => 'source A')).toBeNull();
    expect(artifacts.recordedSpecifiers()).toEqual([]);
    expect(fs.files.size).toBe(0);
  });

  it('is dropped when the file can no longer be read', async () => {
    const artifacts = store(memoryFs());
    await artifacts.writeThrough('/app/App.tsx', 'compiled A', [], 'source A');

    expect(await artifacts.consult('/app/App.tsx', () => Promise.reject(new Error('ENOENT')))).toBeNull();
  });
});

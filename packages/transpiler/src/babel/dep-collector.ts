// Babel plugin that records every `require(<specifier>)` call whose specifier is
// known at build time, so the transform can report a module's dependencies
// alongside its code. Moved from sandbox/src/bundler/transforms/babel/dep-collector.ts;
// the collected dep set must match the runtime's.
//
// The plugin holds no per-file state: Babel only reuses its resolved option
// chain (the expensive part of a transform is resolving preset-env) while the
// plugin array keeps its identity, so the per-file result lives on the file's
// metadata instead of in a per-call closure.
const METADATA_KEY = 'irDependencies';

type FileMetadata = Record<string, unknown>;

export const collectDependencies = () => ({
  name: 'immediately-run:dep-collector',
  visitor: {
    CallExpression(path: any, state: any) {
      const callee = path.get('callee');
      if (!callee.isIdentifier() || callee.node.name !== 'require') return;
      if (path.scope.hasBinding('require')) return;

      // Only a specifier Babel can fully evaluate is a dependency of the build:
      // `require(name)` and the `require(s)` the dynamic-import lowering emits
      // for `import(expr)` are resolved when the code runs, and their
      // unevaluated value (`undefined`) is not a module.
      const [specifier] = path.get('arguments');
      if (!specifier) return;
      const evaluated = specifier.evaluate();
      if (!evaluated.confident || typeof evaluated.value !== 'string') return;

      const metadata: FileMetadata = state.file.metadata;
      let requires = metadata[METADATA_KEY] as Set<string> | undefined;
      if (!requires) metadata[METADATA_KEY] = requires = new Set();
      requires.add(evaluated.value);
    },
  },
});

/** The specifiers `collectDependencies` recorded for one transformed file. */
export function collectedDependencies(metadata: unknown): Set<string> {
  const requires = (metadata as FileMetadata | null | undefined)?.[METADATA_KEY];
  return requires instanceof Set ? (requires as Set<string>) : new Set();
}

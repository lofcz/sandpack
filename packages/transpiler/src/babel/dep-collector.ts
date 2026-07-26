// Babel plugin that records every top-level `require(<literal>)` call into a
// shared Set, so the transform can report a module's dependencies alongside its
// code. Moved verbatim from sandbox/src/bundler/transforms/babel/dep-collector.ts
// — keep behaviour identical (byte-identity of the emitted code is unaffected,
// but the collected dep set must match the runtime's).
export function collectDependencies(requires: Set<string>) {
  return {
    visitor: {
      CallExpression(path: any) {
        const callee = path.get('callee');

        if (callee.isIdentifier() && callee.node.name === 'require') {
          if (!path.scope.hasBinding(callee.node.name)) {
            const arg = path.get('arguments.0');
            const evaluated = arg.evaluate();
            requires.add(evaluated.value);
          }
        }
      },
    },
  };
}

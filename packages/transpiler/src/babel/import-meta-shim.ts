// Babel plugin: rewrite the `import.meta` meta-property to the identifier
// `IMPORT_META_GLOBAL`, which the runtime (the sandbox's module evaluator) provides as a
// frozen `{ url }` holding the module's own URL (R3-328).
//
// WHY (the bug this kills): the sandbox transpiles app source ESM→CommonJS and then
// evaluates the compiled text as a CLASSIC SCRIPT (an indirect-eval'd function body).
// `import.meta` is module-only syntax, so a module using it — a web standard, and the
// sanctioned idiom for worker/asset URLs — died at PARSE time with `SyntaxError: Cannot
// use 'import.meta' outside a module`, killing the whole module (an app-level try/catch
// never engages; caught live on the reckoner demo, 2026-08-24). Rewriting the syntax at
// transform time makes the failure impossible; the runtime supplies the value.
//
// Semantics: `import.meta.url` → `<global>.url` (the module's sandbox URL); any other
// property (`import.meta.env`, bundler-specific reads) → `undefined`, honestly matching
// "not a bundler". Bare `import.meta` compares/serializes as the frozen object.
//
// CONTRACT: the emitted identifier is a cross-repo protocol constant — the sandbox's
// evaluator (`sandbox/src/bundler/module/`) must inject exactly this name with exactly
// this shape. It is exported for tests and for the sandbox's future direct consumption
// (dep ≥0.7.0); until then the sandbox carries its own copy pinned by that repo's tests
// (the identifier must never silently change — like the wire-protocol constants, it is
// repo-local by the same precedent).

export const IMPORT_META_GLOBAL = '$ir_import_meta';

export function importMetaShim() {
  return {
    name: 'immediately-run:import-meta-shim',
    visitor: {
      MetaProperty(path: any) {
        // `import.meta` — the MetaProperty whose meta is `import` (`new.target`, the
        // other MetaProperty, has meta `new` and must pass through untouched).
        if (path.node.meta?.name === 'import' && path.node.property?.name === 'meta') {
          path.replaceWith({ type: 'Identifier', name: IMPORT_META_GLOBAL });
        }
      },
    },
  };
}

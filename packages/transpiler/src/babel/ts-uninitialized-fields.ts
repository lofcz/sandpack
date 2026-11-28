// Babel plugin: in TypeScript files, drop class fields that have no initializer.
//
// WHY: Babel 7's TypeScript transform treated `class A { x: number; y?: string }`
// as type-only declarations and removed them (its `allowDeclareFields` option was
// off in this chain). Babel 8 removed that option and always keeps them, so the
// class would now define `x` and `y` as own properties set to `undefined`:
// a field redeclared in a subclass would overwrite the value the parent
// constructor assigned, and `Object.keys`, `in` and object spread would see keys
// that were never there. Materials were written against the old output, so the
// chain keeps it.
//
// The rule is Babel 7's: a non-private field with no value and no decorators is
// removed, instance and static alike. `declare` fields are left to Babel, which
// removes them itself. Only files the TypeScript preset handles are touched; in
// JavaScript `class A { x; }` is a real field and stays.
const TYPESCRIPT_FILE = /\.(?:[cm]?ts|tsx)$/;

export const tsUninitializedFields = () => ({
  name: 'immediately-run:ts-uninitialized-fields',
  visitor: {
    Class(path: any, state: any) {
      if (!TYPESCRIPT_FILE.test(state.filename ?? '')) return;
      for (const member of path.get('body.body')) {
        if (!member.isClassProperty()) continue;
        const { value, declare, decorators } = member.node;
        if (value || declare || decorators?.length) continue;
        member.remove();
      }
    },
  },
});

import { parse, type Node } from 'acorn';

export interface CjsScan {
  /** Literal require() specifiers, decoded and de-duplicated in source order. */
  requires: string[];
  /** Needs the compiler: ESM syntax, dynamic import, or syntax we cannot parse. */
  isEsm: boolean;
}

const REQUIRE = 'require';

function bindsRequire(pattern: any): boolean {
  if (!pattern) return false;
  switch (pattern.type) {
    case 'Identifier': return pattern.name === REQUIRE;
    case 'RestElement': return bindsRequire(pattern.argument);
    case 'AssignmentPattern': return bindsRequire(pattern.left);
    case 'ArrayPattern': return pattern.elements.some(bindsRequire);
    case 'ObjectPattern': return pattern.properties.some((property: any) =>
      bindsRequire(property.type === 'RestElement' ? property.argument : property.value));
    default: return false;
  }
}

const isFunction = (type: string) =>
  type === 'FunctionDeclaration' || type === 'FunctionExpression' || type === 'ArrowFunctionExpression';

/**
 * Keep published CommonJS off the Babel path, but parse its syntax accurately.
 * Templates, escapes and regex literals cannot be scanned with quote heuristics.
 * Dynamic import must also go through Babel to use the sandbox's resolver.
 * Unknown syntax falls back to the compiler, which supports TS/JSX and reports
 * syntax errors; it must never be handed to the evaluator as trusted JavaScript.
 *
 * Whose `require` a call is: a bundle that carries its own loader (browserify,
 * a UMD wrapper) calls a `require` that one of its functions declares, as a
 * parameter or a `var`. Those calls are the bundle's own business and name no
 * import of this file. Only a call that reaches the `require` the file is
 * given counts, and only such a call with a computed argument needs the
 * compiler. A binding the function scope does not decide (`let`, `const`,
 * `class`, a `catch` parameter, anything at the top level, where the file's
 * own `require` lives) is left to the compiler, which tracks every scope.
 * sandpack-cdn's module_scan.rs gives the same answer for the files it
 * transforms; keep the two in step.
 */
export function scanCjsModule(source: string): CjsScan {
  let root: Node;
  try {
    root = parse(source, {
      ecmaVersion: 'latest', sourceType: 'script',
      allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
    });
  } catch {
    return { requires: [], isEsm: true };
  }
  let isEsm = false;
  // Function scopes, the top level being 0: the scope each is written in,
  // whether it declares `require` for all of its body, and whether it holds a
  // declaration of `require` that covers only part of it.
  const parent: number[] = [-1];
  const declares: boolean[] = [false];
  const partly: boolean[] = [false];
  const calls: Array<{ scope: number; specifier: string | null }> = [];

  const nodes: any[] = [root];
  const scopes: number[] = [0];
  while (nodes.length) {
    const node = nodes.pop();
    let scope = scopes.pop()!;
    const type: string = node.type;
    if (type.startsWith('Import') || type.startsWith('Export') ||
        (type === 'MetaProperty' && node.meta.name === 'import')) isEsm = true;

    if (isFunction(type)) {
      // A declaration's name belongs to the scope it is written in.
      if (type === 'FunctionDeclaration' && node.id?.name === REQUIRE) declares[scope] = true;
      parent.push(scope);
      scope = parent.length - 1;
      declares.push(node.params.some(bindsRequire) || (type === 'FunctionExpression' && node.id?.name === REQUIRE));
      partly.push(false);
    } else if (type === 'VariableDeclaration') {
      if (node.declarations.some((declarator: any) => bindsRequire(declarator.id))) {
        if (node.kind === 'var') declares[scope] = true;
        else partly[scope] = true;
      }
    } else if ((type === 'CatchClause' && bindsRequire(node.param)) ||
               ((type === 'ClassDeclaration' || type === 'ClassExpression') && node.id?.name === REQUIRE)) {
      partly[scope] = true;
    } else if (type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === REQUIRE) {
      const argument = node.arguments[0];
      calls.push({
        scope,
        specifier: argument?.type === 'Literal' && typeof argument.value === 'string' ? argument.value : null,
      });
    }

    // Preserve source order without recursing into deeply nested generated code.
    const children: Node[] = [];
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') children.push(child);
      } else if (value && typeof value === 'object' && 'type' in value) {
        children.push(value as Node);
      }
    }
    for (let i = children.length - 1; i >= 0; i--) {
      nodes.push(children[i]);
      scopes.push(scope);
    }
  }

  // Is `require`, read in this scope, one a function around it declares?
  const own = (scope: number): boolean => {
    for (let at = scope; at > 0; at = parent[at]) if (declares[at]) return true;
    return false;
  };
  if (declares[0] || partly[0]) isEsm = true;
  for (let scope = 1; scope < partly.length && !isEsm; scope++) if (partly[scope] && !own(scope)) isEsm = true;

  const requires = new Set<string>();
  for (const call of calls) {
    if (own(call.scope)) continue;
    if (call.specifier === null) isEsm = true;
    else requires.add(call.specifier);
  }
  return { requires: [...requires], isEsm };
}

export function isPassthroughCjs(filepath: string, source: string): boolean {
  if (!filepath.startsWith('/node_modules/') || !/\.(?:js|cjs)$/i.test(filepath)) return false;
  return !scanCjsModule(source).isEsm;
}

import { parse, type Node } from 'acorn';

export interface CjsScan {
  /** Literal require() specifiers, decoded and de-duplicated in source order. */
  requires: string[];
  /** Needs the compiler: ESM syntax, dynamic import, or syntax we cannot parse. */
  isEsm: boolean;
}

function bindsRequire(pattern: any): boolean {
  if (!pattern) return false;
  switch (pattern.type) {
    case 'Identifier': return pattern.name === 'require';
    case 'RestElement': return bindsRequire(pattern.argument);
    case 'AssignmentPattern': return bindsRequire(pattern.left);
    case 'ArrayPattern': return pattern.elements.some(bindsRequire);
    case 'ObjectPattern': return pattern.properties.some((property: any) =>
      bindsRequire(property.type === 'RestElement' ? property.argument : property.value));
    default: return false;
  }
}

/**
 * Keep published CommonJS off the Babel path, but parse its syntax accurately.
 * Templates, escapes and regex literals cannot be scanned with quote heuristics.
 * Dynamic import must also go through Babel to use the sandbox's resolver.
 * Unknown syntax falls back to the compiler, which supports TS/JSX and reports
 * syntax errors; it must never be handed to the evaluator as trusted JavaScript.
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
  const requires = new Set<string>();
  let isEsm = false;
  const nodes: any[] = [root];
  while (nodes.length) {
    const node = nodes.pop();
    if (node.type.startsWith('Import') || node.type.startsWith('Export') ||
        (node.type === 'MetaProperty' && node.meta.name === 'import')) isEsm = true;
    // Babel's collector understands bindings and static expressions. Defer
    // ambiguous require calls to it instead of inventing dependencies from a
    // library's own loader or missing a statically computable specifier.
    if ((node.type === 'VariableDeclarator' && bindsRequire(node.id)) ||
        (node.type === 'CatchClause' && bindsRequire(node.param)) ||
        (node.type.includes('Function') && (bindsRequire(node.id) || node.params.some(bindsRequire))) ||
        (node.type.startsWith('Class') && bindsRequire(node.id))) isEsm = true;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' &&
        node.callee.name === 'require') {
      const argument = node.arguments[0];
      if (argument?.type === 'Literal' && typeof argument.value === 'string') requires.add(argument.value);
      else isEsm = true;
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
    for (let i = children.length - 1; i >= 0; i--) nodes.push(children[i]);
  }
  return { requires: [...requires], isEsm };
}

export function isPassthroughCjs(filepath: string, source: string): boolean {
  if (!filepath.startsWith('/node_modules/') || !/\.(?:js|cjs)$/i.test(filepath)) return false;
  return !scanCjsModule(source).isEsm;
}

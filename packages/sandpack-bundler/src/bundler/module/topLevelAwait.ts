import { parse, type Node } from 'acorn';

/**
 * Whether `code`, a CommonJS module body, awaits outside every function: an
 * ES module with top-level await, compiled to CommonJS, keeps the `await`
 * where a function body cannot have one.
 */
export function awaitsAtTopLevel(code: string): boolean {
  let root: Node;
  try {
    root = parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
    });
  } catch {
    return false;
  }
  const nodes: any[] = [root];
  while (nodes.length) {
    const node = nodes.pop();
    if (node.type === 'AwaitExpression' || (node.type === 'ForOfStatement' && node.await)) return true;
    // A function has its own await; a class reaches its methods through them.
    if (node.type.includes('Function')) continue;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === 'string') nodes.push(child);
      } else if (value && typeof value === 'object' && typeof (value as Node).type === 'string') {
        nodes.push(value);
      }
    }
  }
  return false;
}

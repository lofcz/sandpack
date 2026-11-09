// The resource-management plugin needs Babel's AST helpers, not a second
// compiler/config loader. Use the helpers from the standalone engine running it.
import { packages } from '@babel/standalone';

export const { types, template, traverse } = packages;

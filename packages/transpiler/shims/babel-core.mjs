// The core-js plugin and its polyfill-provider helper import `@babel/core` for
// Babel's AST helpers, not for a second compiler and config loader. Every build
// of this package resolves that import here, so they get the helpers of the
// standalone engine that runs them, in the browser and in Node alike.
import { packages } from '@babel/standalone';

export const { types, template, traverse } = packages;

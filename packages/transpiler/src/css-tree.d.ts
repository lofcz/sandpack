// CSS Tree exports these lightweight entry points, but its DefinitelyTyped
// package only describes the root. Reuse those exact types for the subpaths.
declare module 'css-tree/parser' { export { parse as default } from 'css-tree'; }
declare module 'css-tree/generator' { export { generate as default } from 'css-tree'; }
declare module 'css-tree/walker' { export { walk as default } from 'css-tree'; }
declare module 'css-tree/utils' { export { ident } from 'css-tree'; }
declare module 'css-tree/tokenizer' { export { TokenStream, tokenize, tokenTypes } from 'css-tree'; }

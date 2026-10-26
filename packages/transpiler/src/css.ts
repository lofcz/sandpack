import parse from 'css-tree/parser';
import generate from 'css-tree/generator';
import walk from 'css-tree/walker';
import { ident } from 'css-tree/utils';
import { TokenStream, tokenize, tokenTypes } from 'css-tree/tokenizer';
import type { Atrule, CssNode, Value } from 'css-tree';

const TAILWIND_DIRECTIVES = new Set([
  'apply', 'theme', 'utility', 'custom-variant', 'variant', 'source', 'reference', 'config', 'plugin',
]);
const LEGACY_LAYERS = new Set(['base', 'components', 'utilities']);
type Edit = { start: number; end: number; text: string };

export interface CssAnalysis {
  requiresTailwind: boolean;
  /** Non-framework imports or actual url() values need the CSS resolver. */
  requiresResolution: boolean;
  /** Compiler-ready CSS; unrelated source bytes and import order are preserved. */
  css: string;
  /** Framework imports with parsed module targets normalized for the compiler. */
  tailwindImports: string[];
  /** CSS for ordinary import resolution, with compiler imports represented by external imports. */
  resolverCss: string;
  /** Restore compiler imports at their original positions after ordinary CSS bundling. */
  restoreImports(css: string): string;
}

function stylesheet(source: string) {
  return parse(source, {
    positions: true,
    // Tailwind adds import options and selector-valued directive preludes. Parse
    // these separately as values only where their grammar calls for it.
    parseAtrulePrelude: false,
    parseCustomProperty: true,
  });
}

function parameters(node: Atrule): Value | null {
  if (!node.prelude) return null;
  const source = node.prelude.type === 'Raw' ? node.prelude.value : generate(node.prelude);
  try {
    return parse(source, { context: 'value', positions: true }) as Value;
  } catch {
    // Extended directive syntax may not be a CSS value. Leave it to its compiler;
    // never infer an import or remove source when its parameters cannot be parsed.
    return null;
  }
}

/** Parse only the import's first component value. CSS Tree's tokenizer supplies
 * its balanced range, so supports() declarations and Tailwind-specific options
 * later in the prelude cannot interfere with recognizing the module token. */
function importParameter(node: Atrule): CssNode | null {
  if (!node.prelude) return null;
  const source = node.prelude.type === 'Raw' ? node.prelude.value : generate(node.prelude);
  const tokens = new TokenStream(source, tokenize);
  tokens.skipSC();
  if (![tokenTypes.String, tokenTypes.Url, tokenTypes.Function].includes(tokens.tokenType)) return null;
  const endToken = tokens.tokenType === tokenTypes.Function ? tokens.getBlockTokenPairIndex(tokens.tokenIndex) : tokens.tokenIndex;
  if (endToken >= tokens.tokenCount) return null;
  try {
    const value = parse(source.slice(0, tokens.getTokenEnd(endToken)), { context: 'value', positions: true }) as Value;
    return value.children.first;
  } catch {
    return null;
  }
}

function importTarget(node: CssNode | null | undefined): string | null {
  if (!node) return null;
  if (node.type === 'String' || node.type === 'Url') return node.value;
  if (node.type === 'Function' && ident.decode(node.name).toLowerCase() === 'url') {
    // CSS Tree represents an escaped function name as Function, rather than Url.
    // Reparse the normalized function using the parser's URL grammar and decoder.
    const value = parse(generate({ ...node, name: 'url' }), { context: 'value' }) as Value;
    return value.children.first?.type === 'Url' ? value.children.first.value : null;
  }
  return null;
}

/** The CSS resolver can add inherited layer/supports/media qualifiers when an
 * imported file contains a compiler import. Preserve that scope around the
 * original compiler directive instead of discarding or merging its options. */
function restoreImportScope(node: Atrule, text: string): string {
  const parsed = parse(generate(node), { context: 'atrule' }) as Atrule;
  if (parsed.prelude?.type !== 'AtrulePrelude') throw new Error('Cannot restore CSS import conditions');
  const conditions = parsed.prelude.children.toArray().slice(1);
  for (const condition of conditions.reverse()) {
    if (condition.type === 'Identifier' && condition.name === 'layer') {
      text = `@layer {${text}}`;
    } else if (condition.type === 'Function' && condition.name === 'layer') {
      text = `@layer ${generate({ type: 'Value', children: condition.children })} {${text}}`;
    } else if (condition.type === 'Function' && condition.name === 'supports') {
      const value = generate({ type: 'Value', children: condition.children });
      const query = condition.children.first?.type === 'Declaration' ? `(${value})` : value;
      text = `@supports ${query} {${text}}`;
    } else if (condition.type === 'MediaQueryList') {
      text = `@media ${generate(condition)} {${text}}`;
    } else {
      throw new Error('Unsupported CSS import condition');
    }
  }
  return text;
}

function applyEdits(source: string, edits: Edit[]): string {
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }
  return source;
}

/** Shared by browser authoring and the bundler, so installing the compiler and
 * invoking it use exactly the same CSS grammar. Strings, comments, selectors and
 * custom-property token streams are never searched for directive-like text. */
export function analyzeCss(source: string): CssAnalysis {
  const ast = stylesheet(source);
  const markers = new Map<string, string>();
  // An external @import keeps subsequent imports valid in the CSS grammar.
  // Scope placeholders to this analysis so imported files cannot collide.
  let markerScope: string | undefined;
  const edits: Edit[] = [];
  const resolverEdits: Edit[] = [];
  const result: CssAnalysis = {
    requiresTailwind: false,
    requiresResolution: false,
    css: source,
    tailwindImports: [],
    resolverCss: source,
    restoreImports(css) {
      if (!markers.size) return css;
      const restore: Edit[] = [];
      walk(stylesheet(css), { visit: 'Atrule', enter(node) {
        if (ident.decode(node.name).toLowerCase() !== 'import') return;
        const target = importTarget(importParameter(node));
        const text = target === null ? undefined : markers.get(target);
        if (text !== undefined && !node.block && node.loc) {
          restore.push({ start: node.loc.start.offset, end: node.loc.end.offset, text: restoreImportScope(node, text) });
        }
      } });
      return applyEdits(css, restore);
    },
  };
  const editBoth = (edit: Edit) => { edits.push(edit); resolverEdits.push(edit); };
  walk(ast, (node) => {
    if (node.type === 'Url' || (node.type === 'Function' && ident.decode(node.name).toLowerCase() === 'url')) {
      result.requiresResolution = true;
    }
    if (node.type !== 'Atrule') return;
    const name = ident.decode(node.name).toLowerCase();
    if (TAILWIND_DIRECTIVES.has(name)) {
      result.requiresTailwind = true;
      // The browser compiler does not decode CSS escapes in directive names.
      if (name !== node.name && node.loc) editBoth({ start: node.loc.start.offset + 1, end: node.loc.start.offset + 1 + node.name.length, text: name });
    }
    if (name === 'import') {
      const first = importParameter(node);
      const target = importTarget(first);
      if (!node.block && target !== null && (target === 'tailwindcss' || target.startsWith('tailwindcss/'))) {
        result.requiresTailwind = true;
        const start = node.loc!.start.offset;
        const end = node.loc!.end.offset;
        // Normalize only the parsed name and module token. Keep all import
        // options and comments; do not truncate strings at embedded semicolons.
        const text = applyEdits(source.slice(start, end), [
          { start: 1, end: 1 + node.name.length, text: 'import' },
          { start: node.prelude!.loc!.start.offset + first!.loc!.start.offset - start,
            end: node.prelude!.loc!.start.offset + first!.loc!.end.offset - start,
            text: generate({ type: 'String', value: target }) },
        ]);
        result.tailwindImports.push(text);
        edits.push({ start, end, text });
        markerScope ??= crypto.randomUUID();
        const marker = `data:text/css,sandpack-tailwind-${markerScope}-${markers.size}`;
        markers.set(marker, text);
        resolverEdits.push({ start, end, text: `@import ${generate({ type: 'String', value: marker })};` });
      } else {
        result.requiresResolution = true;
      }
    }
    if (name === 'tailwind') {
      const params = parameters(node);
      const first = params?.children.first;
      if (first?.type === 'Identifier' && LEGACY_LAYERS.has(ident.decode(first.name))) {
        result.requiresTailwind = true;
        // Only obsolete, standalone v3 layer directives are removed. Preserve
        // additional compiler options and unknown directives for normal validation.
        if (!node.block && params?.children.size === 1 && node.loc) {
          editBoth({ start: node.loc.start.offset, end: node.loc.end.offset, text: '' });
        }
      }
    }
  });
  result.css = applyEdits(source, edits);
  result.resolverCss = applyEdits(source, resolverEdits);
  return result;
}

export function cssNeedsTailwind(source: string): boolean {
  return analyzeCss(source).requiresTailwind;
}

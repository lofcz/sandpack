const IMPORT = /@import\s+(?:url\(\s*)?["']tailwindcss(?:\/[^"']*)?["']\s*\)?[^;]*;/gi;
const LEGACY = /@tailwind\s+(?:base|components|utilities)\s*;/gi;

/** Explicit compiler syntax, not guesses based on class names. */
export function usesTailwind(css: string): boolean {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return /@import\s+(?:url\(\s*)?["']tailwindcss(?:\/|["'])/i.test(source) ||
    /@(?:tailwind\s+(?:base|components|utilities)|apply|theme|utility|custom-variant|variant)\b/i.test(source);
}

/** The browser compiler supplies framework imports; ordinary imports still
 * pass through the normal CSS resolver before the stylesheet is compiled. */
export function withoutTailwindImports(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(IMPORT, '').replace(LEGACY, '');
}

export function tailwindImports(css: string): string {
  const imports = css.replace(/\/\*[\s\S]*?\*\//g, '').match(IMPORT);
  return imports?.join('\n') || '@import "tailwindcss";';
}

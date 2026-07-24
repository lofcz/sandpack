import { CSS_TEXT } from "./__generated__/cssText";

/**
 * Returns the full Sandpack stylesheet as a string.
 *
 * Useful for SSR scenarios where you want to inline the CSS into the HTML
 * `<style>` tag instead of relying on a separate stylesheet request. The text
 * is generated at build time from every vanilla-extract `*.css.ts` file shipped
 * with `@lofcz/sandpack-react`.
 *
 * @category Theme
 *
 * Tip: in environments that allow it, prefer importing the stylesheet directly
 * (`import "@lofcz/sandpack-react/styles.css"`); it lets the browser
 * cache the CSS independently from the HTML payload.
 */
export const getSandpackCssText = (): string => CSS_TEXT;

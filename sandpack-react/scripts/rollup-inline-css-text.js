/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Replaces the `@@SANDPACK_INLINE_CSS_TEXT@@` placeholder in the bundled JS
 * with the contents of the CSS asset emitted by `@vanilla-extract/rollup-plugin`
 * (its `extract` option). This keeps `getSandpackCssText()` working for SSR
 * consumers, even though the canonical way to ship Sandpack styles is now an
 * `import "@lofcz/sandpack-react/styles.css"`.
 */
const PLACEHOLDER = "@@SANDPACK_INLINE_CSS_TEXT@@";

module.exports = function inlineCssText({ cssFileName = "styles.css" } = {}) {
  return {
    name: "sandpack-inline-css-text",
    generateBundle(_options, bundle) {
      const cssAsset = Object.values(bundle).find(
        (asset) =>
          asset.type === "asset" &&
          (asset.fileName === cssFileName ||
            asset.fileName.endsWith("/" + cssFileName)),
      );

      const cssText = cssAsset
        ? typeof cssAsset.source === "string"
          ? cssAsset.source
          : Buffer.from(cssAsset.source).toString("utf8")
        : "";

      const replacement = JSON.stringify(cssText).slice(1, -1);

      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        if (file.code.indexOf(PLACEHOLDER) === -1) continue;
        file.code = file.code.split(PLACEHOLDER).join(replacement);
      }
    },
  };
};

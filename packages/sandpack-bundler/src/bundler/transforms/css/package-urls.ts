import generate from 'css-tree/generator';
import parse from 'css-tree/parser';
import walk from 'css-tree/walker';

import { npmFileUrl } from '../../../FileSystem/npmFileUrl';
import type { NodeModule } from '../../module-registry/NodeModule';

const NODE_MODULES = '/node_modules/';

interface PackageVersions {
  modules: ReadonlyMap<string, Pick<NodeModule, 'version' | 'pinned'>>;
}

export interface PackageCssBase {
  /** `…/name@version/` — references may not leave it. */
  root: string;
  /** Directory of the stylesheet inside {@link root}. */
  base: string;
}

/**
 * Package CSS is injected as a <style> into the preview document, so a relative
 * `url()` resolves against the bundler page, not the package. Locate the
 * stylesheet's directory on the raw npm file origin, at the version the registry
 * pinned, or return null for app files and unpinned (esm.sh fallback) modules.
 */
export function packageCssBase(filePath: string, registry: PackageVersions | undefined): PackageCssBase | null {
  const at = filePath.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const segments = filePath.slice(at + NODE_MODULES.length).split('/');
  const nameLength = segments[0].startsWith('@') ? 2 : 1;
  if (segments.length <= nameLength) return null;
  const name = segments.slice(0, nameLength).join('/');
  // Only a pinned module's files live at `name@version`; an esm.sh range would
  // let the asset drift from the stylesheet.
  const module = registry?.modules.get(name);
  if (!module?.pinned) return null;
  const version = module.version;
  const dir = segments.slice(nameLength, -1).map((segment) => `${encodeURIComponent(segment)}/`).join('');
  const root = npmFileUrl(name, version, '');
  return { root, base: root + dir };
}

/** Rebase one relative reference; absolute, root, fragment and data URLs stay. */
export function rebasePackageUrl(url: string, { root, base }: PackageCssBase): string {
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return url;
  const resolved = new URL(url, base).href;
  // `../` past the package root would point at a different package.
  return resolved.startsWith(root) ? resolved : url;
}

const IMAGE_SET = new Set(['image-set', '-webkit-image-set']);
type Edit = { start: number; end: number; text: string };

/**
 * Rewrite relative `url()` references in a package stylesheet to the package's
 * files. Uses the same tolerant CSS grammar as the loader's analysis and edits
 * only the reference tokens, so every other byte (Tailwind directives, comments,
 * formatting) reaches the loader unchanged and unparseable input is left as is.
 * At-rule preludes (`@import`, `@namespace`) are not parsed, so they never move.
 */
export function rebasePackageCssUrls(source: string, base: PackageCssBase): string {
  if (!/url|image-set/i.test(source)) return source;
  const edits: Edit[] = [];
  try {
    const ast = parse(source, { positions: true, parseAtrulePrelude: false, parseCustomProperty: true });
    walk(ast, function (node) {
      if (!node.loc) return;
      let text: string | null = null;
      if (node.type === 'Url') {
        const url = rebasePackageUrl(node.value, base);
        if (url !== node.value) text = generate({ type: 'Url', value: url });
      } else if (node.type === 'String' && this.function && IMAGE_SET.has(this.function.name.toLowerCase())) {
        // A bare string directly inside image-set() is an image; type("…") is not.
        const url = rebasePackageUrl(node.value, base);
        if (url !== node.value) text = generate({ type: 'String', value: url });
      }
      if (text !== null) edits.push({ start: node.loc.start.offset, end: node.loc.end.offset, text });
    });
  } catch {
    return source;
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }
  return source;
}

/**
 * Boot-time import discovery: the declared packages a live boot installs in its
 * single up-front `/dep_tree` request are the ones the app's local module graph
 * imports. Resolving a module's imports needs the packages installed, so the
 * boot walks the graph before compiling it: each module's specifiers come from
 * the real transform chain (`Bundler.scanModuleSpecifiers`), so the set is what
 * compile will see — imports Babel erases (type-only usage) never install.
 *
 * Anything the walk cannot see (a computed `import()`, a package reached only
 * from an unscanned root) installs on demand when compilation reaches it
 * (`Bundler.resolveAsync`).
 */

// A runaway graph (a vendored tree under the app root) must not stall boot; the
// rest installs on demand.
const MAX_SCANNED_FILES = 2000;

/**
 * Walk the local module graph from `entries` and return every module specifier
 * it loads that leaves the graph (package imports). `moduleSpecifiers` lists a
 * module's raw specifiers; `resolveLocal` resolves one without installing
 * anything — a path under `appRoot` is followed, anything unresolvable or
 * outside is reported. Never throws.
 */
export async function scanLocalImports(opts: {
  entries: string[];
  appRoot: string;
  moduleSpecifiers: (path: string) => Promise<string[]>;
  resolveLocal: (specifier: string, from: string) => Promise<string>;
}): Promise<string[]> {
  const { entries, appRoot, moduleSpecifiers, resolveLocal } = opts;
  const inRoot = (path: string): boolean => path.startsWith(`${appRoot}/`);
  const seen = new Set<string>(entries);
  const queue = [...entries];
  const external = new Set<string>();

  const follow = async (specifier: string, from: string): Promise<void> => {
    let resolved: string;
    try {
      resolved = await resolveLocal(specifier, from);
    } catch {
      external.add(specifier); // not resolvable yet: a package to install
      return;
    }
    if (!inRoot(resolved)) {
      external.add(specifier);
    } else if (!seen.has(resolved) && seen.size < MAX_SCANNED_FILES) {
      seen.add(resolved);
      queue.push(resolved);
    }
  };

  while (queue.length) {
    const batch = queue.splice(0);
    await Promise.all(
      batch.map(async (path) => {
        let specifiers: string[];
        try {
          specifiers = [...(await moduleSpecifiers(path))];
        } catch {
          return; // unreadable: compile reports it
        }
        await Promise.all(specifiers.map((specifier) => follow(specifier, path)));
      }),
    );
  }
  return [...external];
}

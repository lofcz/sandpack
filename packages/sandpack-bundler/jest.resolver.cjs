// Jest 27's default resolver honors neither a package's `exports` field nor its
// `imports` field, so modern exports-only subpaths (e.g. `kerium/log`,
// `utilium/requests`, pulled in transitively by `@zenfs/core`) and subpath
// imports (`#minpath` in `vfile`, pulled in by `@mdx-js/mdx`) fail to resolve.
// This resolver tries the default first and, only on failure, falls back to the
// package's own maps. Transforming those ESM dist files is already handled by
// `transformIgnorePatterns: []` in jest.config.js.
const fs = require('fs');
const path = require('path');
const { resolve: resolveExports } = require('resolve.exports');

// Locate a package's package.json by walking `node_modules` upward. We can't use
// `require.resolve('<pkg>/package.json')` because exports-only packages (e.g.
// kerium) don't export `./package.json`, so that lookup fails.
function findPackageJson(pkgName, basedir) {
  let dir = basedir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', pkgName, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const CONDITIONS = ['node', 'import', 'require', 'default'];

function pickTarget(target) {
  if (typeof target === 'string' || target === null) return target;
  if (Array.isArray(target)) return target.map(pickTarget).find(Boolean) ?? null;
  for (const condition of CONDITIONS) {
    if (condition in target) return pickTarget(target[condition]);
  }
  return null;
}

// `#name` resolves through the `imports` map of the importing file's own
// package: an exact key, or a single-`*` pattern.
function resolveSubpathImport(request, basedir) {
  for (let dir = basedir; ; dir = path.dirname(dir)) {
    const pkgJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const imports = require(pkgJsonPath).imports;
      if (!imports) return null;
      let target = imports[request] !== undefined ? pickTarget(imports[request]) : null;
      if (!target) {
        for (const [key, value] of Object.entries(imports)) {
          const star = key.indexOf('*');
          if (star < 0 || !request.startsWith(key.slice(0, star)) || !request.endsWith(key.slice(star + 1))) continue;
          const match = request.slice(star, request.length - (key.length - star - 1));
          target = pickTarget(value)?.replace('*', match) ?? null;
          break;
        }
      }
      return target ? path.join(dir, target) : null;
    }
    if (path.dirname(dir) === dir) return null;
  }
}

module.exports = (request, options) => {
  const { defaultResolver, basedir } = options;
  try {
    return defaultResolver(request, options);
  } catch (err) {
    if (request.startsWith('#')) {
      const target = resolveSubpathImport(request, basedir);
      if (!target) throw err;
      return target;
    }
    // Only bare package specifiers have an `exports` map to consult.
    if (request.startsWith('.') || path.isAbsolute(request)) throw err;

    const parts = request.split('/');
    const pkgName = request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];

    const pkgJsonPath = findPackageJson(pkgName, basedir);
    if (!pkgJsonPath) throw err;

    let target;
    try {
      target = resolveExports(require(pkgJsonPath), request, {
        conditions: ['node', 'import', 'require', 'default'],
        browser: false,
      });
    } catch {
      throw err;
    }
    if (!target) throw err;

    const relative = Array.isArray(target) ? target[0] : target;
    return path.join(path.dirname(pkgJsonPath), relative);
  }
};

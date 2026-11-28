import gensync from 'gensync';
import picomatch from 'picomatch';

import { ModuleNotFoundError } from '../errors/ModuleNotFound';
import { APP_ROOT } from '../fsLayout';
import * as pathUtils from '../utils/path';
import { PackageImportNotDefinedError, PackagePathNotExportedError } from './errors';
import { PackageTarget, resolvePackageExports, resolvePackageImports } from './utils/exports';
import { FnIsFile, FnReadFile, getParentDirectories, isFile } from './utils/fs';
import { extractModuleSpecifierParts } from './utils/module-specifier';
import { ProcessedPackageJSON, processPackageJSON } from './utils/pkg-json';
import {
  ProcessedTSConfig,
  RawTSConfig,
  getPotentialPathsFromTSConfig,
  mergeTSConfig,
  parseTSConfig,
} from './utils/tsconfig';

export type ResolverCache = Map<string, any>;

export interface IResolveOptionsInput {
  filename: string;
  extensions: string[];
  isFile: FnIsFile;
  readFile: FnReadFile;
  moduleDirectories?: string[];
  resolverCache?: ResolverCache;
}

interface IResolveOptions extends IResolveOptionsInput {
  moduleDirectories: string[];
  resolverCache: ResolverCache;
  // Set on the resolver's own "/index" retry, which must not repeat the fallbacks.
  isIndexRetry?: boolean;
}

function normalizeResolverOptions(opts: IResolveOptionsInput): IResolveOptions {
  const normalizedModuleDirectories: Set<string> = opts.moduleDirectories
    ? new Set(opts.moduleDirectories.map((p) => (p[0] === '/' ? p.substring(1) : p)))
    : new Set();
  normalizedModuleDirectories.add('node_modules');

  return {
    filename: opts.filename,
    extensions: [...new Set(['', ...opts.extensions])],
    isFile: opts.isFile,
    readFile: opts.readFile,
    moduleDirectories: [...normalizedModuleDirectories],
    resolverCache: opts.resolverCache || new Map(),
    isIndexRetry: (opts as IResolveOptions).isIndexRetry,
  };
}

interface IFoundPackageJSON {
  filepath: string;
  content: ProcessedPackageJSON;
}

function* loadPackageJSON(
  filepath: string,
  opts: IResolveOptions,
  rootDir: string = '/'
): Generator<any, IFoundPackageJSON | null, any> {
  const directories = getParentDirectories(filepath, rootDir);
  for (const directory of directories) {
    const packageFilePath = pathUtils.join(directory, 'package.json');
    let packageContent = opts.resolverCache.get(packageFilePath);
    if (packageContent === undefined) {
      try {
        packageContent = processPackageJSON(
          JSON.parse(yield* opts.readFile(packageFilePath)),
          pathUtils.dirname(packageFilePath)
        );
        opts.resolverCache.set(packageFilePath, packageContent);
      } catch (err) {
        opts.resolverCache.set(packageFilePath, false);
      }
    }
    if (packageContent) {
      return {
        filepath: packageFilePath,
        content: packageContent,
      };
    }
  }
  return null;
}

function resolveFile(filepath: string, dir: string): string {
  switch (filepath[0]) {
    case '.':
      return pathUtils.join(dir, filepath);
    case '/':
      return filepath;
    default:
      // is a node module
      return filepath;
  }
}

function resolveAlias(pkgJson: IFoundPackageJSON, filename: string): string {
  const aliases = pkgJson.content.aliases;

  let relativeFilepath = filename;
  let aliasedPath = relativeFilepath;
  let count = 0;
  do {
    relativeFilepath = aliasedPath;

    // Simply check to ensure we don't infinitely alias files due to a misconfiguration of a package/user
    if (count > 5) {
      throw new Error('Could not resolve file due to a cyclic alias');
    }
    count++;

    // Check for direct matches
    if (aliases[relativeFilepath]) {
      aliasedPath = aliases[relativeFilepath];
      continue;
    }

    for (const aliasKey of Object.keys(aliases)) {
      if (!aliasKey.includes('*')) {
        continue;
      }

      // Module paths are POSIX paths whatever the browser runs on.
      const re = picomatch.makeRe(aliasKey, { capture: true, windows: false });
      if (re.test(relativeFilepath)) {
        const val = aliases[aliasKey];
        aliasedPath = relativeFilepath.replace(re, val);
        if (aliasedPath.startsWith(relativeFilepath)) {
          const newAddition = aliasedPath.substr(relativeFilepath.length);
          if (!newAddition.includes('/') && relativeFilepath.endsWith(newAddition)) {
            aliasedPath = relativeFilepath;
          }
        }
        break;
      }
    }

    // No new aliased path
    break;
  } while (relativeFilepath !== aliasedPath);

  return aliasedPath || relativeFilepath;
}

// A `browser` map value written without "./" ("browser.js") names a file of the
// package when the package has that file; otherwise it is a module name, the
// field's other documented use ("fs": "memfs").
function* browserTarget(
  pkgJson: IFoundPackageJSON,
  aliased: string,
  from: string,
  opts: IResolveOptions
): Generator<any, string, any> {
  if (aliased === from) return aliased;
  const file = pkgJson.content.browserFiles?.[aliased];
  if (file && (yield* isFile(file, opts.isFile))) return file;
  return aliased;
}

function* resolveModule(moduleSpecifier: string, opts: IResolveOptions): Generator<any, string, any> {
  const dirPath = pathUtils.dirname(opts.filename);
  const filename = resolveFile(moduleSpecifier, dirPath);
  const isAbsoluteFilename = filename[0] === '/';
  const pkgJson = yield* findPackageJSON(isAbsoluteFilename ? filename : opts.filename, opts);
  return yield* browserTarget(pkgJson, resolveAlias(pkgJson, filename), filename, opts);
}

function targetRequest(target: PackageTarget, pkgRoot: string): string {
  return target.kind === 'file' ? pathUtils.join(pkgRoot, target.path) : target.specifier;
}

// A "#name" specifier: the `imports` field of the package the importing file belongs
// to (its nearest package.json), with the same matching and conditions as `exports`.
function* resolvePackageImport(specifier: string, opts: IResolveOptions): Generator<any, string, any> {
  const pkgJson = yield* loadPackageJSON(pathUtils.dirname(opts.filename), opts);
  if (pkgJson && pkgJson.content.imports !== undefined) {
    const { target } = resolvePackageImports(pkgJson.content.imports, specifier);
    if (target) {
      // A file of that package, or a module resolved from the package's root.
      return yield* resolver(targetRequest(target, pathUtils.dirname(pkgJson.filepath)), {
        ...opts,
        filename: pkgJson.filepath,
      });
    }
  }
  throw new PackageImportNotDefinedError(specifier, opts.filename, pkgJson?.filepath);
}

function* resolveNodeModule(
  moduleSpecifier: string,
  opts: IResolveOptions,
  // The file the import is written in; `opts.filename` moves up the tree below.
  importer: string = opts.filename
): Generator<any, string, any> {
  const pkgSpecifierParts = extractModuleSpecifierParts(moduleSpecifier);
  const directories = getParentDirectories(opts.filename);
  for (const modulesPath of opts.moduleDirectories) {
    for (const directory of directories) {
      const rootDir = pathUtils.join(directory, modulesPath, pkgSpecifierParts.pkgName);

      try {
        const rootPkg = yield* loadPackageJSON(rootDir, opts, rootDir);

        // `exports` decides what an import of the package loads (Node's
        // PACKAGE_EXPORTS_RESOLVE). The target then resolves like any file of the
        // package, so the `browser` map still applies to it.
        let notExported: PackagePathNotExportedError | undefined;
        if (rootPkg && rootPkg.content.exports !== undefined) {
          const subpath = pkgSpecifierParts.filepath ? `./${pkgSpecifierParts.filepath}` : '.';
          const exported = resolvePackageExports(rootPkg.content.exports, subpath);
          const refusal = (excluded: boolean) =>
            new PackagePathNotExportedError(
              moduleSpecifier,
              importer,
              rootPkg.content.name ?? pkgSpecifierParts.pkgName ?? moduleSpecifier,
              subpath,
              excluded
            );
          if (exported.target) {
            try {
              return yield* resolver(targetRequest(exported.target, rootDir), { ...opts, filename: rootPkg.filepath });
            } catch {
              // The exported file is missing: the path below may still name one.
            }
          } else if (exported.reason === 'excluded') {
            throw refusal(true);
          } else {
            // Not listed. Node stops here; a path that names an existing file of the
            // package still loads, as it always has here and as the CDN serves it
            // (it takes file paths as entries). Only a path that is neither is refused.
            notExported = refusal(false);
          }
        }

        const pkgFilePath = pathUtils.join(rootDir, pkgSpecifierParts.filepath);
        // The nearest package.json at or above the path (a module the bundler writes
        // itself may only have one beside its file, none at the package root).
        const pkgJson = pkgSpecifierParts.filepath ? yield* loadPackageJSON(pkgFilePath, opts, rootDir) : rootPkg;
        if (pkgJson) {
          try {
            return yield* resolver(pkgFilePath, {
              ...opts,
              filename: pkgJson.filepath,
            });
          } catch (err) {
            if (!pkgSpecifierParts.filepath) {
              try {
                return yield* resolver(pathUtils.join(pkgFilePath, 'index'), {
                  ...opts,
                  filename: pkgJson.filepath,
                });
              } catch (indexErr) {
                throw notExported ?? indexErr;
              }
            }

            throw notExported ?? err;
          }
        }
      } catch (err) {
        // What a package does not export is final: another copy is not consulted.
        if (err instanceof PackagePathNotExportedError) {
          throw err;
        }

        // Handle multiple duplicates of a node_module across the tree
        if (directory.length > 1) {
          return yield* resolveNodeModule(
            moduleSpecifier,
            {
              ...opts,
              filename: pathUtils.dirname(directory),
            },
            importer
          );
        }

        throw err;
      }
    }
  }
  throw new ModuleNotFoundError(moduleSpecifier, opts.filename);
}

function* findPackageJSON(filepath: string, opts: IResolveOptions): Generator<any, IFoundPackageJSON, any> {
  let pkg = yield* loadPackageJSON(filepath, opts);
  if (!pkg) {
    pkg = yield* loadPackageJSON('/index', opts);
    if (!pkg) {
      return {
        filepath: '/package.json',
        content: {
          aliases: {},
        },
      };
    }
  }
  return pkg;
}

function* expandFile(
  filepath: string,
  opts: IResolveOptions,
  expandCount: number = 0
): Generator<any, string | null, any> {
  const pkg = yield* findPackageJSON(filepath, opts);

  if (expandCount > 5) {
    throw new Error('Cyclic alias detected');
  }

  for (const ext of opts.extensions) {
    const f = filepath + ext;
    const aliasedPath = yield* browserTarget(pkg, resolveAlias(pkg, f), f, opts);
    if (aliasedPath === f) {
      const exists = yield* isFile(f, opts.isFile);
      if (exists) {
        return f;
      }
    } else {
      const expanded = yield* expandFile(aliasedPath, { ...opts, extensions: [''] }, expandCount + 1);
      if (expanded) {
        return expanded;
      }
    }
  }
  return null;
}

// What TypeScript's resolution reads an import's JavaScript extension as: the source
// file it is compiled from ("./x.js" written in a .ts file names x.ts or x.tsx).
const TS_SOURCE_EXTENSIONS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

// Last resorts for a path that names no file and no directory index. They run after
// every exact candidate, so an import that resolves today costs nothing more.
function* expandFallbacks(filepath: string, opts: IResolveOptions): Generator<any, string | null, any> {
  const only = (extensions: string[]) => ({ ...opts, extensions });
  const tsExtensions = TS_SOURCE_EXTENSIONS[pathUtils.extname(filepath)];
  // Only for a caller that loads TypeScript at all.
  if (tsExtensions && (opts.extensions.includes('.ts') || opts.extensions.includes('.tsx'))) {
    const base = filepath.slice(0, filepath.length - pathUtils.extname(filepath).length);
    const found = yield* expandFile(base, only(tsExtensions));
    if (found) return found;
  }
  // Node's own list is .js, .json: an extensionless script import may name a JSON file.
  if (opts.extensions.includes('.js') && !opts.extensions.includes('.json')) {
    return yield* expandFile(filepath, only(['.json']));
  }
  return null;
}

export function normalizeModuleSpecifier(specifier: string): string {
  const normalized = specifier.replace(/(\/|\\)+/g, '/');
  if (normalized.endsWith('/')) {
    return normalized.substring(0, normalized.length - 1);
  }
  return normalized;
}

const TS_CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'];

function* readTSConfig(filepath: string, opts: IResolveOptions): Generator<any, RawTSConfig | null, any> {
  try {
    return parseTSConfig(yield* opts.readFile(filepath), pathUtils.dirname(filepath));
  } catch {
    // Missing or not JSON: no config here.
    return null;
  }
}

// The path mapping of the tsconfig.json (else jsconfig.json) in `root`, read once per
// resolver cache.
function* getTSConfig(root: string, opts: IResolveOptions): Generator<any, ProcessedTSConfig | false, any> {
  const cacheKey = `__tsconfig:${root}`;
  const cachedConfig = opts.resolverCache.get(cacheKey);
  if (cachedConfig != null) {
    return cachedConfig;
  }

  let config: ProcessedTSConfig | false = false;
  for (const name of TS_CONFIG_NAMES) {
    const own = yield* readTSConfig(pathUtils.join(root, name), opts);
    if (!own) continue;
    // One level of `extends`, and only when it can change the mapping.
    const bases: RawTSConfig[] = [];
    if (own.extends.length && (own.baseUrl === undefined || own.paths === undefined)) {
      for (const base of own.extends) {
        const parsed = yield* readTSConfig(base, opts);
        if (parsed) bases.push(parsed);
      }
    }
    config = mergeTSConfig(own, bases) || false;
    break;
  }
  opts.resolverCache.set(cacheKey, config);
  return config;
}

// A bare specifier through the path mapping of the config in `root`; null when the
// config maps it to nothing that exists.
function* resolveTSConfigPath(
  specifier: string,
  root: string,
  opts: IResolveOptions
): Generator<any, string | null, any> {
  const parsedTSConfig = yield* getTSConfig(root, opts);
  if (parsedTSConfig) {
    for (const potentialPath of getPotentialPathsFromTSConfig(specifier, parsedTSConfig)) {
      try {
        return yield* resolver(potentialPath, opts);
      } catch {
        // do nothing, it's probably a node_module in this case
      }
    }
  }
  return null;
}

export const resolver = gensync<(moduleSpecifier: string, inputOpts: IResolveOptionsInput) => string>(function* resolve(
  moduleSpecifier,
  inputOpts
): Generator<any, string, any> {
  const normalizedSpecifier = normalizeModuleSpecifier(moduleSpecifier);
  const opts = normalizeResolverOptions(inputOpts);
  if (normalizedSpecifier[0] === '#') {
    return yield* resolvePackageImport(normalizedSpecifier, opts);
  }
  const modulePath = yield* resolveModule(normalizedSpecifier, opts);

  if (modulePath[0] !== '/') {
    // This isn't a node module, we can attempt to resolve using a tsconfig/jsconfig
    const isProjectFile = !opts.filename.includes('/node_modules');
    if (isProjectFile) {
      const mapped = yield* resolveTSConfigPath(modulePath, '/', opts);
      if (mapped) return mapped;
    }

    let notFound: ModuleNotFoundError;
    try {
      return yield* resolveNodeModule(modulePath, opts);
    } catch (e) {
      // Says which package refused the path; "cannot find" would hide that.
      notFound =
        e instanceof PackagePathNotExportedError ? e : new ModuleNotFoundError(normalizedSpecifier, opts.filename);
    }

    // The app's own config (the app is mounted under APP_ROOT) is only asked about a
    // specifier that names neither an installed package nor one the app declares
    // (that one is about to be installed): looking the config up is a round trip to
    // the host, which a build whose imports are all packages must not pay. An alias
    // therefore cannot shadow a package.
    if (isProjectFile && opts.filename.startsWith(`${APP_ROOT}/`)) {
      const appPkg = yield* findPackageJSON(opts.filename, opts);
      const name = extractModuleSpecifierParts(modulePath).pkgName;
      if (!name || !appPkg.content.declared?.has(name)) {
        const mapped = yield* resolveTSConfigPath(modulePath, APP_ROOT, opts);
        if (mapped) return mapped;
      }
    }
    throw notFound;
  }

  let foundFile = yield* expandFile(modulePath, opts);
  if (!foundFile) {
    foundFile = yield* expandFile(pathUtils.join(modulePath, 'index'), opts);

    if (!foundFile && !opts.isIndexRetry) {
      foundFile = yield* expandFallbacks(modulePath, opts);
    }

    // In case alias adds an extension, we retry the entire resolution with an added /index
    // This is mostly a hack I guess, but it works for now, so many edge-cases
    if (!foundFile) {
      try {
        const parts = moduleSpecifier.split('/');
        if (!parts.length || !parts[parts.length - 1].startsWith('index')) {
          foundFile = yield* resolve(moduleSpecifier + '/index', { ...opts, isIndexRetry: true } as IResolveOptions);
        }
      } catch (err) {
        // should throw ModuleNotFound for original specifier, not new one
      }
    }
  }

  if (!foundFile) {
    throw new ModuleNotFoundError(modulePath, opts.filename);
  }

  return foundFile;
});

export const resolveSync = resolver.sync;
export const resolveAsync = resolver.async;

import * as pathUtils from '../../utils/path';
import { normalizeAliasFilePath } from './alias';
import { EMPTY_SHIM } from './constants';
import { resolvePackageExports } from './exports';

// alias/exports/main keys, sorted from high to low priority
const MAIN_PKG_FIELDS = ['module', 'browser', 'main', 'jsnext:main'];
const PKG_ALIAS_FIELDS = ['browser', 'alias'];

type AliasesDict = { [key: string]: string };

export interface ProcessedPackageJSON {
  // Replacements that apply to every path resolved inside the package: its main
  // file, and the `browser` and `alias` maps. `exports` is not one of them: it only
  // decides what a bare import of the package loads (see resolveNodeModule), and
  // must not rewrite the package's own relative imports or a `browser` replacement
  // with the same key.
  aliases: AliasesDict;
  name?: string;
  // The raw `exports` and `imports` fields, resolved per request (utils/exports.ts).
  exports?: unknown;
  imports?: unknown;
  // `browser` map values written without "./": the value as written -> the file of
  // this package it would name. Whether it is that file or a module is only known
  // once the file is looked up (see browserTarget in the resolver).
  browserFiles?: AliasesDict;
  // Names of the packages this package.json declares it depends on.
  declared?: Set<string>;
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

export function processPackageJSON(content: any, pkgRoot: string): ProcessedPackageJSON {
  if (!content || typeof content !== 'object') {
    return { aliases: {} };
  }

  const aliases: AliasesDict = {};
  for (const mainField of MAIN_PKG_FIELDS) {
    if (typeof content[mainField] === 'string') {
      aliases[pkgRoot] = normalizeAliasFilePath(content[mainField], pkgRoot);
      break;
    }
  }

  if (content.browser === false) {
    aliases[pkgRoot] = EMPTY_SHIM;
  }

  let browserFiles: AliasesDict | undefined;
  for (const aliasFieldKey of PKG_ALIAS_FIELDS) {
    const aliasField = content[aliasFieldKey];
    if (typeof aliasField === 'object') {
      for (const key of Object.keys(aliasField)) {
        const val = aliasField[key] || EMPTY_SHIM;
        const normalizedKey = normalizeAliasFilePath(key, pkgRoot, false);
        const normalizedValue = normalizeAliasFilePath(val, pkgRoot, false);
        aliases[normalizedKey] = normalizedValue;

        if (aliasFieldKey !== 'browser') {
          aliases[`${normalizedKey}/*`] = `${normalizedValue}/$1`;
        } else if (typeof val === 'string' && normalizedValue === val && val[0] !== '/') {
          (browserFiles ??= {})[val] = pathUtils.join(pkgRoot, val);
        }
      }
    }
  }

  const processed: ProcessedPackageJSON = { aliases };
  if (typeof content.name === 'string') processed.name = content.name;
  if (browserFiles) processed.browserFiles = browserFiles;
  if (content.imports && typeof content.imports === 'object') processed.imports = content.imports;
  for (const field of DEPENDENCY_FIELDS) {
    if (content[field] && typeof content[field] === 'object') {
      for (const name of Object.keys(content[field])) (processed.declared ??= new Set()).add(name);
    }
  }

  // load exports if it's not the root pkg.json
  if (content.exports && pkgRoot !== '/') {
    processed.exports = content.exports;
    // The package directory itself, reached by path (`require('..')`), loads what a
    // bare import of the package loads.
    const main = resolvePackageExports(content.exports, '.').target;
    if (main?.kind === 'file') {
      aliases[pkgRoot] = pathUtils.join(pkgRoot, main.path);
    }
  }

  return processed;
}

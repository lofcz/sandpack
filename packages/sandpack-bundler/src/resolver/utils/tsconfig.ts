import stripJsonComments from 'strip-json-comments';

import * as pathUtils from '../../utils/path';

export interface ProcessedTSConfig {
  // Absolute; only set when the config (or the one it extends) sets `baseUrl`.
  baseUrl?: string;
  // Pattern -> absolute substitutions, each keeping its "*".
  paths: Record<string, string[]>;
}

/** The parts of one tsconfig/jsconfig file path mapping needs, before `extends` is applied. */
export interface RawTSConfig {
  dir: string;
  baseUrl?: string;
  paths?: Record<string, unknown>;
  /** Relative configs this one extends, as absolute file paths. */
  extends: string[];
}

export function parseTSConfig(content: string, dir: string): RawTSConfig {
  const parsed = JSON.parse(stripJsonComments(content));
  const options = parsed?.compilerOptions || {};
  const bases: unknown[] = Array.isArray(parsed?.extends) ? parsed.extends : [parsed?.extends];
  return {
    dir,
    baseUrl: typeof options.baseUrl === 'string' ? pathUtils.join(dir, options.baseUrl) : undefined,
    paths: options.paths && typeof options.paths === 'object' ? options.paths : undefined,
    // A package's config (`@tsconfig/x`) is not followed, only files of the project.
    extends: bases
      .filter((base): base is string => typeof base === 'string' && (base.startsWith('./') || base.startsWith('../')))
      .map((base) => pathUtils.join(dir, base.endsWith('.json') ? base : `${base}.json`)),
  };
}

/**
 * The path mapping of a config and the configs it extends (the config's own options
 * win; among bases, the later one). As in TypeScript, `paths` are relative to
 * `baseUrl` when one is set and to the config file that declares them otherwise.
 */
export function mergeTSConfig(config: RawTSConfig, bases: RawTSConfig[] = []): ProcessedTSConfig | null {
  const chain = [config, ...bases.slice().reverse()];
  const baseUrl = chain.find((c) => c.baseUrl !== undefined)?.baseUrl;
  const declaring = chain.find((c) => c.paths !== undefined);
  if (baseUrl === undefined && !declaring) return null;

  const paths: ProcessedTSConfig['paths'] = {};
  if (declaring?.paths) {
    const root = baseUrl ?? declaring.dir;
    for (const pattern of Object.keys(declaring.paths)) {
      const substitutions = declaring.paths[pattern];
      if (!Array.isArray(substitutions)) continue;
      paths[pattern] = substitutions
        .filter((value): value is string => typeof value === 'string')
        .map((value) => pathUtils.join(root, value));
    }
  }
  return { baseUrl, paths };
}

export function processTSConfig(content: string, dir: string = '/'): ProcessedTSConfig | null {
  return mergeTSConfig(parseTSConfig(content, dir));
}

export function getPotentialPathsFromTSConfig(moduleSpecifier: string, config: ProcessedTSConfig): string[] {
  const res: string[] = [];
  // TypeScript's rule: an exact pattern, else the pattern with the longest prefix.
  let best: { pattern: string; prefix: string; suffix: string } | undefined;
  if (!Object.prototype.hasOwnProperty.call(config.paths, moduleSpecifier) || moduleSpecifier.includes('*')) {
    for (const pattern of Object.keys(config.paths)) {
      const star = pattern.indexOf('*');
      if (star < 0) continue;
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (
        moduleSpecifier.length >= prefix.length + suffix.length &&
        moduleSpecifier.startsWith(prefix) &&
        moduleSpecifier.endsWith(suffix) &&
        (!best || prefix.length > best.prefix.length)
      ) {
        best = { pattern, prefix, suffix };
      }
    }
    if (best) {
      const matched = moduleSpecifier.slice(best.prefix.length, moduleSpecifier.length - best.suffix.length);
      for (const substitution of config.paths[best.pattern]) {
        res.push(substitution.replace('*', () => matched));
      }
    }
  } else {
    res.push(...config.paths[moduleSpecifier]);
  }
  // Bare specifiers resolve from `baseUrl` only when the config sets one.
  if (config.baseUrl !== undefined) {
    res.push(pathUtils.join(config.baseUrl, moduleSpecifier));
  }
  return res;
}

#!/usr/bin/env node
/*
 * Config-driven deploy: copies each build artifact into its destination root.
 * Nothing about the consumer (Priprava or otherwise) is hardcoded — the
 * artifact→destination mapping lives in deploy.config.json and the roots are
 * supplied at deploy time.
 *
 * Roots are resolved per target's `root` name, first match wins:
 *   1. CLI flag   --<root>=<path>            (e.g. --wwwroot=C:\app\wwwroot)
 *   2. Env var    SANDPACK_DEPLOY_<ROOT>     (uppercased, dashes → underscores)
 * A `--content-root=<path>` convenience flag expands to the conventional
 * sub-roots used by the reference host (wwwroot → <content-root>/src/wwwroot,
 * tools → <content-root>/Tools) when those roots aren't set explicitly.
 *
 * Usage:
 *   node scripts/deploy.mjs --wwwroot=... --tools=...
 *   node scripts/deploy.mjs --content-root=C:\path\to\Priprava
 *   node scripts/deploy.mjs --dry-run --content-root=...
 *   SANDPACK_DEPLOY_WWWROOT=... SANDPACK_DEPLOY_TOOLS=... node scripts/deploy.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BINARY = process.platform === 'win32' ? 'sandpack-cdn.exe' : 'sandpack-cdn';

const args = process.argv.slice(2);
const flags = {};
for (const a of args) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] ?? true;
}
const dryRun = Boolean(flags['dry-run']);

const configPath = join(ROOT, 'deploy.config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

// Conventional sub-roots of the reference host, expanded from --content-root.
const CONTENT_ROOT_DEFAULTS = {
  wwwroot: (cr) => join(cr, 'src', 'wwwroot'),
  tools: (cr) => join(cr, 'Tools'),
};

function resolveRoot(name) {
  if (typeof flags[name] === 'string') return resolve(flags[name]);
  const envKey = `SANDPACK_DEPLOY_${name.toUpperCase().replace(/-/g, '_')}`;
  if (process.env[envKey]) return resolve(process.env[envKey]);
  const cr = flags['content-root'] ?? process.env.SANDPACK_DEPLOY_CONTENT_ROOT;
  if (cr && CONTENT_ROOT_DEFAULTS[name]) return resolve(CONTENT_ROOT_DEFAULTS[name](resolve(cr)));
  return null;
}

let failures = 0;
for (const target of config.targets) {
  if (target.enabled === false) {
    console.log(`⊘ ${target.name}: disabled, skipping`);
    continue;
  }
  const rootPath = resolveRoot(target.root);
  if (!rootPath) {
    console.error(
      `✗ ${target.name}: no value for root "${target.root}". ` +
        `Pass --${target.root}=<path>, set SANDPACK_DEPLOY_${target.root.toUpperCase()}, or use --content-root.`,
    );
    failures++;
    continue;
  }
  const fromRel = target.from.replace('{binary}', BINARY);
  const from = join(ROOT, fromRel);
  const dest = join(rootPath, target.into);

  if (!existsSync(from)) {
    console.error(`✗ ${target.name}: artifact not found: ${fromRel} (did you run \`bun run build\`?)`);
    failures++;
    continue;
  }

  const isDir = statSync(from).isDirectory();
  console.log(`→ ${target.name}: ${fromRel}  →  ${dest}${dryRun ? '  (dry-run)' : ''}`);
  if (dryRun) continue;

  mkdirSync(dirname(dest), { recursive: true });
  if (isDir) {
    // Replace the destination so stale hashed chunks from a prior build vanish
    // (the bundler's index.html pins exact hashed names).
    rmSync(dest, { recursive: true, force: true });
    cpSync(from, dest, { recursive: true });
  } else {
    mkdirSync(dest, { recursive: true });
    cpSync(from, join(dest, BINARY));
  }
}

if (failures) {
  console.error(`\n${failures} target(s) failed.`);
  process.exit(1);
}
console.log(dryRun ? '\nDry run OK.' : '\nDeploy complete.');

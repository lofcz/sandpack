#!/usr/bin/env node
// build-stamp.mjs — give each forked sandpack package's built `dist/` a resolvable
// version stamp (R3-105). Run AFTER `yarn build` (appended to the root `build` script).
//
// The fork's `dist/` is gitignored and hand-rebuilt, and site-main consumes it via a
// `file:` dependency — so a `dist/` left stale after a `src/` edit silently ships old
// bytes (the R3-114 / file-explorer-panel-race #5 class of bug). The stamp records what
// the dist was built from (`srcHash` + `builtAt` + the package `version`) so a consumer
// can tell, at boot, whether the dist matches today's source (see site-main's
// check-fork-freshness). It also gives the otherwise-unversioned local build a resolvable
// identity, the first half of "version prebuilt artifacts instead of vendoring".
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const STAMP_FILE = '.ir-build-stamp.json';
const PACKAGES = ['sandpack-client', 'sandpack-react', 'sandpack-themes'];

/** A deterministic content hash of a source tree: sha256 over sorted
 *  `relpath\0sha256(bytes)` lines. Order-stable, ignores mtimes. */
export function hashSrcDir(srcDir) {
  const entries = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules' || name === 'dist') continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs, `${rel}${name}/`);
      else entries.push(`${rel}${name}\0${createHash('sha256').update(readFileSync(abs)).digest('hex')}`);
    }
  };
  walk(srcDir, '');
  return createHash('sha256').update(entries.sort().join('\n')).digest('hex');
}

function stampPackage(pkgName, builtAt) {
  const pkgDir = join(ROOT, pkgName);
  const srcDir = join(pkgDir, 'src');
  const distDir = join(pkgDir, 'dist');
  if (!existsSync(distDir)) {
    console.warn(`build-stamp: ${pkgName} has no dist/ — skipped (not built).`);
    return false;
  }
  const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
  const stamp = { name: pkgName, version, srcHash: hashSrcDir(srcDir), builtAt };
  writeFileSync(join(distDir, STAMP_FILE), `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(`build-stamp: ${pkgName}@${version} → ${stamp.srcHash.slice(0, 12)}`);
  return true;
}

// `builtAt` is passed in / stamped once per run so all three packages share it.
if (import.meta.url === `file://${process.argv[1]}`) {
  const builtAt = new Date().toISOString();
  let stamped = 0;
  for (const p of PACKAGES) if (stampPackage(p, builtAt)) stamped++;
  console.log(`build-stamp: stamped ${stamped}/${PACKAGES.length} package(s).`);
}

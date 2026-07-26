#!/usr/bin/env node
/*
 * Build the sandpack-cdn Rust sidecar in release mode. Output lands at
 * crates/sandpack-cdn/target/release/sandpack-cdn[.exe]; the deploy script
 * copies it into the host's Tools dir (see deploy.config.json).
 *
 * Requires `cargo` on PATH. Pass extra args through to cargo, e.g.:
 *   node scripts/build-cdn.mjs -- --profile release-with-debug
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = join(ROOT, 'crates', 'sandpack-cdn');

const passthrough = process.argv.slice(2);
const extra = passthrough[0] === '--' ? passthrough.slice(1) : passthrough;

const cargoArgs = ['build', '--release', ...extra];
console.log(`cargo ${cargoArgs.join(' ')}  (cwd: crates/sandpack-cdn)`);
const res = spawnSync('cargo', cargoArgs, { cwd: CRATE, stdio: 'inherit' });
if (res.error) {
  console.error(`Failed to run cargo: ${res.error.message}. Is the Rust toolchain installed?`);
  process.exit(1);
}
process.exit(res.status ?? 1);

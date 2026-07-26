# sandpack

Monorepo for the forked Sandpack stack that powers the sciobot coding workspace.
One place to build everything, one config-driven script to deploy the artifacts
a host (e.g. Priprava) needs.

## Packages

| Path | Package | What it is | Consumed how |
|---|---|---|---|
| `packages/transpiler` | `@lofcz/transpiler` | Babel/MDX transform chain + the prebuilt same-origin transform worker (`worker/babel-worker.js`) | npm workspace dep of the bundler; `file:` dep of sciobot (worker served from `node_modules`) |
| `packages/sandpack-client` | `@lofcz/sandpack-client` | Fork of `@codesandbox/sandpack-client` (ZenFS / immutable-fetch patches) | `file:` dep of sciobot |
| `packages/sandpack-bundler` | `sandpack-bundler` | Parcel bundler running in the preview iframe | **copied** → host `wwwroot/sandpack-bundler/` |
| `crates/sandpack-cdn` | `sandpack-cdn` (Rust) | npm dep-tree resolver + pre-transpiled package cache sidecar | **copied** → host `Tools/SandpackCdn/` |

External (not in this repo): `@immediately-run/worker-transport` and
`@immediately-run/mdx-plugins` remain ordinary npm dependencies of the
transpiler — small, stable, and not forked by us.

## Layout

```
packages/           JS/TS packages (bun workspaces)
crates/             Rust crates
scripts/            orchestrator (build-cdn, deploy)
deploy.config.json  artifact → destination mapping (no hardcoded host paths)
```

## Build everything

```bash
bun install
bun run build        # transpiler → client → bundler → cdn
```

Per-package: `bun run build:transpiler|build:client|build:bundler|build:cdn`.

## Deploy (config-driven, no hardcoded paths)

`scripts/deploy.mjs` reads `deploy.config.json`. Each target names a logical
`root` resolved at deploy time — never a baked-in repo path.

```bash
# explicit roots
bun run deploy -- --wwwroot=C:\app\wwwroot --tools=C:\app\Tools

# or the reference host's content-root (expands wwwroot/tools conventions)
node scripts/deploy.mjs --content-root=C:\path\to\Priprava

# dry run (print the mapping, copy nothing)
node scripts/deploy.mjs --dry-run --content-root=...
```

Root resolution order: `--<root>=<path>` flag → `SANDPACK_DEPLOY_<ROOT>` env →
`--content-root` convention. See `deploy.config.json` for the target list and
`deploy.config.schema.json` for the shape.

## Inter-package versions

- `sandpack-bundler` depends on `@lofcz/transpiler` via `workspace:*`, so the
  toolchain hash it bakes at build time always matches the local transpiler.
- The CDN protocol version must stay in lockstep across:
  `packages/sandpack-bundler/src/bundler/module-registry/module-cdn.ts` (`CDN_VERSION`)
  and the host's process service (`CdnProtocolVersion`). Currently **5**.

## Notes

- This monorepo was seeded by copying working trees (no per-repo git history).
  The original single-repo forks are now superseded; treat this as the source of truth.
- `sandpack-cdn`'s on-disk package cache is versioned by `DISK_FORMAT`
  (`crates/sandpack-cdn/src/package/disk_cache.rs`) — bump it to invalidate stale
  transformed artifacts rather than reaching for content-sniffing band-aids.

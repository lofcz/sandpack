# Priprava integration

How the Priprava host consumes the artifacts this monorepo builds. Nothing here
is wired into Priprava automatically — you run the deploy step; Priprava just
serves/spawns what lands in its conventional locations.

## What Priprava expects

| Artifact | Priprava location | Served/spawned as |
|---|---|---|
| `packages/sandpack-bundler/dist/*` | `src/wwwroot/sandpack-bundler/` | Static files at `/sandpack-bundler/` (`index.html` no-cache, hashed chunks immutable) — see `WebConfig.cs` |
| `crates/sandpack-cdn/target/release/sandpack-cdn[.exe]` | `Tools/SandpackCdn/` | Spawned + reverse-proxied at `/sandpack-cdn/` — see `SandpackCdnProcessService.cs` |

## One command

From the monorepo root:

```bash
bun install
bun run build
node scripts/deploy.mjs --content-root=C:\path\to\Priprava
```

`--content-root` expands to Priprava's conventions:
- `wwwroot` → `<content-root>\src\wwwroot`
- `tools`   → `<content-root>\Tools`

Prefer explicit roots (or a different host layout)? Override either:

```bash
node scripts/deploy.mjs --wwwroot=D:\sites\app\wwwroot --tools=D:\sites\app\Tools
# or via env
set SANDPACK_DEPLOY_WWWROOT=D:\sites\app\wwwroot
set SANDPACK_DEPLOY_TOOLS=D:\sites\app\Tools
node scripts/deploy.mjs
```

Preview the mapping without copying:

```bash
node scripts/deploy.mjs --dry-run --content-root=C:\path\to\Priprava
```

The artifact→destination mapping lives in `deploy.config.json` (validated by
`deploy.config.schema.json`); edit it to add targets or change destinations.

## After deploying the CDN binary

Priprava's `SandpackCdnProcessService` watches `Tools/SandpackCdn/`. If the CDN
was already running, restart it from the admin page (Force Restart) so it picks
up the new binary. Prewarm re-runs automatically once the process is healthy.

## Version lockstep (do not drift)

- **CDN protocol**: `packages/sandpack-bundler/.../module-cdn.ts` (`CDN_VERSION`)
  must equal `CdnProtocolVersion` in `SandpackCdnProcessService.cs` (currently **5**).
- **Toolchain hash**: baked into the bundler at build time from the *local*
  `@lofcz/transpiler` (a `workspace:*` dep), so the bundler and transpiler can
  never silently skew.
- **CDN disk cache**: bump `DISK_FORMAT` in
  `crates/sandpack-cdn/src/package/disk_cache.rs` to invalidate stale transformed
  package artifacts after a transpiler/CDN change.

## sciobot (browser app)

sciobot consumes the JS packages directly from this monorepo via `file:` deps:
- `@codesandbox/sandpack-client` → `file:../sandpack/packages/sandpack-client`
- `@lofcz/transpiler` → `file:../sandpack/packages/transpiler`

Vite resolves the transform worker from `node_modules/@lofcz/transpiler/worker`
(see sciobot's `vite.config.ts`), so it always matches the linked transpiler.
Both packages share a single `@zenfs/core` (peer-aligned to `~2.5.8`).

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

Deploy the bundler before upgrading the runtime client. The new client announces
`hostControlledRefresh` in its registration; the bundler then sends
`request-refresh`, and the client navigates to its configured preview URL and
authorizes that boot. Older clients retain their existing reload flow.
Unsolicited iframe boots are refused, and `onUnexpectedNavigation` lets the host recreate the
client or display the refusal. The host retains ownership of the supplied
`SandpackFS`; destroying a client does not dispose that shared filesystem.

Large CDN payloads use `POST /dep_tree` or `POST /package` with the same
versioned base64 payload in a `text/plain` body (maximum 64 KiB). Short payloads
retain the legacy GET routes. Deploy the CDN and enable request-body forwarding
in the host reverse proxy before updating the bundler. POST replies are not
cached by URL; the CDN still caches exact package transformations internally.
This avoids proxy path-segment limits without splitting a dependency graph into
independently resolved pieces.

Stylesheets with explicit Tailwind compiler directives use the installed
`@tailwindcss/browser` runtime. The host should include that dependency in the
initial manifest when accepting such a stylesheet. The bundler preserves
`@apply`, theme declarations and import options, supplies the runtime from the
CSS module, and emits `text/tailwindcss` styles that also update under HMR.
Ordinary stylesheets keep the normal CSS path.

- `sandpack-bundler` depends on `@lofcz/transpiler` via `workspace:*`, so the
  toolchain hash it bakes at build time always matches the local transpiler.
- The CDN protocol version must stay in lockstep across:
  `packages/sandpack-bundler/src/bundler/module-registry/module-cdn.ts` (`CDN_VERSION`)
  and the host's process service (`CdnProtocolVersion`). Currently **7**. `/dep_tree` takes
  `{ "deps": { ... }, "pins": { ... }, "entries": { "react-dom": ["./client"] } }` (`pins` and
  `entries` optional; a package without entries loads `.`) and only follows the package imports of
  those entries' closures; each tree entry reports its entries as `e`. `/package` takes
  `{ "name", "version", "entry" }`: one entry's closure, or with `"entry": null` the release's file
  listing. Each is its own immutable GET, so the bundler caches entries independently. Deploy the
  bundler, CDN binary, and host prewarmer together; clients on an older protocol get
  `InvalidCDNVersion` and need to reload.

## Notes

- This monorepo was seeded by copying working trees (no per-repo git history).
  The original single-repo forks are now superseded; treat this as the source of truth.
- `sandpack-cdn`'s on-disk package cache is versioned by `DISK_FORMAT`
  (`crates/sandpack-cdn/src/package/disk_cache.rs`) — bump it to invalidate stale
  transformed artifacts rather than reaching for content-sniffing band-aids.

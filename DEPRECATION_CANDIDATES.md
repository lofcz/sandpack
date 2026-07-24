# Deprecation candidates — immediately-run-sandpack (FLAG ONLY, nothing removed)

Generated 2026-06-22 (code-verification pass R3-124; plan `docs/plans/code-verification/04-sandpack.md`,
dimension 4). This repo is a **fork of CodeSandbox Sandpack**; the bulk of it is inherited upstream
code immediately.run never exercises. Each entry below is a **candidate flagged for a future,
separate decision** — **NOTHING IS REMOVED OR REFACTORED** in this pass.

> **Classification method** (plan §3.0). "Used by immediately.run" = reachable from what
> `immediately-run-site-main/src` imports from `@codesandbox/sandpack-*`, transitively. The used
> entry points are: `SandpackProvider`, `SandpackLayout`, `SandpackPreview`, `SandpackCodeEditor`,
> `useSandpack`, `useSandpackNavigation`, `createSandpackFromFS`, `SANDBOX_TEMPLATES`, types
> `SandpackFiles`/`SandpackSetup` (react); `SandpackFS` + `…/utils` (client); **nothing** (themes).
> A candidate is flagged only when it is **not** in that set **and not** transitively reachable from
> it (verified by import-graph grep, 2026-06-22).
>
> **Why flag-only, never remove:** removing inherited surface (a) changes the consumed `dist/` and
> the `package.json` workspace/build set (`SIMPLIFIED_DEPLOYMENT_SPEC §3/§8`), (b) destroys
> mergeability with upstream Sandpack, and (c) some "unused" files are asserted-present by tests
> (see the static-client keep-caveat). See `00-overview §7`.

---

## sandpack-client

| Path | What it is | Why unused | Keep-caveat (why removal would break) |
|---|---|---|---|
| `src/clients/node/**` (`index.ts`, `types.ts`, `client.utils.ts`, `iframe.utils.ts`, `taskManager.ts`, `inject-scripts/`) | The **Nodebox remote-VM** client | Targets CodeSandbox's remote Nodebox VM — a *different execution model*. immediately.run runs the in-browser forked `sandpack-bundler` (`SIMPLIFIED_DEPLOYMENT_SPEC §2`). Not in the site-main import closure; site-main never selects the `node` template. Explicitly **G1/T1-exempt** in `no-raw-app-iframe.test.ts` (the security model already treats it as a separate non-default path). | Referenced by the `clients/index.ts` dispatch (`case "node"`). The greppable G1/T1 test EXEMPTs `node/index.ts` by name — removing it would need the exempt-set updated too. |
| `src/clients/static/**` (`index.ts`, `utils.ts`) | Static-HTML client (serves static HTML, no transpilation) | immediately.run's flow is live-bundled React+TS. Not in the site-main import closure. | **Asserted-present** by `no-raw-app-iframe.test.ts` ("guards against a broken scan path" expects `static/index.ts` in the scan). Also referenced by `clients/index.ts` dispatch (`case "static"`). Removing `static/index.ts` would break that test. |
| `src/inject-scripts/**` (`consoleHook.ts`, `historyListener.ts`, `resize.ts`, `dist/`) | Injected preview helper scripts | Imported **only** by the static client (`clients/static/index.ts` imports `consoleHook`); the **runtime** client (the one immediately.run uses) injects none of them. Rides with the static candidate. | Removing breaks the static client's import. Keep while static is kept. |
| `src/clients/runtime/file-resolver-protocol.ts` | Lazy file-resolution Protocol over the iframe port | **NOT a candidate — USED.** Instantiated by the runtime client for the bundler's lazy reads. Listed here only to record that it is **upstream-derived** ("a copy of the resolver from the `codesandbox-api` package", per its own header) — do not mistake it for fork-authored. | — |

**Not candidates (USED — keep, do not flag):** `src/clients/runtime/**` (the primary client for the
forked bundler — register-frame handshake, immutable-fetch, file-resolver), `src/clients/iframe-factory.ts`
(the G1/T1 chokepoint), `src/fs/SandpackFS.ts` (site-main imports `SandpackFS`), `src/clients/base.ts`,
`src/clients/event-emitter.ts`, `src/types.ts`, `src/utils.ts`.

**Method-level candidate inside a USED file:** `RuntimeSandboxClient.getCodeSandboxURL()` and its
`snapshotFS()` helper (`src/clients/runtime/index.ts`). These read the **entire** filesystem (walk the
maintained file list + `readFile` every entry) to POST the project to `codesandbox.io/api/v1/sandboxes/define`
for "Open in CodeSandbox." The only caller is the upstream-branded `OpenInCodeSandboxButton` (flagged
below), which site-main gates off via `showOpenInCodeSandbox: false`. So this whole-tree read is **dead in
immediately.run** — it never fires — but it's carried inherited surface. Flag-only: the runtime client file
itself is USED, and `getCodeSandboxURL` is part of the upstream `SandpackClient` shape, so removing it would
diverge the client interface from upstream. (Active per-edit/per-mount whole-tree reads — `useAppState`,
`useFiles`' reset snapshot, and the SW-id hash — were *removed* in this same change set, R3 sandpack
unnecessary-reads; this one stays flagged because it costs nothing at runtime.)

---

## sandpack-react — components (`src/components/*`)

| Component dir | Classification | Reachability trace (2026-06-22) | Reason / keep-caveat |
|---|---|---|---|
| `CodeEditor/` | **USED** | `SandpackCodeEditor` is a site-main import. | keep |
| `Preview/` | **USED** | `SandpackPreview` is a site-main import. | keep |
| `FileTabs/` | **USED** | Imported by `CodeEditor/index.tsx` (`import { FileTabs } from "../FileTabs"`). | keep — reachable from `SandpackCodeEditor`. |
| `Navigator/` | **USED (reachable)** | Imported by `Preview/index.tsx` (gated behind the `showNavigator` prop). `useSandpackNavigation` (the hook) is separately a site-main import. | keep — reachable from `SandpackPreview`, even if site-main passes `showNavigator={false}`. |
| `common/` (Layout, Stack, RunButton, Loading, LoadingOverlay, ErrorOverlay, DependenciesProgress, RoundedButton) | **Mostly USED** | Shared layout/overlay primitives reached by `SandpackLayout`/`Preview`/`CodeEditor`. | keep the layout primitives. |
| `common/OpenInCodeSandboxButton/**` | **INHERITED candidate (reachable but brand-dead)** | *Reachable* from `Preview`/`Loading`/`LoadingOverlay`, BUT it is the upstream-branded "Open in CodeSandbox" affordance — site-main gates it off via `showOpenInCodeSandbox: false` (`ClientOptions`). | Reachable, so a hard removal would break `Preview`'s import; the candidate is the *feature* (the CodeSandbox-branded button), not the file. Flag-only. |
| `FileExplorer/` | **INHERITED candidate** | No non-test, non-story importer (only referenced in `CodeEditor/verify.test.tsx` and stories). | site-main has its own file-explorer system app (`FILE_EXPLORER_SPEC`); the upstream `SandpackFileExplorer` is unused. Exported via `index.ts` `export *` but not in the site-main import set. |
| `Console/` | **INHERITED candidate** | Imported only by `presets/Sandpack.tsx` (the all-in-one preset, NOT in the site-main set). | Console panel; no immediately.run usage. |
| `CodeViewer/` | **INHERITED candidate** | Imported only by `TranspiledCode/` (itself unused). | Read-only viewer; unused. |
| `TranspiledCode/` | **INHERITED candidate** | No non-test importer. | Shows transpiled output; no immediately.run usage. |
| `Tests/` | **INHERITED candidate** | Imported only by `presets/Sandpack.tsx`. | In-preview jest test-runner UI — upstream feature, no immediately.run spec. |
| `ReactDevTools/` | **INHERITED candidate** | No importer at all (non-test/story). | Embeds React DevTools; no immediately.run spec/usage. |
| `icons/` | **USED (reachable)** | Reached by the kept components (CodeEditor/Preview/common). | keep. |

**Note on `presets/Sandpack.tsx`** (the all-in-one `<Sandpack>` preset): it is exported but **not in
the site-main import set** (site-main composes `SandpackProvider`+`SandpackLayout`+… itself). The
preset is therefore an INHERITED candidate too, but it transitively pulls in `Console`/`Tests`, which
is *why* those show as reachable-only-via-the-preset above. Flag the preset as a candidate; keep
flag-only (it is the public convenience entry point upstream consumers expect).

---

## sandpack-react — templates (`src/templates/runtime/*`, `src/templates/node/*`)

`SANDBOX_TEMPLATES` (the aggregate export) is **USED** by site-main. Flag at **per-template-file**
granularity (the aggregate export stays). Site-main instantiates **`react-ts`** only
(`immediately-run-site-main/src/editor/sandpackUtils.ts` overrides `SANDBOX_TEMPLATES["react-ts"].files`).

- **USED:** `templates/runtime/react-typescript.ts` (`REACT_TYPESCRIPT_TEMPLATE`, the `react-ts` key).
- **USED (reachable as fallback):** `templates/runtime/vanilla.ts` (`VANILLA_TEMPLATE`) —
  `createSandpackFS.ts` falls back to `SANDBOX_TEMPLATES.vanilla` when no template/customSetup is
  given. Keep.
- **INHERITED candidates** (immediately.run runs only React+TS apps; these upstream framework
  templates are never selected by site-main):
  - `templates/runtime/`: `react.ts`, `angular.ts`, `solid.ts`, `svelte.ts`, `vue.ts`, `vue-ts.ts`,
    `vanilla-typescript.ts`, `tests-ts.ts`.
  - `templates/node/` (the whole vite-* / node family): `astro.ts`, `nexjs.ts`, `node.ts`, `vite.ts`,
    `vite-react.ts`, `vite-react-ts.ts`, `vite-preact.ts`, `vite-preact-ts.ts`, `vite-svelte.ts`,
    `vite-svelte-ts.ts`, `vite-vue.ts`, `vite-vue-ts.ts`.
- **Keep-caveat:** each unused *key* is a candidate, but the `SANDBOX_TEMPLATES` *object* and the
  per-template `export { … }` re-exports in `templates/index.tsx` are part of the consumed surface —
  pruning a key means editing the aggregate, which changes `dist/`. Flag-only.

---

## sandpack-themes — whole package (INHERITED, unused)

site-main imports **nothing** from `@codesandbox/sandpack-themes` (verified). All 18 theme files
(`amethyst`, `aquaBlue`, `atomDark`, `cobalt2`, `cyberpunk`, `dracula`, `ecoLight`,
`freeCodeCampDark`, `githubLight`, `gruvboxDark`, … ) are **inherited and unused**. site-main themes
Sandpack via `SandpackProvider` props + its own design-token theme
(`immediately-run-site-main/src/editor/chrome/sandpackTheme.ts`), not these.

**Keep-caveat:** the package is still **built by `yarn build`** and shipped as a `file:` dep; removing
it changes the workspace set in `package.json` + the `SIMPLIFIED_DEPLOYMENT_SPEC §3` build order. It
stays. One entry for the whole package.

---

## examples/ — upstream demo harnesses (whole dir)

`examples/{cra,gatsby,nextjs,nextjs-app-dir,vite-react,custom-npm-registry}` are upstream demo apps,
**not in any immediately.run build** (`package.json` `workspaces` lists only the three `sandpack-*`
packages; `examples/` is excluded). Retained for upstream-merge parity. **No source edited** here
(out-of-workspace) — this markdown entry is the whole record.

---

## Storybook stories + upstream dev scripts (catalogue note)

- **`*.stories.tsx`** throughout `sandpack-react/src` (24 files) — upstream Storybook stories. Dev
  tooling only; not in any immediately.run build. Flag-only.
- **Root `dev:docs` / `dev:landing` / `dev:theme` scripts** (`package.json`) reference workspaces
  `sandpack-docs` / `sandpack-landing` / `sandpack-theme` that **do not exist** in this fork (the
  `workspaces` array lists only the three `sandpack-*` packages). The scripts are **dead but
  harmless** (they error if run). Flag-only — do not delete (keeps the fork close to upstream's
  `package.json`).

---

## Summary

- **Used / keep:** `sandpack-client` runtime client + iframe-factory + SandpackFS + base/utils;
  `sandpack-react` CodeEditor, Preview, FileTabs, Navigator, common layout primitives, icons,
  `SANDBOX_TEMPLATES` (`react-ts` + `vanilla` fallback), `createSandpackFromFS`/`createSandpackFS`.
- **Inherited candidates (flagged, NOT removed):** node + static clients (+ inject-scripts);
  FileExplorer, Console, CodeViewer, TranspiledCode, Tests, ReactDevTools components + the
  `<Sandpack>` preset + the OpenInCodeSandbox button; all non-React-TS templates; the entire
  `sandpack-themes` package; `examples/`; stories + dead dev scripts.
- **Nothing removed or refactored.** The DEAD-CANDIDATE comments added in this pass are additive
  (comment-only) and only on fork-safe files; `examples/**` and vendored metadata were not edited.

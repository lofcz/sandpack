# Code ↔ spec references — immediately-run-sandpack (fork of CodeSandbox Sandpack)

Generated 2026-06-22 (code-verification pass R3-124; plan `docs/plans/code-verification/04-sandpack.md`).

This is the durable index a future reader uses to tell **fork-authored** (immediately.run)
code from **vendored upstream** Sandpack code, and to map each fork-delta feature to the spec §
it implements. Specs live in the `docs` repo under `docs/specs/`.

> **What "used by immediately.run" means here** (ground truth): this fork is *not published to
> npm* (`SIMPLIFIED_DEPLOYMENT_SPEC §2/§8`). `immediately-run-site-main` consumes the built
> `dist/` of each package via `file:` deps. So "used" = reachable from what `site-main/src`
> imports from `@codesandbox/sandpack-*`. Verified import surface (2026-06-22):
> - `@codesandbox/sandpack-react`: `SandpackProvider`, `SandpackLayout`, `SandpackPreview`,
>   `SandpackCodeEditor`, `useSandpack`, `useSandpackNavigation`, `createSandpackFromFS`,
>   `SANDBOX_TEMPLATES`, types `SandpackFiles`, `SandpackSetup`.
> - `@codesandbox/sandpack-client`: `SandpackFS` (type) + `@codesandbox/sandpack-client/utils`.
> - `@codesandbox/sandpack-themes`: **nothing**.

The inherited-but-unused upstream surface is catalogued separately in
[`DEPRECATION_CANDIDATES.md`](./DEPRECATION_CANDIDATES.md) (dimension 4, flag-only).

---

## 1. Fork-delta → spec §-ref map

Each row: the immediately.run-authored file/symbol, its spec §-ref, and why the mapping is
non-obvious (i.e. why you'd need this index rather than guessing from the code).

| File / symbol | Spec §-ref | Why the mapping is non-obvious |
|---|---|---|
| `sandpack-client/src/clients/iframe-factory.ts` — `createSandboxedIframe`, `ensureSandboxed`, `assertOpaqueOrigin` | `UI_AS_APPS_SPEC §2` ("The layering model & the hard boundary") + threat **G1/T1** | The opaque-origin invariant is documented in §2's prose, not under an "iframe" heading; the test cited the **pre-2026-06** number §6.2 (now "Budgets by region tier") — fixed in this pass. |
| `sandpack-client/src/clients/no-raw-app-iframe.test.ts` + `clients/iframe-factory.test.ts` | `UI_AS_APPS_SPEC §2` (G1/T1) | The greppable + runtime halves of the same invariant. The greppable test asserts `runtime/index.ts` and `static/index.ts` exist in the scan path — removing the `static` client would break it (see DEPRECATION_CANDIDATES keep-caveat). |
| `sandpack-client/src/types.ts` — `SdkIntegrity`, `ClientOptions.sdkIntegrity` | `SDK_PACKAGING_SPEC §5.2` ("Artifact integrity (SRI)") | This fork only **forwards** the pin into register-frame; the actual **verify-before-evaluate** is in the `sandbox` bundler (`SDK_PACKAGING_STATUS §5.2`). Transport ≠ enforcement. |
| `sandpack-client/src/types.ts` — `ClientOptions.dirtyPaths` | `PRETRANSPILED_ARTIFACTS_SPEC §5.2` ("The dirty set (parent → sandbox)") | Transport only — the dirty set is computed by the host/COW layer; this fork forwards it verbatim. |
| `sandpack-client/src/types.ts` — `ClientOptions.fsSnapshot`, `FsSnapshot` | **roadmap-only: R3-49b** (no spec §) | Batch ZenFS hydration perf transport. No spec block defines it — see §2 gap below. |
| `sandpack-client/src/types.ts` — `ClientOptions.region` | **roadmap-only: R3-114** (no spec §) | Chrome-region forwarding for the SDK's `getRegion()`/`useRegion()`. No spec defines `getRegion`/region descriptors — see §2 gap below. |
| `sandpack-client/src/clients/runtime/index.ts` — `computeInitConfig()` | packs `sdkIntegrity` / `dirtyPaths` / `fsSnapshot` / `region` into register-frame (refs above) | The four options are assembled here and delivered **once** via the `register-frame` handshake (not a `compile` message — the bundler self-watches the FS). |
| `sandpack-client/src/clients/runtime/iframe-protocol.ts` — `register-frame` message | (wire contract for the four options above) | The wire shape `{ type: "register-frame", ...config }` is the contract with the `sandbox` bundler — renaming any field is a cross-repo break. |
| `sandpack-client/src/clients/runtime/immutable-fetch-protocol.ts` (+`.test.ts`) — `handleImmutableFetch`, allowlist | `SDK_PACKAGING_SPEC §5/§11` (immutable, integrity-aware parent-side cache) | Lives parent-side because the opaque-origin iframe has no persistent storage; integrity-aware caching (verify-on-read / verify-before-cache) prevents cache poisoning (`SDK_PACKAGING_STATUS` "Prevention 2"). The allowlist must stay in sync with the bundler's `registerImmutableUrlPrefix`. |
| `sandpack-client/src/fs/SandpackFS.ts` — `onWrite` hook | `COW_OVERLAY_PROVENANCE_SPEC §5` ("Write path — every writer tags its write") | Transport only: the hook hands the local-write path to the host, which records overlay provenance. The provenance record itself is the host's (`FILESYSTEM_SPEC §5` owns "we track no provenance"). |
| `sandpack-react/src/utils/createSandpackFS.ts` — `createSandpackFS`, `createSandpackFromFS`, `resolveFile` | `COW_OVERLAY_PROVENANCE_SPEC §5` (threads `onWrite`); imports `@zenfs/core`, `SandpackFS`, `SANDBOX_TEMPLATES` | React-side constructor for the ZenFS-backed `SandpackFS`. `createSandpackFromFS` is in the site-main import set; `createSandpackFS` / `resolveFile` are exported siblings. |
| `sandpack-react/src/types.ts` + `sandpack-react/src/contexts/utils/useClient.ts` | mirrors the four client options (refs above) + bundler-timeout-race fix (commit `36b9e96`) | The option plumbing is **mirrored on both** the client and react sides; the spec-ref comments match between them (verified 2026-06-22). The timeout reconcile (`__sp_timeout_reconcile__` in `useClient.ts`) has no spec — it is a robustness fix. |

---

## 2. Roadmap-only gaps (no spec § — recorded, not invented)

Per plan §1.3 and `00-overview §7`: do **not** invent a spec-ref for a feature that has none.
These two fork-delta options carry only a roadmap tag and are recorded here as gaps for a
future doc follow-up:

- **`region` (R3-114).** `getRegion()`/`useRegion()` is an SDK/UI-as-apps concept, but **no spec
  §-block defines region descriptors or `getRegion`** (grepped `docs/specs/`, 2026-06-22 — the
  "region binding" prose in `UI_AS_APPS_SPEC` is about slot↔region binding for capabilities, not
  the descriptive `region` string surfaced to apps). The code comments correctly call it
  "descriptive only — it grants and gates nothing." **Doc follow-up:** add a spec § (likely in
  `UI_AS_APPS_SPEC` or a CLIENT_SERVICES/SDK spec) defining the `getRegion()` contract, then
  back-reference it here.
- **`fsSnapshot` (R3-49b).** Batch-hydration **perf transport**; no spec § governs it (it is an
  optimization of the FS-mount delivery path, transparent to behavior). Recorded as
  "roadmap-only (R3-49b), perf transport, no spec §." A spec § is optional (pure perf).

---

## 3. Symbol renames — NONE in this pass (vocabulary dim 2 rationale)

Symbol renames in this repo are **out of scope** for the vocabulary pass. The fork-delta symbols
(`SdkIntegrity`, `sdkIntegrity`, `region`, `fsSnapshot`, `dirtyPaths`, `createSandpackFromFS`,
`createSandpackFS`, `SandpackFS`, `assertOpaqueOrigin`, `createSandboxedIframe`) are part of the
**public export surface consumed by site-main** (`sandpack-react/src/index.ts`,
`sandpack-client/src/index.ts`) **and** the `register-frame` **wire contract** with the `sandbox`
bundler. Renaming any of them is a cross-repo break (site-main imports + the wire protocol).

**Recorded decision:** sandpack-fork symbol renames are cross-repo wire/consumer changes — they
are **not** part of this vocabulary pass; defer to a coordinated SDK/site-main/sandbox change if
ever wanted. This satisfies dimension 2's "renames are recorded, not done blind." No `principal`
misuse exists in the fork delta (it is transport plumbing, not auth surface — grep confirms zero
hits for `principal` in the delta files).

---

## 4. Vendored-vs-fork notes (so a future reader doesn't mistake one for the other)

- `sandpack-client/src/clients/runtime/file-resolver-protocol.ts` is **upstream-derived**: its
  own header says it is "a copy of the resolver from the `codesandbox-api` package." It is
  *used* by the runtime client (the fork instantiates it) but is **not fork-authored** — do not
  treat it as a fork-delta file or rename its symbols.
- `sandpack-client/src/utils.ts` `addPackageJSONIfNeeded` carries a **fork-authored** change
  (commit `8bd1324` "skip the write when the merge is a no-op", to avoid an infinite reload
  loop). See the known-failing-test note below.

---

## 5. Known pre-existing failures (baseline, NOT introduced by this pass)

These were each verified to fail on the **unmodified branch tip** (working tree clean / changes
stashed) before any edit in this pass — they are baseline fork drift, not regressions from the
additive comments added here. The comment-only edits in this pass leave `dist/` byte-identical
(`yarn build` is fully cached after the edits) and the **G1/T1 `no-raw-app-iframe.test.ts` stays
green** (the comments are excluded by its `isCommentLine` guard).

**(a) `sandpack-client` — `src/utils.test.ts` (5 failing).**
`cd sandpack-client && yarn test` fails **5 tests** in `src/utils.test.ts`
(`addPackageJSONIfNeeded › …`) on the **unmodified** branch tip (working tree clean, before any
edit in this pass). The tests pass an empty `SandpackFS` with no `/package.json`, so the
`!hasPkg` branch in `addPackageJSONIfNeeded` (`utils.ts:52`) throws on missing `dependencies`/
`entry` (`DEPENDENCY_ERROR_MESSAGE` / `ENTRY_ERROR_MESSAGE`) before reaching the merge logic the
tests exercise. This is **test↔code drift introduced by an earlier fork commit** (`8bd1324`/the
zenfs migration `b13233b`), unrelated to this verification pass. Per pass discipline ("change
code only with a test"; verify/record-only), it is **recorded here**, not fixed. A future item
should either update `utils.test.ts` to seed a `/package.json` first or relax the early throw.

**(b) `sandpack-react` — 8 failing tests across 10 suites** (`useClient.test.ts`,
`sandpackContext.test.tsx`, `useFiles.test.ts`, `CodeEditor/verify.test.tsx`,
`FileTabs.test.tsx`, …). Also baseline on the pristine tree (verified: 10 failed suites / 8 failed
tests with the working tree stashed). Unrelated to this pass — recorded, not fixed.

**(c) `yarn lint` — 5 errors in `sandpack-client`** (`iframe-protocol.ts:22` unused `origin`,
`iframe-protocol.ts:57` + `runtime/index.ts:106` `no-console`, `immutable-fetch-protocol.ts:128/141`
empty arrow functions). Baseline (verified on the pristine tree). The `runtime/index.ts:106` console
and the `immutable-fetch` empty-catch arrows are also recorded in `REFACTOR_CANDIDATES.md` §1–2.
Note: the package `lint` script runs `eslint --fix`, which **reformats unrelated files** (import
ordering, the `SandpackFS.ts` import) — run a non-`--fix` lint to inspect without churn.

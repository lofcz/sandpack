# Refactor candidates — immediately-run-sandpack (RECORD ONLY, nothing refactored)

Generated 2026-06-22 (code-verification pass R3-124; plan `docs/plans/code-verification/04-sandpack.md`,
dimension 3). **Nothing is refactored in this pass** — each note is specific enough that a later,
gated refactor task can start from it. Scope is **fork-authored** code only; vendored upstream code is
off-limits (renaming/restructuring it breaks the consumed `dist/` and upstream mergeability).

---

## 1. Stray debug `console.log` in the runtime register-frame handshake

- **File:** `sandpack-client/src/clients/runtime/index.ts:106`
- **Smell:** an unconditional `console.log("[SandpackRuntime] Global message listener received message", mes)`
  fires on **every** global message from the iframe (high-frequency, runs in prod). It is a debug
  leftover, not gated behind `logLevel`. The surrounding code uses `console.warn`/`console.error`
  deliberately, so this one log is inconsistent and noisy.
- **Why it matters:** ships console spam to every embedding host; can leak message shapes into the
  console of an app the user is running.
- **Suggested fix (needs a test/eyeball):** remove it, or gate behind `this.options.logLevel >=
  SandpackLogLevel.Debug`. **Not done here** — per pass discipline (change code only with a test) and
  to keep `dist/` byte-stable; flagged for a follow-up.

## 2. Silent error-swallowing in `computeInitConfig` / `addPackageJSONIfNeeded`

- **File:** `sandpack-client/src/clients/runtime/index.ts:422-431` (the `.catch(() => {})` around
  `addPackageJSONIfNeeded`).
- **Smell:** the catch swallows *all* errors with only a comment; combined with the pre-existing
  failing `addPackageJSONIfNeeded` unit tests (see CODE_SPEC_REFERENCES §5), the no-op catch can mask
  a real "couldn't infer package.json" misconfiguration at the most important moment (the boot
  handshake).
- **Why it matters:** a swallowed failure here surfaces later as an opaque bundler error instead of a
  clear "no package.json could be inferred."
- **Suggested fix:** log at `warn` with the actual error inside the catch, rather than discarding it.
  Pair with fixing the `addPackageJSONIfNeeded` test drift. **Not done here.**

## 3. `addPackageJSONIfNeeded` — test ↔ code drift (early-throw vs merge path)

- **Files:** `sandpack-client/src/utils.ts:44-102` + `sandpack-client/src/utils.test.ts`.
- **Smell:** the fork commit `8bd1324` ("skip the write when the merge is a no-op") restructured
  `addPackageJSONIfNeeded` so the `!hasPkg` branch throws on missing `dependencies`/`entry` before the
  merge logic the **5 unit tests** exercise — so the tests now fail on a clean checkout (baseline). The
  function mixes two responsibilities (seed-when-absent vs merge-when-present) with an early throw that
  the tests didn't anticipate.
- **Why it matters:** the suite is red on `main`; the drift hides whether the merge path still behaves.
- **Suggested fix (needs the test):** either seed a `/package.json` in the test fixtures before calling,
  or split the seed vs merge responsibilities into two functions. **Recorded, not fixed** (changing
  code requires a green test; this is a baseline failure pre-dating the pass).

## 4. Mirrored option-plumbing on client + react sides (DRY pressure — low priority)

- **Files:** `sandpack-client/src/types.ts` (`ClientOptions`) + `sandpack-react/src/types.ts` +
  `sandpack-react/src/contexts/utils/useClient.ts`.
- **Smell:** the four fork-delta options (`sdkIntegrity`, `dirtyPaths`, `fsSnapshot`, `region`) and
  their doc-comments are **declared twice** (client `ClientOptions` and react props) and forwarded by
  hand in `useClient.ts`. Adding a fifth option means touching three files in lockstep; the comments
  can drift apart.
- **Why it matters:** maintenance hazard; the doc-comments are currently in sync (verified) but nothing
  enforces it.
- **Suggested fix:** have the react props extend/`Pick` from the client `ClientOptions` for these
  fields so there is one source of truth. **Low priority** — it crosses the client/react package
  boundary and would change `dist/` types; defer. Recorded only.

---

**Discipline:** all of the above are **record-only** (`00-overview §3 dim 3 / §7`). No refactor was
applied. Items 1–2 are the cheapest, lowest-risk follow-ups (single-file, comment/log changes) and
should each land with a test or an eyeball + a `yarn build`.

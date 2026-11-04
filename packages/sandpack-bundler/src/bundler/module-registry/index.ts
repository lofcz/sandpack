import { assertDependenciesResolved, transformFile } from '@lofcz/transpiler';

import * as logger from '../../utils/logger';
import { sortObj } from '../../utils/object';
import { Bundler } from '../bundler';
import { Module } from '../module/Module';
import { scanCjsModule } from '../transforms/raw-cjs/scan';
import { depMapsEqual, locksetClosureValid, LocksetSection } from './lockset';
import { ICDNModule, ICDNModuleFile, IResolvedDependency, fetchManifest, fetchModule } from './module-cdn';
import {
  bundledIndexPath,
  bundledPackagePath,
  decodeBundledModule,
  parseBundledIndex,
} from './bundledPackages';
import {
  EsmFallbackFetcher,
  esmFallbackEntryUrl,
  esmFallbackModulePath,
  fetchEsmFallback,
  fetchEsmFallbackRelease,
  nativeEsmFallbackFetcher,
  synthesizeEsmFallbackModule,
} from './esm-fallback';
import { NodeModule } from './NodeModule';

/**
 * CDN packages are marked precompiled (`Module(..., isCompiled: true)`) and skip
 * Babel. Only trust that when the CDN claims success (`t !== false`) AND the
 * body has no residual ESM `import`/`export` (historical SWC helper-order bug
 * left bare imports → "$csb$eval: Cannot use import statement outside a module").
 *
 * Helper-inlining correctness (`_interop_require_*` defined before use) is
 * guaranteed by the CDN producer and enforced by its on-disk format version
 * (`DISK_FORMAT` in the CDN's disk_cache.rs): artifacts built before helpers
 * were inlined are keyed under an older format and reprocessed on load, so a
 * broken bundle can never be served. No runtime content-sniffing is needed here.
 */
function trustCdnPrecompiled(file: ICDNModuleFile): boolean {
  if (file.t === false) return false;
  if (scanCjsModule(file.c).isEsm) return false;
  return true;
}

// dependency => version range
export type DepMap = { [depName: string]: string };

// The resolution-completeness guard (`assertDependenciesResolved`) lives in
// @lofcz/transpiler alongside `computeDeclaredDepMap`/`computeRequestDepMap`,
// the single source of truth shared with the CLI cache-zip builder
// (PRETRANSPILED_ARTIFACTS_SPEC §4.4) so a silently-dropped package reads
// identically at boot and at build time.

// How long imports discovered by concurrently compiling modules are collected
// into one /dep_tree request before it is sent.
const INSTALL_BATCH_WINDOW_MS = 10;

const hasOwn = (deps: DepMap, name: string): boolean => Object.prototype.hasOwnProperty.call(deps, name);

export class ModuleRegistry {
  modules: Map<string, NodeModule> = new Map();
  moduleDownloadPromises: Map<string, Promise<NodeModule>> = new Map();
  // In-flight downloads a failed install rolled back; they finish unregistered.
  private cancelledDownloads: Set<Promise<NodeModule>> = new Set();

  manifest: IResolvedDependency[] = [];

  // The app's declared DepMap: the version source for every install and the
  // /dep_tree pins. Only declared packages are ever requested.
  private declared: DepMap = {};

  // On-demand installs (`ensurePackages`): the per-name install promise, the
  // names collected for the next batch, and the chain that runs batches one at
  // a time so each one pins everything the previous ones installed.
  private installs: Map<string, Promise<void>> = new Map();
  private nextBatch: { names: Set<string>; done: Promise<void> } | null = null;
  private installChain: Promise<void> = Promise.resolve();
  // Batches queued or running; while any is, a package may be visible before
  // its dependency closure is (`whenIdle`).
  private pendingBatches = 0;

  // Bundled-package index (R3-49a): `name@version` → in-zip filename. `undefined`
  // = not yet loaded; `null` = no bundle present / malformed (resolve live).
  private bundledIndex: Map<string, string> | null | undefined = undefined;

  // Packages the primary CDN dropped that we route through the esm.sh fallback
  // (name → requested range). Consulted in `_fetchModule` to synthesize the
  // bridge package instead of fetching from the primary CDN.
  private esmFallbacks: Map<string, string> = new Map();

  bundler: Bundler;

  // esm.sh fallback for primary-CDN-dropped packages, ENABLED by default. It
  // fetches the package's esm.sh source with the resolved deps externalized and
  // transpiles it through the bundler's own chain, so its `require("react")`
  // binds to the APP's React — sharing the one instance (see esm-fallback.ts).
  // This fixes the dual-React render crash the earlier native-import approach hit
  // (lucide-react@1.x icons read `IconContext` via `useContext`). Only fires when
  // the primary CDN actually drops a package; on failure (esm.sh down, a
  // multi-chunk package) it throws the clear `assertDependenciesResolved`-style
  // error. Pass `null` to disable, or a stub fetcher in tests.
  constructor(
    bundler: Bundler,
    private esmFallbackFetcher: EsmFallbackFetcher | null = nativeEsmFallbackFetcher,
  ) {
    this.bundler = bundler;
  }

  // Load the bundled-package index once from the mounted zip. Never throws: a
  // missing/unreadable/malformed index just means "no bundled packages" and every
  // dependency resolves live from the CDN exactly as before.
  private async ensureBundledIndex(): Promise<Map<string, string> | null> {
    if (this.bundledIndex !== undefined) return this.bundledIndex;
    try {
      this.bundledIndex = parseBundledIndex(await this.bundler.fs.readFileAsync(bundledIndexPath()));
    } catch {
      this.bundledIndex = null;
    }
    return this.bundledIndex;
  }

  // Return the bundled `ICDNModule` for a package if one is present in the zip,
  // else null (→ live CDN fetch). A read/decode failure falls back to the CDN too,
  // so a corrupt bundle degrades to the old path rather than breaking the boot.
  private async _fetchBundledModule(name: string, version: string): Promise<ICDNModule | null> {
    const relPath = (await this.ensureBundledIndex())?.get(`${name}@${version}`);
    if (!relPath) return null;
    try {
      const module = decodeBundledModule(await this.bundler.fs.readBytesAsync(bundledPackagePath(relPath)));
      logger.debug('using bundled package (R3-49a), skipping CDN fetch', name, version);
      return module;
    } catch (err) {
      logger.warn('bundled package read failed; falling back to CDN', name, version, err);
      return null;
    }
  }

  /**
   * Resolve the boot install: `request` (the declared packages the app is known
   * to import, `computeRequestDepMap`) against `declared`. Anything imported
   * later installs through `ensurePackages`.
   */
  async fetchManifest(declared: DepMap, request: DepMap, lockset?: LocksetSection): Promise<void> {
    this.declared = sortObj(declared);
    let requested = sortObj(request);

    // A sidecar lockset (PRETRANSPILED_ARTIFACTS_SPEC §5.4) replaces the
    // blocking /dep_tree request — but only on an exact declared-map match, so
    // a stale or foreign lockset can never be applied. `validateLockset` has
    // already checked shape + cdnVersion; the dependency echo is checked here
    // because this is where the final declared DepMap exists. The lockset's own
    // `requested` (the CLI's import scan) replaces ours.
    let resolvedFromLockset = false;
    if (lockset) {
      if (depMapsEqual(this.declared, lockset.dependencies)) {
        // The echo matches, but a lockset could still inject extra packages
        // (SPEC_REVIEW PT-2). Reject the WHOLE lockset if its request isn't
        // declared or its resolved set isn't closed over the request; never
        // trust it partially. Falls through to live /dep_tree resolution.
        if (locksetClosureValid(lockset)) {
          logger.debug('Using sidecar lockset, skipping dep_tree resolution', lockset.resolved);
          this.manifest = lockset.resolved;
          requested = lockset.requested;
          resolvedFromLockset = true;
        } else {
          logger.warn('Sidecar lockset failed closure validation (request not declared or resolved not closed over it); resolving live');
        }
      } else {
        logger.debug('Sidecar lockset dependency echo does not match; resolving live', {
          computed: this.declared,
          lockset: lockset.dependencies,
        });
      }
    }

    if (!resolvedFromLockset) {
      logger.debug('Fetching manifest', requested);
      this.manifest = await fetchManifest(requested, this.pins());
      logger.debug('fetched manifest', this.manifest);
    }

    // Completeness applies to BOTH paths. A package the primary CDN drops is
    // missing whether resolved live OR baked into a sidecar lockset — the CLI
    // builds the lockset against the SAME CDN (PRETRANSPILED_ARTIFACTS_SPEC
    // §5.4), so a build-time drop is frozen into `lockset.resolved` and
    // `locksetClosureValid` (which only rejects INJECTED top-level packages, not
    // MISSING ones) won't catch it. Register esm.sh fallbacks (no-op when
    // disabled) then guard, so a dropped dep surfaces the clear error rather than
    // a cryptic undefined import — on either path.
    this.registerEsmFallbacks(requested);
    assertDependenciesResolved(requested, this.manifest);
  }

  /** Whether the app declares `name` (and so may install it on demand). */
  isDeclared(name: string): boolean {
    return hasOwn(this.declared, name);
  }

  /** The declared range for `name`, if any. */
  declaredRange(name: string): string | undefined {
    return this.isDeclared(name) ? this.declared[name] : undefined;
  }

  /**
   * Adopt an edited declared map without reinstalling: packages already
   * installed keep their versions (the bundler reloads when one of theirs
   * changes), new ones install when first imported.
   */
  setDeclared(declared: DepMap): void {
    this.declared = sortObj(declared);
    // A failed install may succeed against the edited range.
    for (const [name, install] of this.installs) {
      install.catch(() => this.installs.delete(name));
    }
  }

  /**
   * Install declared packages the app imports that the boot install did not
   * cover (lazy routes, edits, imports a lockset's scan could not see). Imports
   * discovered within `INSTALL_BATCH_WINDOW_MS` share one /dep_tree request;
   * undeclared or already-installed names are ignored.
   */
  ensurePackages(names: Iterable<string>): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const name of names) {
      if (this.modules.has(name) || !this.isDeclared(name)) continue;
      let install = this.installs.get(name);
      if (!install) {
        install = this.enqueueInstall(name);
        this.installs.set(name, install);
      }
      waits.push(install);
    }
    return Promise.all(waits).then(() => undefined);
  }

  /**
   * Settles once no install batch is queued or running, or null when none is.
   * Code that imports packages waits here so it never sees a package whose
   * dependency closure is still being installed.
   */
  whenIdle(): Promise<void> | null {
    if (this.pendingBatches === 0) return null;
    const current = this.nextBatch?.done ?? this.installChain;
    return current.catch(() => undefined).then(() => this.whenIdle() ?? undefined);
  }

  private enqueueInstall(name: string): Promise<void> {
    if (!this.nextBatch) {
      const names = new Set<string>();
      this.pendingBatches++;
      const done = new Promise<void>((resolve) => setTimeout(resolve, INSTALL_BATCH_WINDOW_MS)).then(() => {
        this.nextBatch = null;
        const run = this.installChain
          .catch(() => undefined)
          .then(() => this.installBatch(names))
          .finally(() => this.pendingBatches--);
        this.installChain = run;
        return run;
      });
      this.nextBatch = { names, done };
    }
    this.nextBatch.names.add(name);
    return this.nextBatch.done;
  }

  /**
   * Install one batch, all or nothing: a failure (CDN drop, download error)
   * leaves no trace — no manifest entry, fallback, module or cached file — so a
   * retry, e.g. against a corrected range, starts clean.
   */
  private async installBatch(names: Set<string>): Promise<void> {
    const request: DepMap = {};
    for (const name of names) {
      if (!this.modules.has(name)) request[name] = this.declared[name];
    }
    if (Object.keys(request).length === 0) return;

    logger.debug('Installing imported packages', request);
    const resolved = await fetchManifest(sortObj(request), this.pins());
    const manifestBefore = this.manifest;
    const fallbacksBefore = new Map(this.esmFallbacks);
    const modulesBefore = new Set(this.modules.keys());
    const known = new Set(manifestBefore.map((dep) => dep.n));
    this.manifest = [...manifestBefore, ...resolved.filter((dep) => !known.has(dep.n))];
    try {
      this.registerEsmFallbacks(request);
      assertDependenciesResolved(request, this.manifest);
      await this.preloadModules();
      await this.loadModuleDependencies();
    } catch (err) {
      for (const download of this.moduleDownloadPromises.values()) this.cancelledDownloads.add(download);
      this.manifest = manifestBefore;
      this.esmFallbacks = fallbacksBefore;
      for (const name of [...this.modules.keys()]) {
        if (modulesBefore.has(name)) continue;
        this.modules.delete(name);
        this.bundler.forgetNodeModule?.(name);
      }
      throw err;
    }
  }

  /**
   * /dep_tree pins: the declared ranges, overridden by the exact release of
   * every installed package — the flat tree holds one version per name.
   */
  private pins(): DepMap {
    const pins: DepMap = { ...this.declared };
    for (const [name, nodeModule] of this.modules) {
      const release = nodeModule.release;
      if (!release || this.esmFallbacks.has(name)) continue;
      pins[name] = release.name === name ? release.version : `npm:${release.name}@${release.version}`;
    }
    return pins;
  }

  // For every requested top-level dep the primary CDN silently dropped, register
  // an esm.sh fallback and append a manifest entry so `preloadModules` fetches
  // it. No-op when the fallback is disabled (`esmFallbackLoader === null`).
  private registerEsmFallbacks(requested: DepMap): void {
    if (!this.esmFallbackFetcher) return;
    const resolved = new Set(this.manifest.map((dep) => dep.n));
    for (const [name, range] of Object.entries(requested)) {
      if (resolved.has(name)) continue;
      this.esmFallbacks.set(name, range);
      this.manifest.push({ n: name, v: range, d: 0 });
      logger.warn(`Primary CDN did not resolve "${name}@${range}"; routing through the esm.sh fallback`);
    }
  }

  async preloadModules(): Promise<void> {
    await Promise.all(
      this.manifest.map((dep) => {
        return this.fetchNodeModule(dep.n, dep.v, dep.s);
      })
    );
    // Close over CDN-reported used modules (`ICDNModule.m`) that `/dep_tree`
    // omitted. Flat Sandpack installs only what dep_tree returns; some CDNs
    // (e.g. transforms that inject `@swc/helpers`) list those edges on the
    // package but forget them in dep_tree — pull them in so `require()` works
    // without host-side IMPLIED_PEERS hacks or agent `pkg add` hints.
    await this.fetchUsedModuleClosure();
  }

  /**
   * BFS-fetch packages named in each loaded module's `m` list until the set is
   * closed. Versions come from a fresh `/dep_tree` of `{ name: "latest" }`.
   */
  private async fetchUsedModuleClosure(): Promise<void> {
    const attempted = new Set<string>();
    for (;;) {
      const missing: DepMap = {};
      for (const nodeModule of this.modules.values()) {
        for (const used of nodeModule.modules) {
          if (!used || used.startsWith('.') || used.startsWith('/')) continue;
          if (this.modules.has(used) || missing[used] || attempted.has(used)) continue;
          missing[used] = 'latest';
        }
      }
      const names = Object.keys(missing);
      if (names.length === 0) return;

      for (const name of names) attempted.add(name);
      logger.debug('Fetching used-module closure omitted by dep_tree', missing);
      let extra: IResolvedDependency[];
      try {
        extra = await fetchManifest(missing, this.pins());
      } catch (err) {
        logger.warn('used-module closure dep_tree failed; continuing without', missing, err);
        return;
      }
      if (extra.length === 0) {
        logger.warn('used-module closure resolved empty; continuing without', missing);
        return;
      }
      for (const dep of extra) {
        if (!this.manifest.some((m) => m.n === dep.n)) {
          this.manifest.push(dep);
        }
      }
      await Promise.all(extra.map((dep) => this.fetchNodeModule(dep.n, dep.v, dep.s)));
    }
  }

  private async _fetchModule(name: string, version: string, source: string): Promise<NodeModule> {
    const fallbackRange = this.esmFallbacks.get(name);
    if (fallbackRange !== undefined) {
      return this._fetchEsmFallbackModule(name, fallbackRange);
    }
    // Prefer the zip-bundled content (R3-49a); fall back to the live CDN fetch.
    // An `npm:` alias installs `source`'s files under `name`.
    const module = (await this._fetchBundledModule(source, version)) ?? (await fetchModule(source, version));
    const processedNodeModule = new NodeModule(name, version, module.f, module.m, { name: source, version });
    logger.debug('fetched module', name, version, module);
    return processedNodeModule;
  }

  // Load a primary-CDN-dropped package from esm.sh as a native ES module, stash
  // its namespace on the global for the shim to read, and register a synthetic
  // bridge package (see esm-fallback.ts). A loader failure (404, CSP block,
  // offline) surfaces as a clear error naming the package — never a silent
  // undefined import.
  private async _fetchEsmFallbackModule(name: string, range: string): Promise<NodeModule> {
    // Externalize every already-resolved dep (excluding this package) so esm.sh
    // emits bare imports the bundler resolves to the SHARED instances (esp.
    // react/react-dom) instead of bundling duplicates — see esm-fallback.ts.
    const externals = [...new Set(this.manifest.map((d) => d.n))].filter((n) => n !== name);
    const entryUrl = esmFallbackEntryUrl(name, range, externals);

    let source: string;
    let moduleUrl: string;
    try {
      ({ source, moduleUrl } = await fetchEsmFallback(entryUrl, this.esmFallbackFetcher!));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Could not resolve "${name}@${range}" from the package CDN, and the esm.sh fallback (${entryUrl}) also failed: ${reason}`,
      );
    }

    // Transpile the esm.sh ES module through the SAME chain the bundler runs, so
    // its `require("react")` binds to the app's React, not a second instance.
    const transformed = await transformFile({ path: esmFallbackModulePath(name), code: source });
    if ('error' in transformed) {
      throw new Error(
        `Could not use the esm.sh fallback for "${name}@${range}": transpile failed: ${transformed.error.message}`,
      );
    }

    // The release esm.sh built supplies the package's assets and their URLs;
    // without it the fallback is code-only, as before.
    // Only a followed build path names a release; the entry URL holds the range.
    const release = moduleUrl === entryUrl ? null : await fetchEsmFallbackRelease(name, moduleUrl, this.esmFallbackFetcher!);
    if (!release) logger.warn(`esm.sh fallback "${name}@${range}": release unknown, package assets unavailable`);
    const module = synthesizeEsmFallbackModule(name, range, transformed.code, transformed.deps, release);
    const processedNodeModule = new NodeModule(name, range, module.f, module.m, release?.release ?? null);
    logger.debug('resolved module via esm.sh fallback (shared-React transpile)', name, range, entryUrl);
    return processedNodeModule;
  }

  async fetchNodeModule(name: string, version: string, source = name): Promise<NodeModule> {
    // Module already found, skip fetching
    // This could also check version, but for now this is fine
    // as we don't allow multiple versions of the same module right now
    const foundModule = this.modules.get(name);
    if (foundModule) {
      return foundModule;
    }

    const cacheKey = `${name}::${source}::${version}`;
    let promise = this.moduleDownloadPromises.get(cacheKey);
    if (!promise || this.cancelledDownloads.has(promise)) {
      const download: Promise<NodeModule> = this._fetchModule(name, version, source)
        .then((nodeModule) => {
          // A download a failed install rolled back must not register late.
          if (!this.cancelledDownloads.has(download)) this.modules.set(name, nodeModule);
          return nodeModule;
        })
        .finally(() => {
          this.cancelledDownloads.delete(download);
          if (this.moduleDownloadPromises.get(cacheKey) === download) this.moduleDownloadPromises.delete(cacheKey);
        });
      this.moduleDownloadPromises.set(cacheKey, download);
      promise = download;
    }
    return promise;
  }

  private _writePrecompiledModule(path: string, file: ICDNModuleFile): Array<() => Promise<void>> {
    if (this.bundler.modules.has(path)) {
      return [];
    }

    const precompiled = trustCdnPrecompiled(file);
    if (!precompiled) {
      logger.warn(
        `CDN module ${path} not trusted as precompiled (t=${String(file.t)}); routing through Babel`,
      );
    }
    const module = new Module(path, file.c, precompiled, this.bundler);
    this.bundler.modules.set(path, module);
    return file.d.map((dep) => {
      return async () => {
        // Pre-linking is an optimization over the CDN's dependency lists, which
        // cover EVERY code file of a package, including ones nothing imports: a
        // CLI script (katex@0.19.1 `cli.js` → commander → `child_process`) or a
        // test. Such a file must not fail the build here; if app code really
        // imports it, the normal resolution path reports the genuine error.
        try {
          await module.addDependency(dep);
        } catch (err) {
          logger.warn(
            `CDN pre-link skipped: "${dep}" from ${path} could not be resolved (${
              err instanceof Error ? err.message : String(err)
            })`,
          );
          return;
        }
        // Transform ONLY the dependency just added (its resolved path), not the whole
        // (growing) dependency set on every add — the latter is ~O(deps²) per module
        // (177k calls vs 3k for a real closure, measured). Each dep is still transformed
        // exactly once across the callbacks; transformModule is idempotent (precompiled
        // modules short-circuit on `compiled != null`).
        const resolved = module.dependencyMap.get(dep);
        if (resolved) {
          this.bundler.transformModule(resolved).catch((err) => {
            logger.warn(
              `CDN pre-transform skipped: ${resolved} (${err instanceof Error ? err.message : String(err)})`,
            );
          });
        }
      };
    });
  }

  async loadModuleDependencies() {
    const depPromises = [];
    for (let [moduleName, nodeModule] of this.modules) {
      for (let [fileName, file] of Object.entries(nodeModule.files)) {
        if (typeof file === 'object') {
          const promises = this._writePrecompiledModule(`/node_modules/${moduleName}/${fileName}`, file);
          depPromises.push(...promises);
        }
      }
    }
    await Promise.all(depPromises.map((fn) => fn()));
  }
}

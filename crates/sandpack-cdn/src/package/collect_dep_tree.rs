use node_semver::{Range, Version};
use parking_lot::Mutex;
use serde::{self, Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    sync::Arc,
};
use tokio::task::JoinHandle;
use tracing::{error, warn};

use crate::{
    app_error::ServerError,
    npm_replicator::{
        database::{NpmDatabase, MANIFEST_MAX_AGE},
        types::document::MinimalPackageData,
    },
};

use super::cached::{CachedPackageProcessor, Content};
use super::entries::{entry_closure, ROOT_ENTRY};

#[derive(Clone, Debug)]
pub enum VersionRange {
    Range(Range),
    Alias(String),
}

#[derive(Clone, Debug)]
pub struct DependencyRequest {
    /// Install name: the `node_modules` directory and the `require()` name.
    name: String,
    /// npm package the files come from; differs from `name` for an
    /// `npm:<package>@<range>` alias.
    source: String,
    version_range: VersionRange,
    /// Original range/tag string, kept for accurate PackageVersionNotFound messages.
    range_str: String,
    depth: u32,
    /// The package entries the importer loads (`.`, `./client`, …); only
    /// their closures are followed (`entries::entry_closure`).
    entries: BTreeSet<String>,
}

impl DependencyRequest {
    pub fn new(name: &str, version_range_str: &str, depth: u32) -> Result<Self, ServerError> {
        let (source, range) = match version_range_str.trim().strip_prefix("npm:") {
            Some(target) => parse_npm_alias(target).ok_or_else(|| {
                ServerError::PackageVersionNotFound(name.to_string(), version_range_str.to_string())
            })?,
            None => (name.to_string(), version_range_str),
        };
        let version_range = match Range::parse(range) {
            Ok(req) => VersionRange::Range(req),
            Err(_) => VersionRange::Alias(String::from(range)),
        };

        Ok(DependencyRequest {
            name: String::from(name),
            source,
            version_range,
            range_str: String::from(version_range_str),
            depth,
            entries: BTreeSet::from([String::from(ROOT_ENTRY)]),
        })
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn with_entries(mut self, entries: BTreeSet<String>) -> Self {
        self.entries = entries;
        self
    }

    pub fn resolve_version(&self, manifest: &MinimalPackageData) -> Option<String> {
        match &self.version_range {
            VersionRange::Alias(alias_str) => manifest.dist_tags.get(alias_str).cloned(),
            VersionRange::Range(range) => {
                // The versions map is keyed by string, so its order is lexicographic
                // ("1.9.0" > "1.10.0", "9.0.0" > "10.0.0"); pick the semver-maximum
                // matching version instead of trusting that order. Malformed version
                // keys are skipped rather than failing the whole resolution.
                let highest_version: Option<Version> = manifest
                    .versions
                    .keys()
                    .filter_map(|version| match Version::parse(version) {
                        Ok(parsed) => Some(parsed),
                        Err(_) => {
                            warn!(
                                "Skipping malformed version '{}' of package {}",
                                version, self.name
                            );
                            None
                        }
                    })
                    .filter(|parsed| range.satisfies(parsed))
                    .max();

                highest_version.map(|v| v.to_string())
            }
        }
    }
}

/// `<package>[@<range>]` after `npm:`. The version separator is the last `@`
/// past a scope's leading one; a bare package means its `latest` tag.
fn parse_npm_alias(target: &str) -> Option<(String, &str)> {
    let (package, range) = match target.rfind('@') {
        Some(at) if at > 0 => (&target[..at], &target[at + 1..]),
        _ => (target, "latest"),
    };
    let range = if range.trim().is_empty() { "latest" } else { range };
    super::npm_specifier::is_valid_package_name(package).then(|| (package.to_string(), range))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dependency {
    #[serde(rename = "n")]
    name: String,
    #[serde(rename = "v")]
    version: String,
    #[serde(rename = "d")]
    depth: u32,
    /// npm package the files come from, present only for an alias (`n` is
    /// then the install name). Older bundlers ignore it.
    #[serde(rename = "s", default, skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    /// The entries the tree loads from this package: the bundler fetches each
    /// one's closure (`/package` with that entry).
    #[serde(rename = "e", default)]
    entries: Vec<String>,
}

impl Dependency {
    pub fn new(name: String, version: String, depth: u32, source: String) -> Self {
        let source = (source != name).then_some(source);
        Dependency {
            name,
            version,
            depth,
            source,
            entries: vec![],
        }
    }
}

pub type DependencyList = Vec<Dependency>;

/// Ranges that override every request for a name, at any depth — the app's
/// declared versions plus whatever the client already installed. The tree is
/// flat (one version per name) and the first request to resolve wins, so
/// without pins a package the app declares but does not request directly (a
/// peer such as `react` behind `react-dom`) would take its parent's range.
pub type Pins = HashMap<String, DependencyRequest>;

pub fn process_pins(pin_map: HashMap<String, String>) -> Result<Pins, ServerError> {
    Ok(process_dep_map(pin_map, 0)?
        .into_iter()
        .map(|pin| (pin.name.clone(), pin))
        .collect())
}

pub fn process_dep_map(
    dep_map: HashMap<String, String>,
    depth: u32,
) -> Result<Vec<DependencyRequest>, ServerError> {
    let mut deps: Vec<DependencyRequest> = Vec::with_capacity(dep_map.len());
    for (key, val) in dep_map.iter() {
        match DependencyRequest::new(key.as_str(), val.as_str(), depth) {
            Ok(dep) => {
                deps.push(dep);
            }
            Err(err) => {
                error!(
                    "Failed to parse dep range {} for {}. {:?}",
                    val.as_str(),
                    key.as_str(),
                    err
                )
            }
        }
    }
    Ok(deps)
}

/// Resolve a request to an exact release and load its processed package.
#[tracing::instrument(name = "resolve_dep", skip(pkg_processor, npm_db))]
async fn resolve_dep(
    req: &DependencyRequest,
    npm_db: &NpmDatabase,
    pkg_processor: &CachedPackageProcessor,
) -> Result<(String, Content), ServerError> {
    // Tags and ranges follow npm (a day-old `latest` is refreshed); an exact
    // version only re-downloads the manifest when it is missing from the copy.
    match req.version_range {
        VersionRange::Alias(_) => {
            npm_db
                .ensure_fresh_package(&req.source, MANIFEST_MAX_AGE)
                .await?
        }
        VersionRange::Range(_) => npm_db.ensure_package(&req.source).await?,
    }
    let mut manifest = npm_db.get_package(&req.source)?;
    let mut resolved = req.resolve_version(&manifest);
    if resolved.is_none() && npm_db.refresh_package(&req.source).await? {
        manifest = npm_db.get_package(&req.source)?;
        resolved = req.resolve_version(&manifest);
    }
    let Some(resolved_version) = resolved else {
        return Err(ServerError::PackageVersionNotFound(
            req.name.clone(),
            req.range_str.clone(),
        ));
    };
    let content = pkg_processor.get(req.source.as_str(), resolved_version.as_str()).await?;
    Ok((resolved_version, content))
}

/// The requests the closure of `entries` makes: every package its files
/// import, at the range the package declares (`latest` for undeclared
/// imports), with the entries imported. A self-import adds entries to the
/// package itself, at its resolved release.
fn closure_requests(
    name: &str,
    source: &str,
    version: &str,
    content: &Content,
    entries: &BTreeSet<String>,
    depth: u32,
) -> Vec<DependencyRequest> {
    let closure = entry_closure(source, &content.0, entries.iter());
    let mut requests = Vec::with_capacity(closure.packages.len());
    for (package, package_entries) in closure.packages {
        let request = if package == source {
            let range = if source == name { version.to_string() } else { format!("npm:{source}@{version}") };
            DependencyRequest::new(name, &range, depth)
        } else {
            let range = content.1.get(&package).map(|dep| dep.version.as_str()).unwrap_or("latest");
            DependencyRequest::new(&package, range, depth + 1)
        };
        match request {
            Ok(request) => requests.push(request.with_entries(package_entries)),
            Err(err) => warn!("Skipping import of {} from {}: {:?}", package, source, err),
        }
    }
    requests
}

/// Per-name collection state. The tree is flat: the first request for a name
/// fixes its release; later requests may only add entries, whose closures
/// are expanded against that release.
#[derive(Debug, Default)]
struct NameState {
    /// `(version, source)` once resolved.
    resolved: Option<(String, String)>,
    /// Every entry requested so far.
    entries: BTreeSet<String>,
}

#[derive(Debug, Clone)]
struct DepTreeCollector {
    npm_db: NpmDatabase,
    dependencies: Arc<Mutex<DependencyList>>,
    states: Arc<Mutex<HashMap<String, NameState>>>,
    futures: Arc<Mutex<VecDeque<JoinHandle<()>>>>,
    first_error: Arc<Mutex<Option<ServerError>>>,
    pkg_processor: CachedPackageProcessor,
    pins: Arc<Pins>,
}

impl DepTreeCollector {
    pub fn new(npm_db: NpmDatabase, pkg_processor: CachedPackageProcessor, pins: Pins) -> Self {
        DepTreeCollector {
            npm_db,
            pkg_processor,
            pins: Arc::new(pins),
            dependencies: Arc::new(Mutex::new(Vec::new())),
            states: Arc::new(Mutex::new(HashMap::new())),
            futures: Arc::new(Mutex::new(VecDeque::new())),
            first_error: Arc::new(Mutex::new(None)),
        }
    }

    /// The resolved tree, each package with every entry requested from it.
    fn get_dependencies(&self) -> DependencyList {
        let states = self.states.lock();
        let mut dependencies = self.dependencies.lock().clone();
        for dependency in dependencies.iter_mut() {
            if let Some(state) = states.get(&dependency.name) {
                dependency.entries = state.entries.iter().cloned().collect();
            }
        }
        dependencies
    }

    fn record_error(&self, err: ServerError) {
        let mut slot = self.first_error.lock();
        if slot.is_none() {
            *slot = Some(err);
        }
    }

    fn should_skip(&self, request: &DependencyRequest, known: usize) -> bool {
        if request.name.as_str().starts_with("@types/") {
            return true;
        }
        if !super::npm_specifier::is_valid_package_name(request.name.as_str()) {
            warn!("Skipping non-npm dependency specifier {:?}", request.name);
            return true;
        }
        known > 500
    }

    fn add_dep_requests(&self, dep_requests: Vec<DependencyRequest>) {
        for request in dep_requests {
            let request = apply_pin(&self.pins, request);
            let mut states = self.states.lock();
            if let Some(state) = states.get_mut(&request.name) {
                let added: BTreeSet<String> = request.entries.difference(&state.entries).cloned().collect();
                if added.is_empty() {
                    continue;
                }
                state.entries.extend(added.iter().cloned());
                // Still resolving: the resolution expands every entry it finds
                // recorded when it completes.
                if let Some((version, source)) = state.resolved.clone() {
                    drop(states);
                    self.spawn_expand(request.name, source, version, added, request.depth);
                }
                continue;
            }
            if self.should_skip(&request, states.len()) {
                continue;
            }
            states.insert(
                request.name.clone(),
                NameState { resolved: None, entries: request.entries.clone() },
            );
            drop(states);
            self.spawn_resolve(request);
        }
    }

    fn spawn(&self, task: impl std::future::Future<Output = ()> + Send + 'static) {
        self.futures.lock().push_back(tokio::spawn(task));
    }

    fn spawn_resolve(&self, request: DependencyRequest) {
        let collector = self.clone();
        self.spawn(async move {
            match resolve_dep(&request, &collector.npm_db, &collector.pkg_processor).await {
                Ok((version, content)) => {
                    let entries = {
                        let mut states = collector.states.lock();
                        let state = states.entry(request.name.clone()).or_default();
                        state.resolved = Some((version.clone(), request.source.clone()));
                        state.entries.clone()
                    };
                    collector.dependencies.lock().push(Dependency::new(
                        request.name.clone(),
                        version.clone(),
                        request.depth,
                        request.source.clone(),
                    ));
                    collector.add_dep_requests(closure_requests(
                        &request.name,
                        &request.source,
                        &version,
                        &content,
                        &entries,
                        request.depth,
                    ));
                }
                Err(err) => collector.record_error(err),
            }
        });
    }

    fn spawn_expand(&self, name: String, source: String, version: String, entries: BTreeSet<String>, depth: u32) {
        let collector = self.clone();
        self.spawn(async move {
            match collector.pkg_processor.get(&source, &version).await {
                Ok(content) => collector.add_dep_requests(closure_requests(
                    &name, &source, &version, &content, &entries, depth,
                )),
                Err(err) => collector.record_error(err),
            }
        });
    }

    fn get_next_join(&self) -> Option<JoinHandle<()>> {
        self.futures.lock().pop_front()
    }

    pub async fn try_collect(
        dep_requests: Vec<DependencyRequest>,
        pins: Pins,
        npm_db: NpmDatabase,
        pkg_processor: CachedPackageProcessor,
    ) -> Result<DependencyList, ServerError> {
        let collector = DepTreeCollector::new(npm_db, pkg_processor, pins);
        collector.add_dep_requests(dep_requests);

        while let Some(handle) = collector.get_next_join() {
            if let Err(err) = handle.await {
                error!("Dependency collection error {:?}", err);
            }
        }

        if let Some(err) = collector.first_error.lock().take() {
            return Err(err);
        }

        Ok(collector.get_dependencies())
    }
}

/// A request for a pinned name takes the pin's range (and alias source), keeping
/// its own depth and entries.
fn apply_pin(pins: &Pins, request: DependencyRequest) -> DependencyRequest {
    match pins.get(&request.name) {
        Some(pin) => DependencyRequest {
            depth: request.depth,
            entries: request.entries,
            ..pin.clone()
        },
        None => request,
    }
}

pub async fn collect_dep_tree(
    dep_requests: Vec<DependencyRequest>,
    pins: Pins,
    npm_db: &NpmDatabase,
    pkg_processor: &CachedPackageProcessor,
) -> Result<DependencyList, ServerError> {
    DepTreeCollector::try_collect(dep_requests, pins, npm_db.clone(), pkg_processor.clone()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::npm_replicator::types::document::{
        MinimalPackageData, MinimalPackageVersionData,
    };
    use std::collections::{BTreeMap, HashMap};

    fn pkg_with_versions(name: &str, versions: &[&str]) -> MinimalPackageData {
        let mut map = BTreeMap::new();
        for version in versions {
            map.insert(
                (*version).to_string(),
                MinimalPackageVersionData {
                    tarball: format!("https://example.com/{name}/{version}.tgz"),
                    dependencies: HashMap::new(),
                },
            );
        }
        MinimalPackageData {
            name: name.to_string(),
            dist_tags: HashMap::new(),
            versions: map,
        }
    }

    #[test]
    fn caret_range_resolves_semver_max() {
        // "1.10.0" < "1.9.0" lexicographically; must still pick semver-highest.
        let pkg = pkg_with_versions("pkg", &["1.9.0", "1.10.0"]);
        let req = DependencyRequest::new("pkg", "^1.0.0", 0).unwrap();
        assert_eq!(req.resolve_version(&pkg).as_deref(), Some("1.10.0"));
    }

    #[test]
    fn star_range_resolves_semver_max() {
        // "9.0.0" > "10.0.0" lexicographically; wildcard must still pick 10.x.
        let pkg = pkg_with_versions("pkg", &["9.0.0", "10.0.0"]);
        let req = DependencyRequest::new("pkg", "*", 0).unwrap();
        assert_eq!(req.resolve_version(&pkg).as_deref(), Some("10.0.0"));
    }

    #[test]
    fn malformed_version_key_is_skipped() {
        let pkg = pkg_with_versions("pkg", &["not-semver", "1.2.3"]);
        let req = DependencyRequest::new("pkg", "^1.0.0", 0).unwrap();
        assert_eq!(req.resolve_version(&pkg).as_deref(), Some("1.2.3"));
    }

    #[test]
    fn missing_exact_version_returns_none() {
        let pkg = pkg_with_versions("@mui/icons-material", &["9.1.1"]);
        let req = DependencyRequest::new("@mui/icons-material", "9.1.2", 0).unwrap();
        assert_eq!(req.resolve_version(&pkg), None);
    }

    #[test]
    fn existing_exact_version_resolves() {
        let pkg = pkg_with_versions("@mui/material", &["9.1.2"]);
        let req = DependencyRequest::new("@mui/material", "9.1.2", 0).unwrap();
        assert_eq!(req.resolve_version(&pkg).as_deref(), Some("9.1.2"));
    }

    #[test]
    fn npm_alias_resolves_against_its_target_package() {
        let pkg = pkg_with_versions("string-width", &["4.2.3", "5.1.2"]);
        let req = DependencyRequest::new("string-width-cjs", "npm:string-width@^4.2.0", 1).unwrap();
        assert_eq!(req.name, "string-width-cjs");
        assert_eq!(req.source, "string-width");
        assert_eq!(req.resolve_version(&pkg).as_deref(), Some("4.2.3"));
    }

    #[test]
    fn npm_alias_accepts_scoped_targets_and_tags() {
        let scoped = DependencyRequest::new("ui", "npm:@scope/ui@2.x", 0).unwrap();
        assert_eq!(scoped.source, "@scope/ui");
        let mut pkg = pkg_with_versions("@scope/ui", &["2.1.0", "3.0.0"]);
        assert_eq!(scoped.resolve_version(&pkg).as_deref(), Some("2.1.0"));
        pkg.dist_tags.insert("latest".to_string(), "3.0.0".to_string());
        for spec in ["npm:@scope/ui", "npm:@scope/ui@", "npm:@scope/ui@latest"] {
            let req = DependencyRequest::new("ui", spec, 0).unwrap();
            assert_eq!(req.source, "@scope/ui");
            assert_eq!(req.resolve_version(&pkg).as_deref(), Some("3.0.0"));
        }
    }

    #[test]
    fn npm_alias_rejects_non_package_targets() {
        for spec in ["npm:", "npm:@", "npm:../x@1", "npm:https://x.test/a@1", "npm:a/b@1"] {
            assert!(DependencyRequest::new("x", spec, 0).is_err(), "{spec}");
        }
    }

    #[test]
    fn dependency_names_its_source_only_for_aliases() {
        let plain = serde_json::to_value(Dependency::new("react".into(), "19.0.0".into(), 0, "react".into())).unwrap();
        assert_eq!(plain, serde_json::json!({ "n": "react", "v": "19.0.0", "d": 0, "e": [] }));
        let alias = serde_json::to_value(Dependency::new("react".into(), "10.26.0".into(), 0, "preact".into())).unwrap();
        assert_eq!(alias, serde_json::json!({ "n": "react", "v": "10.26.0", "d": 0, "s": "preact", "e": [] }));
    }

    #[test]
    fn pin_overrides_a_transitive_range_and_keeps_its_depth() {
        let pins = process_pins(HashMap::from([
            ("react".to_string(), "^19.0.0".to_string()),
            ("ui".to_string(), "npm:@scope/ui@^2.0.0".to_string()),
        ]))
        .unwrap();
        let pkg = pkg_with_versions("react", &["18.3.1", "19.2.0"]);

        let pinned = apply_pin(&pins, DependencyRequest::new("react", "^18.0.0", 2).unwrap());
        assert_eq!(pinned.depth, 2);
        assert_eq!(pinned.range_str, "^19.0.0");
        assert_eq!(pinned.resolve_version(&pkg).as_deref(), Some("19.2.0"));

        let alias = apply_pin(&pins, DependencyRequest::new("ui", "^1.0.0", 1).unwrap());
        assert_eq!(alias.source, "@scope/ui");

        let free = apply_pin(&pins, DependencyRequest::new("scheduler", "^0.27.0", 1).unwrap());
        assert_eq!(free.range_str, "^0.27.0");
    }

    #[test]
    fn dist_tag_resolves() {
        let mut pkg = pkg_with_versions("pkg", &["1.9.0", "1.10.0"]);
        pkg.dist_tags
            .insert("latest".to_string(), "1.10.0".to_string());
        let req = DependencyRequest::new("pkg", "latest", 0).unwrap();
        assert_eq!(req.resolve_version(&pkg).as_deref(), Some("1.10.0"));
    }
}

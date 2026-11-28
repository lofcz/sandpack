use nanoid::nanoid;
use node_semver::Version;
use serde::{self, Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{error, info, span, Level};
use transform::transformer::{transform_file_as, SourceKind};

use crate::app_error::ServerError;
use crate::npm::package_content::{download_package_content, PackageContentFetcher};
use crate::npm_replicator::database::NpmDatabase;
use crate::transform;
use crate::utils::tar;

use super::entries::{Edge, PackageGraph};
use super::package_json;
use super::package_json::PackageJSON;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MinimalFile {
    // This file got used so we transform it or return it
    File {
        // content
        #[serde(rename = "c")]
        content: String,
        // dependencies
        #[serde(rename = "d")]
        dependencies: Vec<String>,
        // is transpiled?
        #[serde(rename = "t")]
        is_transpiled: bool,
        // What parsing `c` would tell the bundler, so that it does not have
        // to: 0 runs as it is, 1 needs the compiler. Absent on a file that was
        // not transformed and in payloads written before this field.
        #[serde(rename = "s", default, skip_serializing_if = "Option::is_none")]
        scan: Option<u8>,
        // The `require("…")` specifiers of `c` that `d` leaves out (`node:fs`),
        // which the bundler links as well.
        #[serde(rename = "u", default, skip_serializing_if = "Vec::is_empty")]
        unlisted: Vec<String>,
    },
    // We didn't compile or detected this file being used, so we return the size in bytes instead
    Ignored(u64),
    // Something went wrong with this file
    Failed(bool),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinimalCachedModule {
    // name, it's part of the request so leaving it out for now...
    // n: String,
    // version, it's part of the request so leaving it out for now...
    // v: String,
    // files
    #[serde(rename = "f")]
    pub(crate) files: HashMap<String, MinimalFile>,
    // used modules, this is different from dependencies as this only includes a
    // list of node_modules that are used in the code, used for the resolve endpoint
    // to eagerly fetch these modules
    #[serde(rename = "m")]
    pub(crate) modules: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleDependency {
    #[serde(rename = "v")]
    pub version: String,
    #[serde(rename = "i")]
    pub is_used: bool,
}

pub type ModuleDependenciesMap = HashMap<String, ModuleDependency>;

fn collect_file_paths(
    dir_path: PathBuf,
    root_dir: PathBuf,
    files_map: &mut HashMap<String, u64>,
) -> Result<(), ServerError> {
    for entry in fs::read_dir(dir_path)? {
        let entry = entry?;
        let entry_path = entry.path();

        let metadata = fs::metadata(&entry_path)?;
        if metadata.is_dir() {
            collect_file_paths(entry_path, root_dir.clone(), files_map)?;
        } else if metadata.is_file() {
            // Module specifiers always use `/`, but `as_os_str` yields the
            // platform separator (`\` on Windows). Normalize so the resolver
            // can match nested files (e.g. `cjs/react.development.js`).
            let rel_path = entry_path
                .strip_prefix(root_dir.clone())
                .unwrap()
                .to_str()
                .unwrap()
                .replace('\\', "/");
            files_map.insert(rel_path, metadata.len());
        }
    }

    Ok(())
}

/// The `type` field that governs each file of a package: the one of the nearest
/// package.json at or above the file's directory, as Node reads it (a `dist/esm`
/// directory often carries its own `{"type":"module"}`). Read once per directory.
struct PackageTypes<'a> {
    pkg_root: &'a Path,
    by_dir: HashMap<String, Option<String>>,
}

impl<'a> PackageTypes<'a> {
    fn new(pkg_root: &'a Path) -> Self {
        PackageTypes { pkg_root, by_dir: HashMap::new() }
    }

    /// `file` is package-relative, with forward slashes.
    fn of(&mut self, file: &str) -> Option<String> {
        let dir = file.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
        self.of_dir(dir)
    }

    fn of_dir(&mut self, dir: &str) -> Option<String> {
        if let Some(known) = self.by_dir.get(dir) {
            return known.clone();
        }
        let manifest = if dir.is_empty() {
            self.pkg_root.join("package.json")
        } else {
            self.pkg_root.join(dir).join("package.json")
        };
        let found = match fs::read_to_string(manifest) {
            // A package.json without `type` still ends the search: it is CommonJS.
            Ok(content) => serde_json::from_str::<serde_json::Value>(content.trim_start_matches('\u{feff}'))
                .ok()
                .and_then(|value| value.get("type").and_then(|kind| kind.as_str()).map(String::from)),
            Err(_) if dir.is_empty() => None,
            Err(_) => {
                let parent = dir.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("");
                self.of_dir(parent)
            }
        };
        self.by_dir.insert(dir.to_string(), found.clone());
        found
    }
}

/// Transform `entries` and everything they load inside the package, along the
/// edges the bundler follows (`PackageGraph`): relative imports, `#name`
/// imports and `browser` replacements. A file the browser build replaces is
/// not transformed; its replacement is, so its imports are known to
/// `/dep_tree` (`styled-components.browser.esm.js` imports `stylis`).
fn transform_files(
    entries: Vec<String>,
    graph: &PackageGraph,
    result_map: &mut HashMap<String, MinimalFile>,
    pkg_root: &Path,
    used_modules: &mut HashSet<String>,
) {
    let mut queue: Vec<String> = entries.iter().flat_map(|entry| graph.path_files(entry, None)).collect();
    let mut package_types = PackageTypes::new(pkg_root);
    while let Some(found_file) = queue.pop() {
        // A listed file (`Ignored`) has not been read yet; anything else is done.
        if matches!(result_map.get(found_file.as_str()), Some(MinimalFile::File { .. } | MinimalFile::Failed(_))) {
            continue;
        }
        let content = match fs::read_to_string(pkg_root.join(found_file.as_str())) {
            Ok(content) => content,
            // TODO: Return an error in this case?
            Err(err) => {
                error!("Error reading file: {:?}", err);
                result_map.insert(found_file, MinimalFile::Failed(false));
                continue;
            }
        };
        let package_type = package_types.of(found_file.as_str());
        let kind = SourceKind::of(found_file.as_str(), package_type.as_deref());
        match transform_file_as(found_file.as_str(), content.as_str(), kind) {
            Ok(transformed_file) => {
                // Per-file `d` is what Sandpack walks with addDependency.
                // Only keep edges the specifier parser accepts.
                let graph_deps: Vec<String> = transformed_file
                    .dependencies
                    .into_iter()
                    .filter(|d| super::npm_specifier::parse_module_specifier(d).is_some())
                    .collect();
                for dep in &graph_deps {
                    match graph.edge(found_file.as_str(), dep) {
                        Edge::Files(files) => queue.extend(files),
                        Edge::Package(specifier) => {
                            if let Some(name) = super::npm_specifier::package_name_from_specifier(&specifier) {
                                used_modules.insert(name);
                            }
                        }
                        Edge::None => {}
                    }
                }
                let unlisted: Vec<String> = transformed_file
                    .scan
                    .requires
                    .into_iter()
                    .filter(|required| !graph_deps.contains(required))
                    .collect();
                result_map.insert(
                    found_file,
                    MinimalFile::File {
                        content: transformed_file.content,
                        dependencies: graph_deps,
                        is_transpiled: true,
                        scan: Some(u8::from(transformed_file.scan.needs_compiler)),
                        unlisted,
                    },
                );
            }
            Err(err) => {
                error!("{:?}", err);
                result_map.insert(
                    found_file,
                    MinimalFile::File { content, dependencies: vec![], is_transpiled: false, scan: None, unlisted: vec![] },
                );
            }
        }
    }
}

#[tracing::instrument(name = "transform_package", skip(pkg_output_path))]
fn transform_package(
    pkg_output_path: PathBuf,
    package_name: &str,
    package_version: &str,
) -> Result<(MinimalCachedModule, ModuleDependenciesMap), ServerError> {
    let mut file_paths: HashMap<String, u64> = HashMap::new();
    {
        let collect_files_span = span!(
            Level::INFO,
            "pkg_collect_file_paths",
            package_name = package_name,
            package_version = package_version
        )
        .entered();
        collect_file_paths(
            pkg_output_path.clone(),
            pkg_output_path.clone(),
            &mut file_paths,
        )?;
        collect_files_span.exit();
    }

    let mut module_files: HashMap<String, MinimalFile> = HashMap::new();
    let mut used_modules: HashSet<String> = HashSet::new();

    // Read and process pkg.json
    let read_pkg_json = span!(
        Level::INFO,
        "read_pkg_json",
        package_name = package_name,
        package_version = package_version
    )
    .entered();
    let pkg_json_content = fs::read_to_string(Path::new(&pkg_output_path).join("package.json"))?;
    let parsed_pkg_json: PackageJSON = package_json::parse_pkg_json(pkg_json_content.clone())?;

    // add package.json content to the files
    module_files.insert(
        String::from("package.json"),
        MinimalFile::File {
            content: pkg_json_content,
            dependencies: vec![],
            is_transpiled: false,
            scan: None,
            unlisted: vec![],
        },
    );
    read_pkg_json.exit();

    // transform entries
    {
        let transform_files_span = span!(
            Level::INFO,
            "pkg_transform_files",
            package_name = package_name,
            package_version = package_version
        )
        .entered();
        let graph = PackageGraph::new(&parsed_pkg_json, &file_paths);
        transform_files(
            package_json::collect_pkg_entries(parsed_pkg_json.clone())?,
            &graph,
            &mut module_files,
            &pkg_output_path,
            &mut used_modules,
        );
        transform_files_span.exit();
    }

    // add remaining files as ignored files
    for (key, value) in &file_paths {
        if !module_files.contains_key(key) {
            module_files.insert(String::from(key), MinimalFile::Ignored(*value));
        }
    }

    // collect dependencies for `/dep_tree` (only `is_used` edges are followed):
    //  1) declared `dependencies` (used or not — unused stay is_used=false)
    //  2) used `peerDependencies` (version from peer range)
    //  3) used bare imports with no declared range (e.g. `@swc/helpers` pulled
    //     in by `@tailwindcss/browser` without a peer entry) → dist-tag "latest"
    let mut dependencies: ModuleDependenciesMap = HashMap::new();
    if let Some(deps) = parsed_pkg_json.dependencies {
        for (key, value) in deps.iter() {
            dependencies.insert(
                key.clone(),
                ModuleDependency {
                    version: value.clone(),
                    is_used: used_modules.contains(key),
                },
            );
        }
    }
    if let Some(peers) = parsed_pkg_json.peer_dependencies {
        for (key, value) in peers.iter() {
            if dependencies.contains_key(key) {
                continue;
            }
            if !used_modules.contains(key) {
                continue;
            }
            dependencies.insert(
                key.clone(),
                ModuleDependency {
                    version: value.clone(),
                    is_used: true,
                },
            );
        }
    }
    for key in used_modules.iter() {
        if key.eq(&package_name) || dependencies.contains_key(key) {
            continue;
        }
        // Keys here are already bare package names from parse_module_specifier.
        if !super::npm_specifier::is_valid_package_name(key) {
            continue;
        }
        dependencies.insert(
            key.clone(),
            ModuleDependency {
                // Alias path in collect_dep_tree resolves npm dist-tags.
                version: String::from("latest"),
                is_used: true,
            },
        );
    }

    let used_modules: Vec<String> = used_modules
        .into_iter()
        .filter(|v| !v.eq(&package_name) && super::npm_specifier::is_valid_package_name(v))
        .collect::<Vec<String>>();
    let module_spec = MinimalCachedModule {
        files: module_files,
        modules: used_modules,
    };

    Ok((module_spec, dependencies))
}

#[tracing::instrument(name = "process_npm_package", skip(temp_dir, npm_db))]
pub async fn process_npm_package(
    package_name: &str,
    package_version: &str,
    temp_dir: &str,
    npm_db: &NpmDatabase,
    content_fetcher: &PackageContentFetcher,
) -> Result<(MinimalCachedModule, ModuleDependenciesMap), ServerError> {
    info!(
        "Started processing package: {}@{}",
        package_name, package_version
    );

    let tarball_content =
        download_package_content(package_name, package_version, npm_db, content_fetcher).await?;
    let mut pkg_output_path = Path::new(temp_dir)
        .join(nanoid!())
        .join(format!("{}-{}", package_name, package_version));
    tar::store_tarball(tarball_content.as_ref().clone(), pkg_output_path.as_path())?;

    // TODO: Go to first folder, folder is not always named `package`
    // for @types, it's the name of the package, like `acorn`, `react`, ...
    pkg_output_path = pkg_output_path.join("package");

    // Transform module in new thread
    let package_name_string = String::from(package_name);
    let package_version_string = String::from(package_version);
    let cloned_pkg_output_path = pkg_output_path.clone();
    let task = tokio::task::spawn_blocking(move || {
        transform_package(
            cloned_pkg_output_path,
            package_name_string.as_str(),
            package_version_string.as_str(),
        )
    });
    let transform_result = task.await?;

    // Cleanup package directory
    tokio::fs::remove_dir_all(pkg_output_path.as_path()).await?;

    transform_result
}

/// Transforms `files` of an already processed package, and what they load
/// inside it, on top of `module`.
fn extend_package(
    pkg_output_path: PathBuf,
    mut module: MinimalCachedModule,
    files: Vec<String>,
) -> Result<MinimalCachedModule, ServerError> {
    let mut file_paths: HashMap<String, u64> = HashMap::new();
    collect_file_paths(pkg_output_path.clone(), pkg_output_path.clone(), &mut file_paths)?;
    let pkg_json_content = fs::read_to_string(pkg_output_path.join("package.json"))?;
    let parsed_pkg_json: PackageJSON = package_json::parse_pkg_json(pkg_json_content)?;
    let graph = PackageGraph::new(&parsed_pkg_json, &file_paths);
    let mut used_modules: HashSet<String> = module.modules.drain(..).collect();
    transform_files(files, &graph, &mut module.files, &pkg_output_path, &mut used_modules);
    module.modules = used_modules.into_iter().collect();
    Ok(module)
}

/// `module` with `files` (listed only so far) and their closure transformed:
/// the package is downloaded again, since only its transformed part is kept.
#[tracing::instrument(name = "extend_npm_package", skip(temp_dir, npm_db, content_fetcher, module))]
pub async fn extend_npm_package(
    package_name: &str,
    package_version: &str,
    temp_dir: &str,
    npm_db: &NpmDatabase,
    content_fetcher: &PackageContentFetcher,
    module: MinimalCachedModule,
    files: Vec<String>,
) -> Result<MinimalCachedModule, ServerError> {
    let tarball_content =
        download_package_content(package_name, package_version, npm_db, content_fetcher).await?;
    let unpacked = Path::new(temp_dir)
        .join(nanoid!())
        .join(format!("{}-{}", package_name, package_version));
    tar::store_tarball(tarball_content.as_ref().clone(), unpacked.as_path())?;
    let pkg_output_path = unpacked.join("package");

    let cloned_pkg_output_path = pkg_output_path.clone();
    let task = tokio::task::spawn_blocking(move || extend_package(cloned_pkg_output_path, module, files));
    let result = task.await?;

    tokio::fs::remove_dir_all(pkg_output_path.as_path()).await?;

    result
}

pub fn parse_package_specifier_no_validation(
    package_specifier: &str,
) -> Result<(String, String), ServerError> {
    if package_specifier.contains(char::is_whitespace) {
        return Err(ServerError::InvalidPackageSpecifier);
    }

    let mut parts: Vec<&str> = package_specifier.split('@').collect();
    let package_version_opt = parts.pop();
    if let Some(package_version) = package_version_opt {
        if parts.len() > 2 {
            return Err(ServerError::InvalidPackageSpecifier);
        }

        let package_name = parts.join("@");
        Ok((package_name, String::from(package_version)))
    } else {
        Err(ServerError::InvalidPackageSpecifier)
    }
}

pub fn parse_package_specifier(package_specifier: &str) -> Result<(String, String), ServerError> {
    let (name, version) = parse_package_specifier_no_validation(package_specifier)?;
    Version::parse(&version)?;
    Ok((name, version))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A package unpacked on disk, removed when dropped.
    struct Unpacked(PathBuf);

    impl Unpacked {
        fn new(files: &[(&str, &str)]) -> Self {
            let root = std::env::temp_dir().join(format!("sandpack-cdn-test-{}", nanoid!()));
            for (path, content) in files {
                let file = root.join(path);
                fs::create_dir_all(file.parent().unwrap()).unwrap();
                fs::write(file, content).unwrap();
            }
            Unpacked(root)
        }
    }

    impl Drop for Unpacked {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn dependencies_of<'a>(module: &'a MinimalCachedModule, path: &str) -> Option<Vec<&'a str>> {
        match module.files.get(path) {
            Some(MinimalFile::File { dependencies, is_transpiled: true, .. }) => {
                let mut deps: Vec<&str> = dependencies.iter().map(String::as_str).collect();
                deps.sort();
                Some(deps)
            }
            _ => None,
        }
    }

    // styled-components: the entry is replaced by its browser build, which is
    // the only file that imports `stylis`. Untransformed, its imports were
    // unknown and `stylis` never entered `/dep_tree`.
    #[test]
    fn the_browser_replacement_of_an_entry_is_transformed_with_its_imports() {
        let unpacked = Unpacked::new(&[
            (
                "package.json",
                r#"{ "name": "styled", "version": "1.0.0",
                    "main": "dist/styled.cjs.js", "module": "./dist/styled.esm.js",
                    "browser": { "./dist/styled.esm.js": "./dist/styled.browser.esm.js" },
                    "dependencies": { "stylis": "4.3.6", "node-only": "1.0.0" } }"#,
            ),
            ("dist/styled.esm.js", "import 'node-only'; export default 1;"),
            ("dist/styled.browser.esm.js", "import { compile } from 'stylis'; import './shared.js'; export default compile;"),
            ("dist/shared.js", "export const shared = 1;"),
        ]);
        let (module, dependencies) = transform_package(unpacked.0.clone(), "styled", "1.0.0").unwrap();

        assert_eq!(dependencies_of(&module, "dist/styled.browser.esm.js"), Some(vec!["./shared.js", "stylis"]));
        assert_eq!(dependencies_of(&module, "dist/shared.js"), Some(vec![]));
        // The file the browser build never loads is listed, not transformed.
        assert!(matches!(module.files.get("dist/styled.esm.js"), Some(MinimalFile::Ignored(_))));
        assert!(dependencies["stylis"].is_used);
        assert!(!dependencies["node-only"].is_used);

        let closure = super::super::entries::entry_closure("styled", &module, [&".".to_string()]);
        assert_eq!(closure.packages.keys().cloned().collect::<Vec<_>>(), vec!["stylis"]);
    }

    fn content_of<'a>(module: &'a MinimalCachedModule, path: &str) -> &'a str {
        match module.files.get(path) {
            Some(MinimalFile::File { content, .. }) => content.as_str(),
            other => panic!("{path} was not transformed: {other:?}"),
        }
    }

    // A file is an ES module or a script by the nearest package.json's `type`,
    // not by the package root's: `esm/` with its own `{"type":"module"}` inside a
    // CommonJS package, and a UMD file (libtess) whose top-level `this` must stay.
    #[test]
    fn each_file_is_transformed_as_the_kind_its_nearest_package_json_declares() {
        let unpacked = Unpacked::new(&[
            ("package.json", r#"{ "name": "mixed", "version": "1.0.0", "main": "index.js" }"#),
            ("index.js", "require('./umd.js'); require('./esm/side.js');"),
            ("umd.js", "this.answer = 42; module.exports = this.answer;"),
            ("esm/package.json", r#"{ "type": "module" }"#),
            ("esm/side.js", "globalThis.seen = typeof this;"),
        ]);
        let (module, _) = transform_package(unpacked.0.clone(), "mixed", "1.0.0").unwrap();

        // A script: `this` is left for the bundler to bind to module.exports.
        assert!(content_of(&module, "umd.js").contains("this.answer"));
        // An ES module without imports or exports is still a module: `this` is undefined.
        assert!(!content_of(&module, "esm/side.js").contains("typeof this"));
    }

    // Emscripten glue (three's draco, basis): `require("node:fs")` behind a
    // run-time check. It is no edge of the package graph, so `d` leaves it
    // out; the bundler still links it, and is told so instead of parsing the
    // file to find it.
    #[test]
    fn a_transformed_file_says_what_parsing_it_would_tell_the_bundler() {
        let unpacked = Unpacked::new(&[
            ("package.json", r#"{ "name": "glue", "version": "1.0.0", "main": "index.js" }"#),
            ("index.js", "var fs = typeof process === 'object' ? require('node:fs') : null; module.exports = [fs, require('./plain.js'), require('./loader.js')];"),
            ("plain.js", "module.exports = require('left-pad');"),
            ("loader.js", "module.exports = function (name) { return require(name); };"),
        ]);
        let (module, _) = transform_package(unpacked.0.clone(), "glue", "1.0.0").unwrap();
        let said = |path: &str| match module.files.get(path) {
            Some(MinimalFile::File { scan, unlisted, .. }) => (*scan, unlisted.clone()),
            other => panic!("{path} was not transformed: {other:?}"),
        };

        assert_eq!(said("index.js"), (Some(0), vec!["node:fs".to_string()]));
        assert_eq!(said("plain.js"), (Some(0), vec![]));
        assert_eq!(said("loader.js"), (Some(1), vec![]));
        // Not transformed, so not scanned.
        assert_eq!(said("package.json"), (None, vec![]));

        // The fields survive the disk cache and cost nothing where they say nothing.
        let bytes = crate::utils::msgpack::serialize_msgpack(&module).unwrap();
        let read: MinimalCachedModule = crate::utils::msgpack::deserialize_msgpack(&bytes).unwrap();
        match read.files.get("index.js") {
            Some(MinimalFile::File { scan, unlisted, .. }) => {
                assert_eq!((*scan, unlisted.clone()), (Some(0), vec!["node:fs".to_string()]));
            }
            other => panic!("index.js did not round-trip: {other:?}"),
        }
        let plain = crate::utils::msgpack::serialize_msgpack(module.files.get("plain.js").unwrap()).unwrap();
        assert!(!plain.windows(2).any(|pair| pair == [0xa1, b'u']), "an empty list is not written");
    }

    // dayjs: `main` is one bundle, and every plugin is a file of its own that
    // nothing in the package imports. `dayjs/plugin/utc` was listed only, so
    // the bundler downloaded it as published and compiled it itself.
    #[test]
    fn a_file_outside_the_declared_entries_is_transformed_when_it_is_asked_for() {
        let unpacked = Unpacked::new(&[
            ("package.json", r#"{ "name": "dayish", "version": "1.0.0", "main": "index.js" }"#),
            ("index.js", "module.exports = function dayish() {};"),
            ("plugin/utc.js", "import pad from 'left-pad'; import { shared } from './shared.js'; export default (d) => pad(shared(d));"),
            ("plugin/shared.js", "export const shared = (d) => d;"),
            ("plugin/other.js", "module.exports = require('never-asked-for');"),
            ("plugin/style.css", ".day { color: red }"),
        ]);
        let (module, _) = transform_package(unpacked.0.clone(), "dayish", "1.0.0").unwrap();
        let entries = |list: &[&str]| -> Vec<String> { list.iter().map(|entry| entry.to_string()).collect() };
        let untransformed = |module: &MinimalCachedModule, list: &[&str]| {
            super::super::entries::untransformed_entry_files("dayish", module, entries(list).iter())
        };

        assert!(matches!(module.files.get("plugin/utc.js"), Some(MinimalFile::Ignored(_))));
        assert_eq!(untransformed(&module, &["."]), Vec::<String>::new());
        assert_eq!(untransformed(&module, &["./plugin/utc.js", "./plugin/utc"]), vec!["plugin/utc.js".to_string()]);
        // Not code: the bundler takes it as published.
        assert_eq!(untransformed(&module, &["./plugin/style.css"]), Vec::<String>::new());

        let extended = extend_package(unpacked.0.clone(), module.clone(), vec!["plugin/utc.js".to_string()]).unwrap();
        assert_eq!(dependencies_of(&extended, "plugin/utc.js"), Some(vec!["./shared.js", "left-pad"]));
        // What it loads inside the package came with it, as CommonJS.
        assert!(content_of(&extended, "plugin/shared.js").contains("shared"));
        assert!(!content_of(&extended, "plugin/shared.js").contains("export const"));
        assert_eq!(extended.modules, vec!["left-pad".to_string()]);
        // Nothing else was touched.
        assert_eq!(content_of(&extended, "index.js"), content_of(&module, "index.js"));
        assert!(matches!(extended.files.get("plugin/other.js"), Some(MinimalFile::Ignored(_))));
        assert_eq!(untransformed(&extended, &["./plugin/utc.js"]), Vec::<String>::new());

        // The entry's closure is now what the bundler is sent, and what /dep_tree follows.
        let entry = "./plugin/utc.js".to_string();
        let part = super::super::entries::entry_module("dayish", &extended, &entry);
        let mut sent: Vec<&str> = part.files.keys().map(String::as_str).collect();
        sent.sort();
        assert_eq!(sent, vec!["plugin/shared.js", "plugin/utc.js"]);
        assert_eq!(part.modules, vec!["left-pad".to_string()]);
    }

    // vfile: `#minpath` stays in the importer's dependency list (the bundler
    // links by it) and the file it names for the browser is transformed.
    #[test]
    fn package_imports_stay_in_the_dependency_list_and_their_targets_are_transformed() {
        let unpacked = Unpacked::new(&[
            (
                "package.json",
                r##"{ "name": "vfile", "version": "6.0.3", "type": "module", "exports": "./index.js",
                    "imports": { "#minpath": { "node": "./lib/minpath.js", "default": "./lib/minpath.browser.js" } } }"##,
            ),
            ("index.js", "export { minpath } from '#minpath';"),
            ("lib/minpath.js", "export { default as minpath } from 'node:path';"),
            ("lib/minpath.browser.js", "export const minpath = { sep: '/' };"),
        ]);
        let (module, _) = transform_package(unpacked.0.clone(), "vfile", "6.0.3").unwrap();

        assert_eq!(dependencies_of(&module, "index.js"), Some(vec!["#minpath"]));
        assert_eq!(dependencies_of(&module, "lib/minpath.browser.js"), Some(vec![]));
        assert!(matches!(module.files.get("lib/minpath.js"), Some(MinimalFile::Ignored(_))));
        assert!(module.modules.is_empty());
    }
}

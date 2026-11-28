//! Entry closures: the part of a processed package that an import loads.
//!
//! A package is transformed once over its whole published surface (every
//! `exports` target, wildcards included), but an import only loads the files
//! reachable from the entries it names (`.` for `three`, `./addons/x.js` for
//! `three/addons/x.js`). `/package` serves those closures and `/dep_tree`
//! follows only the package imports they make, so code an app never loads is
//! neither inlined nor installed.
//!
//! A closure follows the imports that stay inside the package: relative
//! ones, and `#name` specifiers its `imports` field maps to its own files.
//! Bare imports — including a package importing itself (`three`'s addons
//! import `three`) — are package edges with their entries, so each entry's
//! files are served once. The `browser` field applies as the bundler applies
//! it: file replacements are followed, and modules mapped to `false` are not
//! loaded at all.
//!
//! `PackageGraph` is the one place those rules live: the transform pass
//! (`process.rs`) walks the same edges, so every file a closure can reach has
//! been transformed and its own imports are known.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::npm_specifier::{parse_module_specifier, ModuleSpecifier};
use super::package_json::{
    get_main_entry, parse_pkg_json, resolve_export_target, ExportTarget, PackageJSON, PackageJSONExport,
};
use super::process::{MinimalCachedModule, MinimalFile};
use super::resolver::{collect_files, extract_file_extension, file_path_to_dirname, make_mod_specifier_absolute};

/// The entry a bare import of the package itself names.
pub const ROOT_ENTRY: &str = ".";

/// The entry an import names: `react` → `.`, `react-dom/client` → `./client`.
pub fn entry_of(subpath: Option<&str>) -> String {
    match subpath.map(|s| s.trim_matches('/')) {
        Some(s) if !s.is_empty() => format!("./{s}"),
        _ => String::from(ROOT_ENTRY),
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct EntryClosure {
    /// Package-relative files the entries load through relative imports.
    pub files: BTreeSet<String>,
    /// Packages those files import, with the entries they import — the
    /// package's own name included for self-imports.
    pub packages: BTreeMap<String, BTreeSet<String>>,
}

/// What the `browser` field makes of a file or a module specifier.
enum Replacement {
    Keep,
    Excluded,
    File(String),
    Module(String),
}

#[derive(Default)]
struct BrowserField {
    files: HashMap<String, Option<String>>,
    modules: HashMap<String, Replacement>,
}

impl BrowserField {
    fn from_pkg(pkg: &PackageJSON, files_map: &HashMap<String, u64>) -> Self {
        let mut field = BrowserField::default();
        let Some(PackageJSONExport::Map(map)) = &pkg.browser else {
            return field;
        };
        for (key, value) in map {
            // A value written without "./" ("browser.js") names a file of the
            // package when the package has that file; otherwise it is a module.
            let as_file;
            let target = match value {
                PackageJSONExport::Value(v) if files_map.contains_key(&make_mod_specifier_absolute(".", v)) => {
                    as_file = format!("./{}", make_mod_specifier_absolute(".", v));
                    Some(as_file.as_str())
                }
                PackageJSONExport::Value(v) => Some(v.as_str()),
                _ => None, // `false` / `null`: not loaded in the browser
            };
            let is_file = |s: &str| s.starts_with("./") || s.starts_with("../") || s.starts_with('/');
            if is_file(key) {
                let file = target.filter(|t| is_file(t)).map(|t| make_mod_specifier_absolute(".", t));
                field.files.insert(make_mod_specifier_absolute(".", key), file);
            } else {
                let replacement = match target {
                    None => Replacement::Excluded,
                    Some(t) if is_file(t) => Replacement::File(make_mod_specifier_absolute(".", t)),
                    Some(t) => Replacement::Module(t.to_string()),
                };
                field.modules.insert(key.clone(), replacement);
            }
        }
        field
    }

    /// The file loaded in place of `file`, or None when it is excluded.
    fn file(&self, file: String) -> Option<String> {
        let without_ext = extract_file_extension(&file).map(|ext| &file[..file.len() - ext.len()]);
        let alias = self.files.get(&file).or_else(|| without_ext.and_then(|f| self.files.get(f)));
        match alias {
            Some(target) => target.clone(),
            None => Some(file),
        }
    }

    fn module(&self, specifier: &str) -> Replacement {
        match self.modules.get(specifier) {
            Some(Replacement::Excluded) => Replacement::Excluded,
            Some(Replacement::File(f)) => Replacement::File(f.clone()),
            Some(Replacement::Module(m)) => Replacement::Module(m.clone()),
            Some(Replacement::Keep) | None => Replacement::Keep,
        }
    }
}

/// The target the key of `map` matching `subpath` gives it, or None when no
/// key matches (Node's PACKAGE_IMPORTS_EXPORTS_RESOLVE): an exact key, else
/// the pattern key with the longest prefix, the longer key breaking a tie. A
/// pattern's `*` stands for any non-empty rest, slashes included, and is
/// substituted in the target; a key ending in `/` (the pre-pattern directory
/// form) has the rest appended.
fn subpath_target(map: &HashMap<String, PackageJSONExport>, subpath: &str) -> Option<ExportTarget> {
    if !subpath.contains('*') && !subpath.ends_with('/') {
        if let Some(value) = map.get(subpath) {
            return Some(resolve_export_target(value));
        }
    }
    // (base length, key length), trailer length, directory key, value
    let mut best: Option<((usize, usize), usize, bool, &PackageJSONExport)> = None;
    for (key, value) in map {
        let (base, trailer, directory) = match key.find('*') {
            Some(star) if key[star + 1..].contains('*') => continue,
            Some(star) => (&key[..star], &key[star + 1..], false),
            None if key.ends_with('/') => (key.as_str(), "", true),
            None => continue,
        };
        if subpath.len() <= base.len() || !subpath.starts_with(base) {
            continue;
        }
        if !trailer.is_empty() && (subpath.len() < key.len() || !subpath.ends_with(trailer)) {
            continue;
        }
        let specificity = (base.len(), key.len());
        if best.as_ref().is_some_and(|(found, ..)| *found >= specificity) {
            continue;
        }
        best = Some((specificity, trailer.len(), directory, value));
    }
    best.map(|((base_len, _), trailer_len, directory, value)| {
        let matched = &subpath[base_len..subpath.len() - trailer_len];
        match resolve_export_target(value) {
            ExportTarget::Path(target) if directory => ExportTarget::Path(format!("{target}{matched}")),
            ExportTarget::Path(target) => ExportTarget::Path(target.replace('*', matched)),
            other => other,
        }
    })
}

/// The `exports` target for `entry`: None when no key matches (the bundler
/// then resolves the entry as a file path).
fn export_target(exports: &PackageJSONExport, entry: &str) -> Option<ExportTarget> {
    match exports {
        PackageJSONExport::Map(map) if map.keys().any(|k| k.starts_with('.')) => subpath_target(map, entry),
        // A bare target or a conditions object only exports the root.
        _ if entry == ROOT_ENTRY => Some(resolve_export_target(exports)),
        _ => None,
    }
}

/// What an import made by a file of the package loads.
pub enum Edge {
    /// Files of the package itself.
    Files(Vec<String>),
    /// Another module, by the specifier that names it (the package's own name
    /// for a self-import).
    Package(String),
    /// Nothing the browser build loads.
    None,
}

/// The import graph of one package as the bundler resolves it: `exports`,
/// `imports` and the `browser` field applied to the package's file list.
pub struct PackageGraph<'a> {
    pkg: &'a PackageJSON,
    files_map: &'a HashMap<String, u64>,
    browser: BrowserField,
}

impl<'a> PackageGraph<'a> {
    pub fn new(pkg: &'a PackageJSON, files_map: &'a HashMap<String, u64>) -> Self {
        PackageGraph { pkg, files_map, browser: BrowserField::from_pkg(pkg, files_map) }
    }

    /// The files a package-relative path (or glob) names, each replaced as the
    /// `browser` field says. `ext` is the importing file's extension, tried first.
    pub fn path_files(&self, path: &str, ext: Option<&str>) -> Vec<String> {
        collect_files(&make_mod_specifier_absolute(".", path), self.files_map, ext)
            .into_iter()
            .filter_map(|f| self.browser.file(f))
            .collect()
    }

    /// The files the entry `.` or `./subpath` loads.
    pub fn entry_files(&self, entry: &str) -> Vec<String> {
        let exported = self.pkg.exports.as_ref().and_then(|exports| export_target(exports, entry));
        let as_path = || if entry == ROOT_ENTRY { get_main_entry(self.pkg) } else { entry.to_string() };
        match exported {
            Some(ExportTarget::Path(target)) => {
                let files = self.path_files(&target, None);
                // An exported file that does not exist: the entry may still be a path.
                if files.is_empty() { self.path_files(&as_path(), None) } else { files }
            }
            Some(ExportTarget::Excluded) | Some(ExportTarget::Unmatched) => vec![],
            None => self.path_files(&as_path(), None),
        }
    }

    /// What the import `dep`, written in `file`, loads.
    pub fn edge(&self, file: &str, dep: &str) -> Edge {
        let ext = extract_file_extension(file);
        match parse_module_specifier(dep) {
            Some(ModuleSpecifier::Relative(path)) => {
                let dir = file_path_to_dirname(file);
                let found = collect_files(&make_mod_specifier_absolute(&dir, &path), self.files_map, ext);
                Edge::Files(found.into_iter().filter_map(|f| self.browser.file(f)).collect())
            }
            Some(ModuleSpecifier::Package { .. }) => self.module_edge(dep, ext),
            // `#name`: this package's `imports`, with the conditions of `exports`.
            Some(ModuleSpecifier::PackageImport(name)) => {
                let Some(PackageJSONExport::Map(imports)) = &self.pkg.imports else {
                    return Edge::None;
                };
                match subpath_target(imports, &name) {
                    Some(ExportTarget::Path(target)) if target.starts_with("./") => {
                        Edge::Files(self.path_files(&target, ext))
                    }
                    // Only `imports` may name another module.
                    Some(ExportTarget::Path(target)) => self.module_edge(&target, ext),
                    _ => Edge::None,
                }
            }
            None => Edge::None,
        }
    }

    fn module_edge(&self, specifier: &str, ext: Option<&str>) -> Edge {
        let specifier = match self.browser.module(specifier) {
            Replacement::Excluded => return Edge::None,
            Replacement::File(f) => {
                let found = collect_files(&f, self.files_map, ext);
                return Edge::Files(found.into_iter().filter_map(|f| self.browser.file(f)).collect());
            }
            Replacement::Module(m) => m,
            Replacement::Keep => specifier.to_string(),
        };
        match parse_module_specifier(&specifier) {
            Some(ModuleSpecifier::Package { .. }) => Edge::Package(specifier),
            _ => Edge::None,
        }
    }
}

/// The files of a processed package by size, and its manifest: what a
/// `PackageGraph` over it is built from.
fn package_view(name: &str, module: &MinimalCachedModule) -> (PackageJSON, HashMap<String, u64>) {
    let files_map: HashMap<String, u64> = module
        .files
        .iter()
        .map(|(path, file)| {
            let size = match file {
                MinimalFile::File { content, .. } => content.len() as u64,
                MinimalFile::Ignored(size) => *size,
                MinimalFile::Failed(_) => 0,
            };
            (path.clone(), size)
        })
        .collect();
    let pkg = match module.files.get("package.json") {
        Some(MinimalFile::File { content, .. }) => parse_pkg_json(content.clone()).ok(),
        _ => None,
    }
    .unwrap_or_else(|| empty_pkg(name));
    (pkg, files_map)
}

/// Code the bundler would have to compile itself if it got it as published.
fn is_code(path: &str) -> bool {
    matches!(path.rsplit('.').next(), Some("js" | "mjs" | "cjs"))
}

/// The code files `entries` name that the package was not transformed along.
/// A package is processed from the entries it declares, but any file of one
/// without `exports` can be imported (`dayjs/plugin/utc`,
/// `lodash/debounce`): such a file is only listed until it is asked for.
pub fn untransformed_entry_files<'a>(
    name: &str,
    module: &MinimalCachedModule,
    entries: impl IntoIterator<Item = &'a String>,
) -> Vec<String> {
    let (pkg, files_map) = package_view(name, module);
    let graph = PackageGraph::new(&pkg, &files_map);
    let mut found: Vec<String> = Vec::new();
    for entry in entries {
        for file in graph.entry_files(entry) {
            if is_code(&file) && matches!(module.files.get(&file), Some(MinimalFile::Ignored(_))) && !found.contains(&file) {
                found.push(file);
            }
        }
    }
    found
}

/// The closure of `entries` within the processed `module` of package `name`.
pub fn entry_closure<'a>(
    name: &str,
    module: &MinimalCachedModule,
    entries: impl IntoIterator<Item = &'a String>,
) -> EntryClosure {
    let (pkg, files_map) = package_view(name, module);
    let graph = PackageGraph::new(&pkg, &files_map);

    let mut closure = EntryClosure::default();
    let mut queue: Vec<String> = Vec::new();
    for entry in entries {
        queue.extend(graph.entry_files(entry));
    }

    while let Some(file) = queue.pop() {
        if !closure.files.insert(file.clone()) {
            continue;
        }
        let Some(MinimalFile::File { dependencies, .. }) = module.files.get(&file) else {
            continue; // not transformed: no known edges
        };
        for dep in dependencies {
            match graph.edge(&file, dep) {
                Edge::Files(files) => queue.extend(files),
                Edge::Package(specifier) => {
                    if let Some(ModuleSpecifier::Package { name: package, subpath }) = parse_module_specifier(&specifier) {
                        closure.packages.entry(package).or_default().insert(entry_of(subpath.as_deref()));
                    }
                }
                Edge::None => {}
            }
        }
    }
    closure
}

fn empty_pkg(name: &str) -> PackageJSON {
    PackageJSON {
        name: name.to_string(),
        version: String::new(),
        main: None,
        module: None,
        js_next_main: None,
        browser: None,
        exports: None,
        imports: None,
        dependencies: None,
        peer_dependencies: None,
    }
}

/// The package's file listing: `package.json` plus every other file by size,
/// nothing inlined. The bundler resolves against it and fetches entries'
/// code separately.
pub fn listing(module: &MinimalCachedModule) -> MinimalCachedModule {
    let files = module
        .files
        .iter()
        .map(|(path, file)| {
            let listed = match file {
                MinimalFile::File { content, .. } if path != "package.json" => MinimalFile::Ignored(content.len() as u64),
                other => other.clone(),
            };
            (path.clone(), listed)
        })
        .collect();
    MinimalCachedModule { files, modules: vec![] }
}

/// The transformed files `entry` loads, and the packages they import.
pub fn entry_module(name: &str, module: &MinimalCachedModule, entry: &String) -> MinimalCachedModule {
    let closure = entry_closure(name, module, [entry]);
    let files = closure
        .files
        .iter()
        .filter_map(|path| match module.files.get(path) {
            Some(file @ MinimalFile::File { .. }) => Some((path.clone(), file.clone())),
            _ => None, // listed only: the bundler fetches it raw
        })
        .collect();
    let modules = closure.packages.into_keys().filter(|package| package != name).collect();
    MinimalCachedModule { files, modules }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(content: &str, deps: &[&str]) -> MinimalFile {
        MinimalFile::File {
            content: content.to_string(),
            dependencies: deps.iter().map(|d| d.to_string()).collect(),
            is_transpiled: true,
            scan: None,
            unlisted: vec![],
        }
    }

    // A three-like package: a bundle at the root, wildcard-exported addons that
    // import the package itself, and Emscripten glue requiring Node builtins.
    fn three() -> MinimalCachedModule {
        let pkg = r#"{
            "name": "three",
            "main": "./build/three.cjs",
            "module": "./build/three.module.js",
            "exports": {
                ".": { "import": "./build/three.module.js", "require": "./build/three.cjs" },
                "./addons/*": "./examples/jsm/*",
                "./examples/jsm/*": "./examples/jsm/*"
            }
        }"#;
        let files = HashMap::from([
            ("package.json".to_string(), file(pkg, &[])),
            ("build/three.cjs".to_string(), file("cjs", &[])),
            ("build/three.module.js".to_string(), file("esm", &[])),
            ("examples/jsm/controls/OrbitControls.js".to_string(), file("orbit", &["three", "../utils/math.js"])),
            ("examples/jsm/utils/math.js".to_string(), file("math", &[])),
            ("examples/jsm/libs/draco/draco_decoder.js".to_string(), file("draco", &["fs", "path"])),
            ("examples/jsm/loaders/DRACOLoader.js".to_string(), file("loader", &["three", "../libs/draco/draco_decoder.js"])),
        ]);
        MinimalCachedModule { files, modules: vec![] }
    }

    fn set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_root_entry_loads_only_the_bundle() {
        let closure = entry_closure("three", &three(), [&".".to_string()]);
        // `browser` is the first export condition; `import` is not in the order,
        // `require` is — matching the bundler's resolver.
        assert_eq!(closure.files, set(&["build/three.cjs"]));
        assert!(closure.packages.is_empty());
    }

    #[test]
    fn a_wildcard_entry_loads_its_relative_closure_and_reports_the_self_import() {
        let closure = entry_closure("three", &three(), [&"./addons/controls/OrbitControls.js".to_string()]);
        assert_eq!(closure.files, set(&["examples/jsm/controls/OrbitControls.js", "examples/jsm/utils/math.js"]));
        assert_eq!(closure.packages, BTreeMap::from([("three".to_string(), set(&["."]))]));
    }

    #[test]
    fn node_builtins_are_only_requested_by_the_entries_that_load_them() {
        let closure = entry_closure("three", &three(), [&"./addons/loaders/DRACOLoader.js".to_string()]);
        assert_eq!(closure.packages.keys().cloned().collect::<Vec<_>>(), vec!["fs", "path", "three"]);
    }

    #[test]
    fn an_unexported_file_path_resolves_as_a_file() {
        let closure = entry_closure("three", &three(), [&"./build/three.module.js".to_string()]);
        assert_eq!(closure.files, set(&["build/three.module.js"]));
    }

    #[test]
    fn the_browser_field_replaces_files_and_excludes_modules() {
        let pkg = r#"{ "name": "x", "main": "./index.js",
            "browser": { "./node.js": "./browser.js", "fs": false, "ws": "./ws-shim.js" } }"#;
        let module = MinimalCachedModule {
            files: HashMap::from([
                ("package.json".to_string(), file(pkg, &[])),
                ("index.js".to_string(), file("i", &["./node", "fs", "ws", "react/jsx-runtime"])),
                ("node.js".to_string(), file("n", &["http"])),
                ("browser.js".to_string(), file("b", &[])),
                ("ws-shim.js".to_string(), file("w", &[])),
            ]),
            modules: vec![],
        };
        let closure = entry_closure("x", &module, [&".".to_string()]);
        assert_eq!(closure.files, set(&["browser.js", "index.js", "ws-shim.js"]));
        assert_eq!(closure.packages, BTreeMap::from([("react".to_string(), set(&["./jsx-runtime"]))]));
    }

    fn package(pkg: &str, files: &[(&str, &[&str])]) -> MinimalCachedModule {
        let mut map = HashMap::from([("package.json".to_string(), file(pkg, &[]))]);
        for (path, deps) in files {
            map.insert(path.to_string(), file(path, deps));
        }
        MinimalCachedModule { files: map, modules: vec![] }
    }

    fn closure_of(name: &str, module: &MinimalCachedModule, entry: &str) -> EntryClosure {
        entry_closure(name, module, [&entry.to_string()])
    }

    #[test]
    fn the_longest_matching_prefix_wins_and_the_longer_key_breaks_a_tie() {
        let module = package(
            r#"{ "name": "ui", "exports": {
                "./*": "./dist/*.js",
                "./features/*": "./src/features/*.js",
                "./features/*.css": "./styles/*.css",
                "./features/exact": "./exact.js",
                "./legacy/": "./old/"
            } }"#,
            &[
                ("dist/button.js", &[]),
                ("src/features/a/b.js", &[]),
                ("styles/a.css", &[]),
                ("exact.js", &[]),
                ("old/x/y.js", &[]),
            ],
        );
        assert_eq!(closure_of("ui", &module, "./button").files, set(&["dist/button.js"]));
        assert_eq!(closure_of("ui", &module, "./features/a/b").files, set(&["src/features/a/b.js"]));
        assert_eq!(closure_of("ui", &module, "./features/a.css").files, set(&["styles/a.css"]));
        assert_eq!(closure_of("ui", &module, "./features/exact").files, set(&["exact.js"]));
        assert_eq!(closure_of("ui", &module, "./legacy/x/y.js").files, set(&["old/x/y.js"]));
    }

    #[test]
    fn top_level_conditions_are_the_root_entry() {
        let module = package(
            r#"{ "name": "decode", "main": "index.js",
                "exports": { "deno": "./index.js", "browser": "./index.dom.js", "default": "./index.js" } }"#,
            &[("index.js", &["character-entities"]), ("index.dom.js", &[])],
        );
        let closure = closure_of("decode", &module, ".");
        assert_eq!(closure.files, set(&["index.dom.js"]));
        assert!(closure.packages.is_empty());
    }

    #[test]
    fn a_null_target_loads_nothing_and_a_missing_exported_file_falls_back_to_the_path() {
        let module = package(
            r#"{ "name": "x", "exports": { ".": "./index.js", "./internal": null, "./gone": "./dist/gone.js" } }"#,
            &[("index.js", &[]), ("internal.js", &[]), ("gone.js", &[])],
        );
        assert!(closure_of("x", &module, "./internal").files.is_empty());
        assert_eq!(closure_of("x", &module, "./gone").files, set(&["gone.js"]));
    }

    // vfile: `#minpath` is the browser build of a file of the package itself;
    // an `imports` entry may also name another package.
    #[test]
    fn package_imports_are_followed_with_the_bundlers_conditions() {
        let module = package(
            r##"{ "name": "vfile", "exports": "./index.js", "imports": {
                "#minpath": { "node": "./lib/minpath.js", "default": "./lib/minpath.browser.js" },
                "#dep": { "node": "dep-node", "default": "dep-browser/sub" },
                "#internal/*": "./lib/internal/*.js",
                "#node-only": { "node": "./lib/minpath.js" }
            } }"##,
            &[
                ("index.js", &["./lib/index.js"]),
                ("lib/index.js", &["#minpath", "#dep", "#internal/a/b", "#node-only", "#undefined"]),
                ("lib/minpath.js", &["path"]),
                ("lib/minpath.browser.js", &[]),
                ("lib/internal/a/b.js", &["unist-util-stringify-position"]),
            ],
        );
        let closure = closure_of("vfile", &module, ".");
        assert_eq!(
            closure.files,
            set(&["index.js", "lib/index.js", "lib/internal/a/b.js", "lib/minpath.browser.js"])
        );
        assert_eq!(
            closure.packages,
            BTreeMap::from([
                ("dep-browser".to_string(), set(&["./sub"])),
                ("unist-util-stringify-position".to_string(), set(&["."])),
            ])
        );
    }

    // axios lists `./lib/adapters/http.js` in `exports` and replaces it in `browser`.
    #[test]
    fn the_browser_field_replaces_an_exported_file() {
        let module = package(
            r#"{ "name": "axios", "module": "./index.js",
                "browser": { "./lib/adapters/http.js": "./lib/helpers/null.js" },
                "exports": { ".": { "browser": { "require": "./dist/browser/axios.cjs", "default": "./index.js" } },
                    "./lib/adapters/http.js": "./lib/adapters/http.js" } }"#,
            &[
                ("index.js", &["./lib/adapters/adapters.js"]),
                ("lib/adapters/adapters.js", &["./http.js"]),
                ("lib/adapters/http.js", &["proxy-from-env", "http"]),
                ("lib/helpers/null.js", &[]),
            ],
        );
        let root = closure_of("axios", &module, ".");
        assert_eq!(root.files, set(&["index.js", "lib/adapters/adapters.js", "lib/helpers/null.js"]));
        assert!(root.packages.is_empty());
        assert_eq!(closure_of("axios", &module, "./lib/adapters/http.js").files, set(&["lib/helpers/null.js"]));
    }

    #[test]
    fn a_browser_value_without_dot_slash_is_a_file_of_the_package_when_it_has_one() {
        let module = package(
            r#"{ "name": "sloppy", "main": "index.js",
                "browser": { "./node.js": "browser.js", "ws": "ws-shim.js", "fs": "memfs" } }"#,
            &[
                ("index.js", &["./node", "ws", "fs"]),
                ("node.js", &["net"]),
                ("browser.js", &[]),
                ("ws-shim.js", &[]),
            ],
        );
        let closure = closure_of("sloppy", &module, ".");
        assert_eq!(closure.files, set(&["browser.js", "index.js", "ws-shim.js"]));
        assert_eq!(closure.packages, BTreeMap::from([("memfs".to_string(), set(&["."]))]));
    }

    #[test]
    fn an_entry_response_inlines_only_its_closure() {
        let module = three();
        let response = entry_module("three", &module, &"./addons/loaders/DRACOLoader.js".to_string());
        let mut files: Vec<_> = response.files.keys().cloned().collect();
        files.sort();
        assert_eq!(files, vec!["examples/jsm/libs/draco/draco_decoder.js", "examples/jsm/loaders/DRACOLoader.js"]);
        assert_eq!(response.modules, vec!["fs", "path"]);
        let listed = listing(&module);
        assert!(matches!(listed.files.get("build/three.cjs"), Some(MinimalFile::Ignored(3))));
        assert!(matches!(listed.files.get("package.json"), Some(MinimalFile::File { .. })));
    }

    #[test]
    fn entry_names() {
        assert_eq!(entry_of(None), ".");
        assert_eq!(entry_of(Some("client")), "./client");
        assert_eq!(entry_of(Some("/_/_interop/")), "./_/_interop");
    }
}
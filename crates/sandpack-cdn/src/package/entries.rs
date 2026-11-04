//! Entry closures: the part of a processed package that an import loads.
//!
//! A package is transformed once over its whole published surface (every
//! `exports` target, wildcards included), but an import only loads the files
//! reachable from the entries it names (`.` for `three`, `./addons/x.js` for
//! `three/addons/x.js`). `/package` serves those closures and `/dep_tree`
//! follows only the package imports they make, so code an app never loads is
//! neither inlined nor installed.
//!
//! A closure follows relative imports only. Bare imports — including a
//! package importing itself (`three`'s addons import `three`) — are package
//! edges with their entries, so each entry's files are served once. The
//! `browser` field applies as the bundler applies it: file replacements are
//! followed, and modules mapped to `false` are not loaded at all.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::npm_specifier::{parse_module_specifier, ModuleSpecifier};
use super::package_json::{get_export_entry, get_main_entry, parse_pkg_json, PackageJSON, PackageJSONExport};
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
    fn from_pkg(pkg: &PackageJSON) -> Self {
        let mut field = BrowserField::default();
        let Some(PackageJSONExport::Map(map)) = &pkg.browser else {
            return field;
        };
        for (key, value) in map {
            let target = match value {
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

/// The `exports` target for `entry`: None when no key matches (the bundler
/// then resolves the entry as a file path), Some(None) when the key maps to
/// `null`/`false`. Wildcard keys substitute their match; the longest prefix
/// wins, as in Node.
fn export_target(exports: &PackageJSONExport, entry: &str) -> Option<Option<String>> {
    match exports {
        PackageJSONExport::Map(map) if map.keys().any(|k| k.starts_with('.')) => {
            if let Some(value) = map.get(entry) {
                return Some(get_export_entry(value));
            }
            let mut best: Option<(usize, Option<String>)> = None;
            for (key, value) in map {
                let Some(star) = key.find('*') else { continue };
                let (prefix, suffix) = (&key[..star], &key[star + 1..]);
                if entry.len() < prefix.len() + suffix.len() || !entry.starts_with(prefix) || !entry.ends_with(suffix) {
                    continue;
                }
                if best.as_ref().is_some_and(|(len, _)| *len >= prefix.len()) {
                    continue;
                }
                let matched = &entry[prefix.len()..entry.len() - suffix.len()];
                best = Some((prefix.len(), get_export_entry(value).map(|t| t.replace('*', matched))));
            }
            best.map(|(_, target)| target)
        }
        // A bare target or a conditions object only exports the root.
        _ if entry == ROOT_ENTRY => Some(get_export_entry(exports)),
        _ => None,
    }
}

fn resolve_entry(pkg: &PackageJSON, entry: &str, files_map: &HashMap<String, u64>) -> Vec<String> {
    let target = match pkg.exports.as_ref().and_then(|exports| export_target(exports, entry)) {
        Some(Some(target)) => target,
        Some(None) => return vec![],
        None if entry == ROOT_ENTRY => get_main_entry(pkg),
        None => entry.to_string(),
    };
    collect_files(&make_mod_specifier_absolute(".", &target), files_map, None)
}

/// The closure of `entries` within the processed `module` of package `name`.
pub fn entry_closure<'a>(
    name: &str,
    module: &MinimalCachedModule,
    entries: impl IntoIterator<Item = &'a String>,
) -> EntryClosure {
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
    let browser = BrowserField::from_pkg(&pkg);

    let mut closure = EntryClosure::default();
    let mut queue: Vec<String> = Vec::new();
    for entry in entries {
        queue.extend(resolve_entry(&pkg, entry, &files_map).into_iter().filter_map(|f| browser.file(f)));
    }

    while let Some(file) = queue.pop() {
        if !closure.files.insert(file.clone()) {
            continue;
        }
        let Some(MinimalFile::File { dependencies, .. }) = module.files.get(&file) else {
            continue; // not transformed: no known edges
        };
        let dir = file_path_to_dirname(&file);
        let ext = extract_file_extension(&file);
        for dep in dependencies {
            match parse_module_specifier(dep) {
                Some(ModuleSpecifier::Relative(path)) => {
                    let found = collect_files(&make_mod_specifier_absolute(&dir, &path), &files_map, ext);
                    queue.extend(found.into_iter().filter_map(|f| browser.file(f)));
                }
                Some(ModuleSpecifier::Package { .. }) => {
                    let specifier = match browser.module(dep) {
                        Replacement::Excluded => continue,
                        Replacement::File(f) => {
                            queue.extend(collect_files(&f, &files_map, ext).into_iter().filter_map(|f| browser.file(f)));
                            continue;
                        }
                        Replacement::Module(m) => m,
                        Replacement::Keep => dep.clone(),
                    };
                    if let Some(ModuleSpecifier::Package { name: package, subpath }) = parse_module_specifier(&specifier) {
                        closure.packages.entry(package).or_default().insert(entry_of(subpath.as_deref()));
                    }
                }
                None => {}
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

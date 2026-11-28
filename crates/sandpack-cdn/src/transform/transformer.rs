use std::collections::{HashMap, HashSet};

use swc_core::common::comments::SingleThreadedComments;
use swc_core::common::{sync::Lrc, FileName, Globals, Mark, SourceMap, SyntaxContext, GLOBALS};
use swc_core::ecma::ast::{EsVersion, Program};
use swc_core::ecma::atoms::Atom;
use swc_core::ecma::codegen::text_writer::JsWriter;
use swc_core::ecma::codegen::{Config as CodegenConfig, Emitter};
use swc_core::ecma::parser::lexer::Lexer;
use swc_core::ecma::parser::{EsSyntax, Parser, StringInput, Syntax};
use swc_core::ecma::transforms::base::fixer::fixer;
use swc_core::ecma::transforms::base::helpers::{inject_helpers, Helpers, HELPERS};
use swc_core::ecma::transforms::base::hygiene::hygiene;
use swc_core::ecma::transforms::base::resolver;
use swc_core::ecma::transforms::module::common_js::{common_js, Config as CommonJsConfig};
use swc_core::ecma::transforms::module::path::Resolver;
use swc_core::ecma::transforms::optimization::simplify::expr::Config as SimplifyExprConfig;
use swc_core::ecma::transforms::optimization::simplify::{dead_branch_remover, expr_simplifier};
use swc_core::ecma::utils::collect_decls;
use swc_core::ecma::visit::{VisitMutWith, VisitWith};
use tracing::info;

use crate::app_error::ServerError;

use super::dependency_collector::DependencyCollector;
use super::env_replacer::EnvReplacer;
use super::import_meta::ImportMetaReplacer;
use super::module_scan::{scan_module, ModuleScan};

#[derive(Debug)]
pub struct TransformedFile {
    pub content: String,
    pub dependencies: HashSet<String>,
    /// What the bundler would learn by parsing `content`.
    pub scan: ModuleScan,
}

/// What a file is parsed as. Node decides by the extension and the package's
/// `type`; published packages also ship ES modules in plain `.js` files (the
/// `module` field), which bundlers accept, so those are decided by what the
/// file contains.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceKind {
    /// An ES module: strict, top-level `this` is undefined.
    Module,
    /// CommonJS: a function body, sloppy unless it says otherwise, top-level
    /// `this` is `module.exports`.
    CommonJs,
    /// An ES module if the parsed program has an import or export declaration
    /// (or a top-level await), CommonJS otherwise.
    Auto,
}

impl SourceKind {
    /// `package_type` is the `type` field of the nearest package.json.
    pub fn of(filename: &str, package_type: Option<&str>) -> Self {
        match filename.rsplit('.').next() {
            Some("mjs") => SourceKind::Module,
            Some("cjs") => SourceKind::CommonJs,
            _ if package_type == Some("module") => SourceKind::Module,
            _ => SourceKind::Auto,
        }
    }
}

fn parse(
    code: &str,
    kind: SourceKind,
    source_map: &Lrc<SourceMap>,
    comments: &SingleThreadedComments,
) -> Result<Program, ServerError> {
    let source_file = source_map.new_source_file(FileName::Anon.into(), code.to_string());

    let syntax = Syntax::Es(EsSyntax {
        jsx: false,
        export_default_from: true,
        decorators: true,
        ..Default::default()
    });

    let parser = || {
        Parser::new_from(Lexer::new(
            syntax,
            EsVersion::latest(),
            StringInput::from(&*source_file),
            Some(comments),
        ))
    };
    let parse_error = |err| ServerError::SWCParseError {
        message: format!("{:?}", err),
    };

    match kind {
        SourceKind::Module => parser()
            .parse_module()
            .map(Program::Module)
            .map_err(parse_error),
        SourceKind::CommonJs => parser()
            .parse_commonjs()
            .map(Program::Script)
            .map_err(parse_error),
        SourceKind::Auto => match parser().parse_program() {
            Ok(program) => Ok(program),
            // A script is parsed at the top level, where CommonJS's `return`
            // (it runs as a function body) is an error.
            Err(err) => {
                // The failed pass recorded the comments it saw.
                {
                    let (mut leading, mut trailing) = comments.borrow_all_mut();
                    leading.clear();
                    trailing.clear();
                }
                parser()
                    .parse_commonjs()
                    .map(Program::Script)
                    .map_err(|_| parse_error(err))
            }
        },
    }
}

/// Transforms a file whose package `type` is not known: the extension and the
/// parsed program decide what it is.
pub fn transform_file(filename: &str, code: &str) -> Result<TransformedFile, ServerError> {
    transform_file_as(filename, code, SourceKind::of(filename, None))
}

#[tracing::instrument(name = "transform_file", skip(code))]
pub fn transform_file_as(
    filename: &str,
    code: &str,
    kind: SourceKind,
) -> Result<TransformedFile, ServerError> {
    info!("Transforming file: {}", filename);

    // Error early if filename does not end in js: js, cjs, mjs, ...
    let ext = &filename[filename.len() - 2..];
    if ext.ne("js") {
        return Err(ServerError::SWCParseError {
            message: format!("File {} is not JavaScript", filename),
        });
    }

    let source_map = Lrc::new(SourceMap::default());
    let comments = SingleThreadedComments::default();
    let program = parse(code, kind, &source_map, &comments)?;

    // SWC's visit/fold passes recurse deeply (common_js, simplify, ...). The
    // required depth easily exceeds the 2 MB default Windows thread stack (Linux
    // defaults to 8 MB, which is why this only bit on Windows). Grow the stack on
    // demand instead of relying on the OS-provided size so debug builds, tests
    // and the server all behave identically. `maybe_grow` runs on the same thread
    // so thread-locals (GLOBALS/HELPERS) stay intact.
    stacker::maybe_grow(2 * 1024 * 1024, 64 * 1024 * 1024, move || {
        GLOBALS.set(&Globals::new(), || {
            // Inline helpers (requires swc_core feature `ecma_helpers_inline`).
            // Sandpack evals each file as a CJS function body — pulling
            // `@swc/helpers` as a runtime dep is the wrong model (extra packages,
            // cache keys, and import/require ordering traps). Order is the SWC
            // contract: transforms that *use* helpers first, then inject_helpers
            // to materialize their bodies in-file.
            HELPERS.set(&Helpers::new(/* external */ false), || {
                    let unresolved_mark = Mark::new();
                    let top_level_mark = Mark::new();

                    let mut program =
                        program.apply(resolver(unresolved_mark, top_level_mark, false));

                    // `import.meta` becomes the object the bundler hands every
                    // module. Left to the CommonJS pass, `import.meta.url` turns
                    // into `require("url").pathToFileURL(__filename)`: a Node
                    // answer, and a dependency on `url`.
                    program.visit_mut_with(&mut ImportMetaReplacer {
                        unresolved_ctxt: SyntaxContext::empty().apply_mark(unresolved_mark),
                    });

                    // Inline process.env.NODE_ENV / process.browser so that the
                    // simplifier can drop dead branches (and we don't collect deps
                    // that live inside always-false conditionals).
                    let mut env: HashMap<Atom, Atom> = HashMap::new();
                    env.insert("NODE_ENV".into(), "development".into());

                    let decls: HashSet<(Atom, SyntaxContext)> =
                        collect_decls(&program).into_iter().collect();
                    program.visit_mut_with(&mut EnvReplacer {
                        env: &env,
                        is_browser: true,
                        decls: &decls,
                    });

                    let program = program
                        .apply(expr_simplifier(unresolved_mark, SimplifyExprConfig::default()))
                        .apply(dead_branch_remover(unresolved_mark))
                        .apply(common_js(
                            Resolver::Default,
                            unresolved_mark,
                            CommonJsConfig {
                                preserve_import_meta: true,
                                ..Default::default()
                            },
                            Default::default(),
                        ))
                        .apply(inject_helpers(unresolved_mark));

                    // Collect dependencies after CJS so helper/import edges are
                    // visible as `require("…")` calls.
                    let decls: HashSet<(Atom, SyntaxContext)> =
                        collect_decls(&program).into_iter().collect();
                    let mut dependencies: HashSet<String> = HashSet::new();
                    program.visit_with(&mut DependencyCollector {
                        items: &mut dependencies,
                        decls: &decls,
                    });

                    let program = program.apply(hygiene()).apply(fixer(Some(&comments)));
                    let scan = scan_module(&program);

                    // Remove sourcemap comment
                    {
                        let (mut _leading_comments, mut trailing_comments) =
                            comments.borrow_all_mut();
                        for (_key, value) in trailing_comments.iter_mut() {
                            if let Some(index) = value.iter().position(|comment| {
                                comment.text.starts_with("# sourceMappingURL")
                            }) {
                                value.remove(index);
                            }
                        }
                    }

                    // Print code...
                    let mut buf = vec![];
                    {
                        let mut emitter = Emitter {
                            cfg: CodegenConfig::default().with_minify(true),
                            comments: Some(&comments),
                            cm: source_map.clone(),
                            wr: JsWriter::new(source_map.clone(), "\n", &mut buf, None),
                        };
                        emitter.emit_program(&program)?;
                    }

                    let output = String::from(std::str::from_utf8(&buf).unwrap_or(""));

                    Ok(TransformedFile {
                        content: output,
                        dependencies,
                        scan,
                    })
                },
            )
        })
    })
}

#[cfg(test)]
mod test {
    use crate::transform::transformer::{transform_file, transform_file_as, SourceKind};

    #[test]
    fn inlines_env_variables() {
        assert_eq!(
            transform_file("index.js", "module.exports = process.env.NODE_ENV;")
                .unwrap()
                .content,
            String::from("module.exports=\"development\";")
        );
    }

    // libtess (p5): `this.libtess = …; module.exports = this.libtess`. Parsed as an
    // ES module, `this` became `void 0` and the file threw when it ran.
    #[test]
    fn commonjs_keeps_top_level_this() {
        let res = transform_file(
            "libtess.min.js",
            "var n;this.libtess={a:1};if(typeof module!=='undefined'){module.exports=this.libtess}",
        )
        .unwrap();
        assert!(res.content.contains("this.libtess={"), "{}", res.content);
        assert!(res.content.contains("module.exports=this.libtess"), "{}", res.content);
        assert!(!res.content.contains("void 0"), "{}", res.content);
    }

    #[test]
    fn commonjs_stays_sloppy() {
        // Strict mode rejects each of these; a CommonJS file may use them.
        let code = "var legacy = 010; function f(){ return arguments.callee; } with (Math) { exports.max = max; } delete legacy;";
        let res = transform_file("index.js", code).unwrap();
        assert!(!res.content.contains("use strict"), "{}", res.content);
        assert!(res.content.contains("with(Math)"), "{}", res.content);
    }

    #[test]
    fn commonjs_may_return_at_the_top_level() {
        let code = "if (typeof window === 'undefined') return; module.exports = require('./dom.js');";
        for filename in ["index.js", "index.cjs"] {
            let res = transform_file(filename, code).unwrap();
            assert!(res.content.contains("return;"), "{}", res.content);
            assert!(res.dependencies.contains("./dom.js"));
        }
    }

    #[test]
    fn es_modules_stay_strict_with_undefined_this() {
        let res = transform_file("index.js", "export const self = this;").unwrap();
        assert!(res.content.starts_with("\"use strict\";"), "{}", res.content);
        assert!(res.content.contains("void 0"), "{}", res.content);
        assert!(!res.content.contains("this"), "{}", res.content);
    }

    #[test]
    fn extension_and_package_type_decide_before_the_content() {
        assert_eq!(SourceKind::of("a.mjs", None), SourceKind::Module);
        assert_eq!(SourceKind::of("a.cjs", Some("module")), SourceKind::CommonJs);
        assert_eq!(SourceKind::of("a.js", Some("module")), SourceKind::Module);
        assert_eq!(SourceKind::of("a.js", Some("commonjs")), SourceKind::Auto);
        assert_eq!(SourceKind::of("a.js", None), SourceKind::Auto);

        // No import or export: only the extension or the package type says it is a module.
        let code = "globalThis.registered = this;";
        for res in [
            transform_file("side-effect.mjs", code).unwrap(),
            transform_file_as("side-effect.js", code, SourceKind::of("side-effect.js", Some("module"))).unwrap(),
        ] {
            assert!(res.content.contains("void 0"), "{}", res.content);
        }
        let script = transform_file("side-effect.js", code).unwrap();
        assert!(script.content.contains("=this"), "{}", script.content);
        // `.cjs` is CommonJS even where ES syntax would parse.
        assert!(transform_file("a.cjs", "export default 1;").is_err());
    }

    #[test]
    fn es_module_bindings_named_require_or_exports_are_renamed() {
        // `import { createRequire } from 'module'; const require = createRequire(import.meta.url)`
        // is how an ES module gets a require in Node. As CommonJS it must not
        // redeclare the `require` and `exports` of the function it runs in.
        let res = transform_file(
            "index.js",
            "import { createRequire } from 'module'; const require = createRequire(import.meta.url); const exports = 2; export default [require, exports];",
        )
        .unwrap();
        for declared in ["const require=", "exports=2"] {
            assert!(!res.content.contains(declared), "{}", res.content);
        }
        assert!(res.content.contains("require(\"module\")"), "{}", res.content);
    }

    #[test]
    fn import_meta_is_the_bundlers_object() {
        let res = transform_file(
            "index.js",
            "export const wasm = new URL('./a.wasm', import.meta.url).href; export const dev = import.meta.env?.DEV;",
        )
        .unwrap();
        assert!(res.content.contains("$ir_import_meta.url"), "{}", res.content);
        assert!(res.content.contains("$ir_import_meta.env"), "{}", res.content);
        assert!(!res.content.contains("import.meta"), "{}", res.content);
        assert!(!res.content.contains("__filename"), "{}", res.content);
        assert!(res.dependencies.is_empty(), "{:?}", res.dependencies);
    }

    #[test]
    fn collects_conditional_require_deps() {
        let code = "'use strict';\n\nif (process.env.NODE_ENV === 'production') {\n  module.exports = require('./cjs/react.production.min.js');\n} else {\n  module.exports = require('./cjs/react.development.js');\n}\n";
        let res = transform_file("index.js", code).unwrap();
        println!("CONTENT >>>{}<<<", res.content);
        println!("DEPS >>>{:?}<<<", res.dependencies);
        assert!(
            res.dependencies.contains("./cjs/react.development.js"),
            "expected development require to be collected, got {:?}",
            res.dependencies
        );
    }

    #[test]
    fn remove_sourcemap_comment() {
        // TODO: Allow inline sourcemaps?
        assert_eq!(
            transform_file(
                "index.js",
                "module.exports = \"hello world\";\n//other-comment\n//# sourceMappingURL=index.js.map"
            )
            .unwrap()
            .content,
            String::from("module.exports=\"hello world\";//other-comment\n")
        );
    }

    #[test]
    fn esm_star_import_inlines_interop_helpers() {
        let res = transform_file(
            "index.js",
            "import * as icons from './icons.js';\nexport default icons;\n",
        )
        .unwrap();
        assert!(
            !res.content.contains("import "),
            "expected no residual ESM import, got {}",
            res.content
        );
        assert!(
            !res.content.contains("@swc/helpers"),
            "helpers must be inlined, not external: {}",
            res.content
        );
        assert!(
            res.dependencies.iter().all(|d| !d.starts_with("@swc/helpers")),
            "expected no @swc/helpers dep edge, got {:?}",
            res.dependencies
        );
        if res.content.contains("_interop_require_wildcard") {
            assert!(
                res.content.contains("function _interop_require_wildcard"),
                "helper call without inlined definition: {}",
                res.content
            );
        }
    }

}

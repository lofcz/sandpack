use swc_core::ecma::ast::{
    ArrowExpr, AwaitExpr, BindingIdent, CallExpr, Callee, ClassDecl, ClassExpr, Decorator, Expr,
    FnDecl, FnExpr, ForOfStmt, Function, Lit, MetaPropExpr, MetaPropKind, ModuleDecl,
};
use swc_core::ecma::visit::{Visit, VisitWith};

/// What the bundler has to know about a transformed file to run it as it is.
///
/// The bundler evaluates a file as the body of a CommonJS function and links
/// its `require("…")` calls beforehand. Without this it parses every file it
/// downloads a second time to find out the same thing.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ModuleScan {
    /// Every specifier a `require("…")` call names, once each, in source order.
    pub requires: Vec<String>,
    /// The file cannot be evaluated as it is and linked from `requires`: it
    /// still holds module syntax, a top-level `await`, a decorator, a
    /// `require` whose argument is not a string, or its own binding named
    /// `require` (a bundled loader), whose calls are not this file's imports.
    pub needs_compiler: bool,
}

/// Scans the program that is printed, so the answer is about the code the
/// bundler receives.
pub fn scan_module<N: VisitWith<ModuleScanner>>(program: &N) -> ModuleScan {
    let mut scanner = ModuleScanner::default();
    program.visit_with(&mut scanner);
    scanner.scan
}

#[derive(Default)]
pub struct ModuleScanner {
    scan: ModuleScan,
    function_depth: usize,
}

impl ModuleScanner {
    fn binds(&mut self, name: &str) {
        if name == "require" {
            self.scan.needs_compiler = true;
        }
    }
}

impl Visit for ModuleScanner {
    fn visit_module_decl(&mut self, node: &ModuleDecl) {
        self.scan.needs_compiler = true;
        node.visit_children_with(self);
    }

    fn visit_meta_prop_expr(&mut self, node: &MetaPropExpr) {
        if node.kind == MetaPropKind::ImportMeta {
            self.scan.needs_compiler = true;
        }
    }

    fn visit_decorator(&mut self, node: &Decorator) {
        self.scan.needs_compiler = true;
        node.visit_children_with(self);
    }

    fn visit_function(&mut self, node: &Function) {
        self.function_depth += 1;
        node.visit_children_with(self);
        self.function_depth -= 1;
    }

    fn visit_arrow_expr(&mut self, node: &ArrowExpr) {
        self.function_depth += 1;
        node.visit_children_with(self);
        self.function_depth -= 1;
    }

    fn visit_await_expr(&mut self, node: &AwaitExpr) {
        if self.function_depth == 0 {
            self.scan.needs_compiler = true;
        }
        node.visit_children_with(self);
    }

    fn visit_for_of_stmt(&mut self, node: &ForOfStmt) {
        if node.is_await && self.function_depth == 0 {
            self.scan.needs_compiler = true;
        }
        node.visit_children_with(self);
    }

    fn visit_binding_ident(&mut self, node: &BindingIdent) {
        self.binds(node.id.sym.as_str());
    }

    fn visit_fn_decl(&mut self, node: &FnDecl) {
        self.binds(node.ident.sym.as_str());
        node.visit_children_with(self);
    }

    fn visit_fn_expr(&mut self, node: &FnExpr) {
        if let Some(ident) = &node.ident {
            self.binds(ident.sym.as_str());
        }
        node.visit_children_with(self);
    }

    fn visit_class_decl(&mut self, node: &ClassDecl) {
        self.binds(node.ident.sym.as_str());
        node.visit_children_with(self);
    }

    fn visit_class_expr(&mut self, node: &ClassExpr) {
        if let Some(ident) = &node.ident {
            self.binds(ident.sym.as_str());
        }
        node.visit_children_with(self);
    }

    fn visit_call_expr(&mut self, node: &CallExpr) {
        match &node.callee {
            Callee::Import(_) => self.scan.needs_compiler = true,
            Callee::Expr(callee) => {
                if let Expr::Ident(ident) = &**callee {
                    if ident.sym.as_str() == "require" {
                        match node.args.first() {
                            Some(arg) if arg.spread.is_none() => match &*arg.expr {
                                Expr::Lit(Lit::Str(specifier)) => {
                                    let specifier = specifier.value.to_atom_lossy().to_string();
                                    if !self.scan.requires.contains(&specifier) {
                                        self.scan.requires.push(specifier);
                                    }
                                }
                                _ => self.scan.needs_compiler = true,
                            },
                            _ => self.scan.needs_compiler = true,
                        }
                    }
                }
            }
            _ => {}
        }
        node.visit_children_with(self);
    }
}

#[cfg(test)]
mod tests {
    use crate::transform::transformer::transform_file;

    fn scan(filename: &str, code: &str) -> (Vec<String>, bool) {
        let scan = transform_file(filename, code).unwrap().scan;
        (scan.requires, scan.needs_compiler)
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn lists_each_required_specifier_once_in_source_order() {
        let (requires, needs_compiler) = scan(
            "index.js",
            "var b = require('./b.js'); var fs = require('node:fs'); module.exports = [b, require('a'), require('./b.js'), fs];",
        );
        assert_eq!(requires, strings(&["./b.js", "node:fs", "a"]));
        assert!(!needs_compiler);
    }

    #[test]
    fn an_es_module_is_scanned_as_the_commonjs_it_became() {
        let (requires, needs_compiler) = scan(
            "index.mjs",
            "import a from 'a'; export * from './b.js'; export const load = () => import('./lazy.js'); export default a;",
        );
        assert_eq!(requires, strings(&["a", "./b.js", "./lazy.js"]));
        assert!(!needs_compiler);
    }

    #[test]
    fn a_require_that_is_not_a_string_needs_the_compiler() {
        for code in [
            "module.exports = function (name) { return require(name); };",
            "module.exports = require('./locale/' + process.platform);",
            "module.exports = require();",
        ] {
            assert!(scan("index.js", code).1, "{code}");
        }
    }

    #[test]
    fn a_file_with_its_own_require_needs_the_compiler() {
        // A bundle carrying its own loader: these calls are not the file's imports.
        for code in [
            "(function (require) { require('./inner'); })(function () {});",
            "function require(id) { return {}; } module.exports = require('x');",
            "var require = window.loader; module.exports = require('x');",
            "try { run(); } catch (require) {}",
        ] {
            assert!(scan("index.js", code).1, "{code}");
        }
    }

    #[test]
    fn an_es_module_that_declares_require_was_renamed_and_runs_as_it_is() {
        let (requires, needs_compiler) = scan(
            "index.js",
            "import { createRequire } from 'module'; const require = createRequire('/'); export default require;",
        );
        assert_eq!(requires, strings(&["module"]));
        assert!(!needs_compiler);
    }

    #[test]
    fn a_top_level_await_needs_the_compiler() {
        assert!(scan("index.mjs", "const data = await fetch('/data'); export default data;").1);
        assert!(scan("index.mjs", "for await (const part of parts) use(part); export {};").1);
        assert!(!scan("index.mjs", "export default async function load() { return await fetch('/data'); }").1);
        assert!(!scan("index.mjs", "export const load = async () => { for await (const part of parts) use(part); };").1);
    }
}

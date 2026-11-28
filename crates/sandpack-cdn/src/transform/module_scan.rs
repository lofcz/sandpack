use swc_core::ecma::ast::{
    ArrowExpr, AwaitExpr, CallExpr, Callee, CatchClause, ClassDecl, ClassExpr, Constructor,
    Decorator, Expr, ExprOrSpread, FnDecl, FnExpr, ForOfStmt, Function, Lit, MetaPropExpr,
    MetaPropKind, ModuleDecl, ObjectPatProp, OptCall, ParamOrTsParamProp, Pat, UsingDecl,
    VarDecl, VarDeclKind,
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
    /// `require` whose argument is not a string, or a declaration of
    /// `require` that the function scope does not decide (see below).
    pub needs_compiler: bool,
}

/// Scans the program that is printed, so the answer is about the code the
/// bundler receives.
///
/// Whose `require` a call is: a bundle that carries its own loader
/// (browserify, a UMD wrapper) calls a `require` that one of its functions
/// declares, as a parameter or a `var`. Those calls name no import of the
/// file. Only a call that reaches the `require` the file is given counts. A
/// declaration that covers part of a function (`let`, `const`, `class`, a
/// `catch` parameter) or sits at the top level, where the file's own
/// `require` lives, is left to the compiler. The bundler's scan.ts decides
/// the same way for the files it gets from elsewhere; keep the two in step.
pub fn scan_module<N: VisitWith<ModuleScanner>>(program: &N) -> ModuleScan {
    let mut scanner = ModuleScanner::new();
    program.visit_with(&mut scanner);
    scanner.finish()
}

const REQUIRE: &str = "require";

fn binds_require(pat: &Pat) -> bool {
    match pat {
        Pat::Ident(binding) => binding.id.sym.as_str() == REQUIRE,
        Pat::Array(array) => array.elems.iter().flatten().any(binds_require),
        Pat::Rest(rest) => binds_require(&rest.arg),
        Pat::Object(object) => object.props.iter().any(|prop| match prop {
            ObjectPatProp::KeyValue(key_value) => binds_require(&key_value.value),
            ObjectPatProp::Assign(assign) => assign.key.id.sym.as_str() == REQUIRE,
            ObjectPatProp::Rest(rest) => binds_require(&rest.arg),
        }),
        Pat::Assign(assign) => binds_require(&assign.left),
        _ => false,
    }
}

pub struct ModuleScanner {
    needs_compiler: bool,
    /// Functions around the node being visited, for top-level `await`.
    function_depth: usize,
    /// Function scopes, the top level being 0: the scope each is written in,
    /// whether it declares `require` for all of its body, and whether it
    /// holds a declaration of `require` that covers only part of it.
    parent: Vec<usize>,
    declares: Vec<bool>,
    partly: Vec<bool>,
    scope: usize,
    /// The name of the function expression about to be entered is `require`.
    named_require: bool,
    /// `require(…)` calls: the scope each is in, and its specifier when the
    /// argument is a string.
    calls: Vec<(usize, Option<String>)>,
}

impl ModuleScanner {
    fn new() -> Self {
        ModuleScanner {
            needs_compiler: false,
            function_depth: 0,
            parent: vec![0],
            declares: vec![false],
            partly: vec![false],
            scope: 0,
            named_require: false,
            calls: vec![],
        }
    }

    /// Is `require`, read in `scope`, one a function around it declares?
    fn own(&self, mut scope: usize) -> bool {
        while scope > 0 {
            if self.declares[scope] {
                return true;
            }
            scope = self.parent[scope];
        }
        false
    }

    fn finish(self) -> ModuleScan {
        let mut needs_compiler = self.needs_compiler || self.declares[0] || self.partly[0];
        for scope in 1..self.partly.len() {
            if self.partly[scope] && !self.own(scope) {
                needs_compiler = true;
            }
        }
        let mut requires: Vec<String> = vec![];
        for (scope, specifier) in &self.calls {
            if self.own(*scope) {
                continue;
            }
            match specifier {
                Some(specifier) => {
                    if !requires.contains(specifier) {
                        requires.push(specifier.clone());
                    }
                }
                None => needs_compiler = true,
            }
        }
        ModuleScan { requires, needs_compiler }
    }

    /// Visits a function's children in a scope of its own.
    fn in_function<N: VisitWith<Self>>(&mut self, declares: bool, node: &N) {
        let outer = self.scope;
        self.parent.push(outer);
        self.declares.push(declares);
        self.partly.push(false);
        self.scope = self.parent.len() - 1;
        self.function_depth += 1;
        node.visit_children_with(self);
        self.function_depth -= 1;
        self.scope = outer;
    }

    fn call(&mut self, callee: &Expr, args: &[ExprOrSpread]) {
        let mut callee = callee;
        while let Expr::Paren(paren) = callee {
            callee = &paren.expr;
        }
        let Expr::Ident(ident) = callee else {
            return;
        };
        if ident.sym.as_str() != REQUIRE {
            return;
        }
        let specifier = match args.first() {
            Some(arg) if arg.spread.is_none() => match &*arg.expr {
                Expr::Lit(Lit::Str(specifier)) => Some(specifier.value.to_atom_lossy().to_string()),
                _ => None,
            },
            _ => None,
        };
        self.calls.push((self.scope, specifier));
    }
}

impl Visit for ModuleScanner {
    fn visit_module_decl(&mut self, node: &ModuleDecl) {
        self.needs_compiler = true;
        node.visit_children_with(self);
    }

    fn visit_meta_prop_expr(&mut self, node: &MetaPropExpr) {
        if node.kind == MetaPropKind::ImportMeta {
            self.needs_compiler = true;
        }
    }

    fn visit_decorator(&mut self, node: &Decorator) {
        self.needs_compiler = true;
        node.visit_children_with(self);
    }

    fn visit_await_expr(&mut self, node: &AwaitExpr) {
        if self.function_depth == 0 {
            self.needs_compiler = true;
        }
        node.visit_children_with(self);
    }

    fn visit_for_of_stmt(&mut self, node: &ForOfStmt) {
        if node.is_await && self.function_depth == 0 {
            self.needs_compiler = true;
        }
        node.visit_children_with(self);
    }

    fn visit_fn_decl(&mut self, node: &FnDecl) {
        // A declaration's name belongs to the scope it is written in.
        if node.ident.sym.as_str() == REQUIRE {
            self.declares[self.scope] = true;
        }
        node.visit_children_with(self);
    }

    fn visit_fn_expr(&mut self, node: &FnExpr) {
        self.named_require = node.ident.as_ref().is_some_and(|ident| ident.sym.as_str() == REQUIRE);
        node.visit_children_with(self);
        self.named_require = false;
    }

    fn visit_function(&mut self, node: &Function) {
        let declares = std::mem::take(&mut self.named_require)
            || node.params.iter().any(|param| binds_require(&param.pat));
        self.in_function(declares, node);
    }

    fn visit_arrow_expr(&mut self, node: &ArrowExpr) {
        self.named_require = false;
        self.in_function(node.params.iter().any(binds_require), node);
    }

    fn visit_constructor(&mut self, node: &Constructor) {
        self.named_require = false;
        let declares = node.params.iter().any(|param| match param {
            ParamOrTsParamProp::Param(param) => binds_require(&param.pat),
            _ => false,
        });
        self.in_function(declares, node);
    }

    fn visit_var_decl(&mut self, node: &VarDecl) {
        if node.decls.iter().any(|declarator| binds_require(&declarator.name)) {
            if node.kind == VarDeclKind::Var {
                self.declares[self.scope] = true;
            } else {
                self.partly[self.scope] = true;
            }
        }
        node.visit_children_with(self);
    }

    fn visit_using_decl(&mut self, node: &UsingDecl) {
        if node.decls.iter().any(|declarator| binds_require(&declarator.name)) {
            self.partly[self.scope] = true;
        }
        node.visit_children_with(self);
    }

    fn visit_catch_clause(&mut self, node: &CatchClause) {
        if node.param.as_ref().is_some_and(binds_require) {
            self.partly[self.scope] = true;
        }
        node.visit_children_with(self);
    }

    fn visit_class_decl(&mut self, node: &ClassDecl) {
        if node.ident.sym.as_str() == REQUIRE {
            self.partly[self.scope] = true;
        }
        node.visit_children_with(self);
    }

    fn visit_class_expr(&mut self, node: &ClassExpr) {
        self.named_require = false;
        if node.ident.as_ref().is_some_and(|ident| ident.sym.as_str() == REQUIRE) {
            self.partly[self.scope] = true;
        }
        node.visit_children_with(self);
    }

    fn visit_call_expr(&mut self, node: &CallExpr) {
        match &node.callee {
            Callee::Import(_) => self.needs_compiler = true,
            Callee::Expr(callee) => self.call(callee, &node.args),
            _ => {}
        }
        node.visit_children_with(self);
    }

    fn visit_opt_call(&mut self, node: &OptCall) {
        self.call(&node.callee, &node.args);
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

    // elkjs/lib/elk.bundled.js (1.6 MB, a browserify bundle) went through the
    // bundler's whole compiler because its loader has a parameter named `require`.
    #[test]
    fn the_require_a_bundle_declares_for_itself_is_the_bundles() {
        for code in [
            "(function (require) { require('./inner'); })(function () {});",
            "function loader({ require }) { return require('local'); } module.exports = loader;",
            "(function () { var require = window.amd; return function () { return require(name); }; })();",
            "(function () { use(require('inner')); function require(id) { return registry[id]; } })();",
            "var load = function require(id) { return require(id + '/index'); };",
            "var load = (require) => (id) => require(id);",
            "(function e(t,n,r){function s(o,u){if(!n[o]){var a=typeof require==\"function\"&&require;if(!u&&a)return a(o,!0);}return n[o].exports}for(var i=typeof require==\"function\"&&require,o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){module.exports=require(\"./lib/b\")},{\"./lib/b\":2}],2:[function(require,module,exports){module.exports=require(name)},{}]},{},[1]);",
        ] {
            assert_eq!(scan("index.js", code), (vec![], false), "{code}");
        }
    }

    #[test]
    fn calls_that_reach_the_require_the_file_is_given_still_count() {
        let umd = "(function (root, factory) { if (typeof module === 'object') module.exports = factory(require('react')); else root.Lib = factory(root.React); })(this, function (React) { function inner(require) { return require('own'); } return { inner: inner, dom: require('react-dom') }; });";
        assert_eq!(scan("index.js", umd), (strings(&["react", "react-dom"]), false));
        assert!(scan("index.js", "(function (require) { require('own'); })(load); module.exports = require(name);").1);
        assert_eq!(
            scan("index.js", "(function (require) { require('own'); })(load); module.exports = require?.('dep');"),
            (strings(&["dep"]), false)
        );
    }

    #[test]
    fn a_require_declared_where_the_function_scope_does_not_decide_needs_the_compiler() {
        for code in [
            // At the top level it is the file's own require that is redeclared.
            "var require = window.loader; module.exports = require('x');",
            "function require(id) { return {}; } module.exports = require('x');",
            // Block-scoped: bound in part of the function only.
            "function f() { try { run(); } catch (require) { require('own'); } } module.exports = f;",
            "function f() { class require {} } module.exports = f;",
        ] {
            assert!(scan("index.js", code).1, "{code}");
        }
        // ... unless a function around it declares require anyway.
        assert_eq!(
            scan("index.js", "function f(require) { { let require = 1; } return require('own'); } module.exports = f;"),
            (vec![], false)
        );
        // Where both are read in one function, the printed program names them apart.
        assert_eq!(
            scan("index.js", "function f() { if (amd) { const require = amd.require; require('own'); } return require('dep'); } module.exports = f;"),
            (strings(&["dep"]), false)
        );
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
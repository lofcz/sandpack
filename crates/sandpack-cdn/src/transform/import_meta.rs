use swc_core::common::SyntaxContext;
use swc_core::ecma::ast::{Expr, Ident, MetaPropExpr, MetaPropKind};
use swc_core::ecma::visit::{VisitMut, VisitMutWith};

/// The name the bundler gives every module's `import.meta` object (the
/// transpiler's `IMPORT_META_GLOBAL`): a module-only syntax cannot stay in code
/// that is evaluated as a function body.
pub const IMPORT_META_GLOBAL: &str = "$ir_import_meta";

/// Rewrites `import.meta` to the `IMPORT_META_GLOBAL` identifier.
pub struct ImportMetaReplacer {
    pub unresolved_ctxt: SyntaxContext,
}

impl VisitMut for ImportMetaReplacer {
    fn visit_mut_expr(&mut self, node: &mut Expr) {
        node.visit_mut_children_with(self);

        if let Expr::MetaProp(MetaPropExpr {
            kind: MetaPropKind::ImportMeta,
            span,
        }) = node
        {
            *node = Expr::Ident(Ident::new(
                IMPORT_META_GLOBAL.into(),
                *span,
                self.unresolved_ctxt,
            ));
        }
    }
}

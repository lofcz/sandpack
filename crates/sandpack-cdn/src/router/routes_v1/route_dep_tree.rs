use std::collections::{BTreeSet, HashMap};

use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use crate::app_error::ServerError;
use crate::npm_replicator::database::NpmDatabase;
use crate::package::cached::CachedPackageProcessor;
use crate::package::collect_dep_tree::{collect_dep_tree, process_dep_map, process_pins, DependencyList};
use crate::router::routes::AppState;

use super::super::custom_reply::CustomReply;
use super::super::error_reply::ErrorReply;
use super::super::utils::{decode_req_part, LATEST_VERSION};

/// `deps` are the packages to resolve (the ones the app imports) and
/// `entries` what it imports from each (`.`, `./client`, …; `.` when absent);
/// `pins` fix the range of a name wherever it appears in the tree (the app's
/// declared map).
#[derive(Deserialize)]
struct DepTreeQuery {
    deps: HashMap<String, String>,
    #[serde(default)]
    pins: HashMap<String, String>,
    #[serde(default)]
    entries: HashMap<String, BTreeSet<String>>,
}

async fn process_dep_tree(
    decoded_query: &str,
    npm_db: &NpmDatabase,
    pkg_processor: &CachedPackageProcessor,
) -> Result<DependencyList, ServerError> {
    let mut query: DepTreeQuery = serde_json::from_str(decoded_query)?;
    let dep_requests = process_dep_map(query.deps, 0)?
        .into_iter()
        .map(|request| match query.entries.remove(request.name()) {
            Some(entries) if !entries.is_empty() => request.with_entries(entries),
            _ => request,
        })
        .collect();
    let pins = process_pins(query.pins)?;
    collect_dep_tree(dep_requests, pins, npm_db, pkg_processor).await
}

pub async fn get_dep_tree_reply(
    path: String,
    npm_db: NpmDatabase,
    pkg_processor: CachedPackageProcessor,
) -> Result<CustomReply, ServerError> {
    let (version, decoded_query) = decode_req_part(&path)?;
    // The `{ deps, pins, entries }` query exists only in the current protocol.
    if version != LATEST_VERSION {
        return Err(ServerError::InvalidCDNVersion);
    }

    let tree = process_dep_tree(&decoded_query, &npm_db, &pkg_processor).await?;
    let mut reply = CustomReply::msgpack(&tree)?;
    let cache_ttl = 15 * 60;
    reply.add_header(
        "Cache-Control",
        format!("public, max-age={}", cache_ttl).as_str(),
    );
    reply.add_header(
        "CDN-Cache-Control",
        format!("max-age={}", cache_ttl).as_str(),
    );
    Ok(reply)
}

pub async fn dep_tree_handler(State(state): State<AppState>, Path(path): Path<String>) -> Response {
    match get_dep_tree_reply(path, state.npm_db, state.pkg_processor).await {
        Ok(reply) => reply.into_response(),
        Err(err) => ErrorReply::from(err).respond(),
    }
}

/// Body transport avoids HTTP proxy limits on encoded path segments. Keep the
/// same versioned payload and resolve the complete dependency graph in one pass.
pub async fn dep_tree_post_handler(State(state): State<AppState>, body: String) -> Response {
    match get_dep_tree_reply(body, state.npm_db, state.pkg_processor).await {
        Ok(mut reply) => {
            reply.add_header("Cache-Control", "no-store");
            reply.add_header("CDN-Cache-Control", "no-store");
            reply.into_response()
        }
        Err(err) => ErrorReply::from(err).respond(),
    }
}

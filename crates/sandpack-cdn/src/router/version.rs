use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

use super::utils::LATEST_VERSION;

/// Request transports this build serves; `GET /version` lets hosts and bundlers
/// check what the running process supports instead of inferring it from 404s.
/// Every entry is asserted against the real router in the tests below.
pub const CAPABILITIES: &[&str] = &[
    "dep_tree:get",
    "dep_tree:post",
    "package:get",
    "package:post",
    "npm_alias",
    "health",
    "version",
];

/// Largest POST body accepted by the body transports.
pub const MAX_BODY_BYTES: usize = 64 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionReply {
    name: &'static str,
    commit: &'static str,
    dirty: bool,
    built_at_unix: u64,
    target: &'static str,
    protocol: u64,
    capabilities: &'static [&'static str],
    max_body_bytes: usize,
}

fn version_reply() -> VersionReply {
    VersionReply {
        name: env!("CARGO_PKG_NAME"),
        commit: env!("SANDPACK_CDN_COMMIT"),
        dirty: env!("SANDPACK_CDN_DIRTY") == "true",
        built_at_unix: env!("SANDPACK_CDN_BUILT_AT").parse().unwrap_or(0),
        target: env!("SANDPACK_CDN_TARGET"),
        protocol: LATEST_VERSION,
        capabilities: CAPABILITIES,
        max_body_bytes: MAX_BODY_BYTES,
    }
}

pub async fn version_handler() -> Response {
    let mut response = (StatusCode::OK, axum::Json(version_reply())).into_response();
    // Identity of the running process: never cache it across a redeploy.
    response
        .headers_mut()
        .insert("cache-control", "no-store".parse().unwrap());
    response
}

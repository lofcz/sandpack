use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use crate::app_error::ServerError;
use crate::package::cached::CachedPackageProcessor;
use crate::package::entries::{entry_module, listing};
use crate::package::process::parse_package_specifier;
use crate::router::routes::AppState;

use super::super::custom_reply::CustomReply;
use super::super::error_reply::ErrorReply;
use super::super::utils::{decode_req_part, LATEST_VERSION};

/// One package release, and either one entry's closure (`entry`: `.`,
/// `./client`, …) or, with no entry, its file listing. Each is its own
/// immutable response, so the bundler caches entries independently.
#[derive(Deserialize)]
struct PackageQuery {
    name: String,
    version: String,
    #[serde(default)]
    entry: Option<String>,
}

pub async fn get_package_data_reply(
    path: String,
    pkg_processor: &CachedPackageProcessor,
) -> Result<CustomReply, ServerError> {
    let (version, decoded_query) = decode_req_part(path.as_str())?;
    if version != LATEST_VERSION {
        return Err(ServerError::InvalidCDNVersion);
    }
    let query: PackageQuery = serde_json::from_str(&decoded_query)?;
    // Validates the name and the exact version.
    let (pkg_name, pkg_version) = parse_package_specifier(&format!("{}@{}", query.name, query.version))?;
    let package_content = pkg_processor.get(&pkg_name, &pkg_version).await?;
    let module = match &query.entry {
        Some(entry) => entry_module(&pkg_name, &package_content.0, entry),
        None => listing(&package_content.0),
    };
    let mut reply = CustomReply::msgpack(&module)?;
    let cache_ttl = 365 * 24 * 3600;
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

pub async fn package_data_handler(
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Response {
    match get_package_data_reply(path, &state.pkg_processor).await {
        Ok(reply) => reply.into_response(),
        Err(err) => ErrorReply::from(err).respond(),
    }
}

pub async fn package_data_post_handler(State(state): State<AppState>, body: String) -> Response {
    match get_package_data_reply(body, &state.pkg_processor).await {
        Ok(mut reply) => {
            reply.add_header("Cache-Control", "no-store");
            reply.add_header("CDN-Cache-Control", "no-store");
            reply.into_response()
        }
        Err(err) => ErrorReply::from(err).respond(),
    }
}

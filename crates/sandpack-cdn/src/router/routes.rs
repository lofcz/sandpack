use axum::extract::DefaultBodyLimit;
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;

use crate::npm::package_content::PackageContentFetcher;
use crate::npm_replicator::database::NpmDatabase;
use crate::package::cached::CachedPackageProcessor;
use crate::AppConfig;

use super::error_reply::ErrorReply;
use super::health::health_handler;
use super::routes_v1::route_dep_tree::{dep_tree_handler, dep_tree_post_handler};
use super::routes_v1::route_package_data::{package_data_handler, package_data_post_handler};

/// Shared state handed to every route handler. Cheap to clone (everything inside
/// is `Arc`-backed), so axum can clone it per request.
#[derive(Clone)]
pub struct AppState {
    pub npm_db: NpmDatabase,
    pub pkg_processor: CachedPackageProcessor,
}

pub fn routes(npm_db: NpmDatabase, app_data: AppConfig) -> Router {
    let pkg_content_fetcher = PackageContentFetcher::new();
    let pkg_processor = CachedPackageProcessor::new(
        npm_db.clone(),
        pkg_content_fetcher,
        &app_data.temp_dir,
        app_data.package_cache_dir,
    );

    let state = AppState {
        npm_db,
        pkg_processor,
    };

    Router::new()
        .route("/package/{path}", get(package_data_handler))
        .route("/dep_tree/{path}", get(dep_tree_handler))
        .route("/dep_tree", post(dep_tree_post_handler))
        .route("/package", post(package_data_post_handler))
        .route("/health", get(health_handler))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .fallback(not_found_handler)
        .with_state(state)
}

async fn not_found_handler() -> Response {
    ErrorReply::new(404, "Not found".to_string(), "Not found".to_string()).respond()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn body_transport_matches_legacy_and_bounds_input() {
        let dir = std::env::temp_dir().join(format!("sandpack-transport-{}", nanoid::nanoid!()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = NpmDatabase::new(dir.join("npm.sqlite").to_str().unwrap()).unwrap();
        db.init().unwrap();
        let app = routes(
            db,
            AppConfig {
                temp_dir: dir.join("tmp").to_str().unwrap().to_string(),
                package_cache_dir: dir.join("cache"),
            },
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = reqwest::Client::new();
        let legacy = base64_simd::STANDARD.encode_to_string(b"5({})");
        let get = client
            .get(format!("{base}/dep_tree/{legacy}"))
            .send()
            .await
            .unwrap();
        assert_eq!(get.status(), 200);
        let expected = get.bytes().await.unwrap();
        let large = base64_simd::STANDARD
            .encode_to_string(format!("5({{{}}})", " ".repeat(1000)).as_bytes());
        assert!(large.len() > 260);
        let post = client
            .post(format!("{base}/dep_tree"))
            .header("Content-Type", "text/plain")
            .body(large)
            .send()
            .await
            .unwrap();
        assert_eq!(post.status(), 200);
        assert_eq!(post.headers()["cache-control"], "no-store");
        assert_eq!(post.bytes().await.unwrap(), expected);
        for endpoint in ["dep_tree", "package"] {
            let invalid = client
                .post(format!("{base}/{endpoint}"))
                .body("!!!")
                .send()
                .await
                .unwrap();
            assert_eq!(invalid.status(), 400);
            let oversized = client
                .post(format!("{base}/{endpoint}"))
                .body("A".repeat(64 * 1024 + 1))
                .send()
                .await
                .unwrap();
            assert_eq!(oversized.status(), 413);
        }
        server.abort();
        let _ = server.await;
        std::fs::remove_dir_all(dir).unwrap();
    }
}

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
use super::version::{version_handler, MAX_BODY_BYTES};
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
        .route("/version", get(version_handler))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
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
    async fn version_reports_build_and_every_advertised_route_exists() {
        let dir = std::env::temp_dir().join(format!("sandpack-version-{}", nanoid::nanoid!()));
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

        let reply = client.get(format!("{base}/version")).send().await.unwrap();
        assert_eq!(reply.status(), 200);
        assert_eq!(reply.headers()["cache-control"], "no-store");
        let body: serde_json::Value = reply.json().await.unwrap();
        assert_eq!(body["name"], "sandpack-cdn");
        assert_eq!(body["protocol"], 6);
        assert_eq!(body["maxBodyBytes"], 64 * 1024);
        assert!(!body["commit"].as_str().unwrap().is_empty());
        let advertised: Vec<&str> = body["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect();
        assert_eq!(advertised, crate::router::version::CAPABILITIES);

        // The router's own not-found reply means a transport is missing; a 400 for
        // an invalid payload proves the route exists.
        let empty = base64_simd::STANDARD.encode_to_string(br#"6({"deps":{}})"#);
        for capability in crate::router::version::CAPABILITIES {
            let request = match *capability {
                "dep_tree:get" => client.get(format!("{base}/dep_tree/{empty}")),
                "dep_tree:post" => client.post(format!("{base}/dep_tree")).body(empty.clone()),
                "package:get" => client.get(format!("{base}/package/!!!")),
                "package:post" => client.post(format!("{base}/package")).body("!!!"),
                "health" => client.get(format!("{base}/health")),
                "version" => client.get(format!("{base}/version")),
                "npm_alias" => continue,
                other => panic!("capability {other} has no route check"),
            };
            let response = request.send().await.unwrap();
            assert_ne!(response.status(), 404, "{capability} is not routed");
            assert!(response.status().as_u16() < 500, "{capability} failed");
        }
        server.abort();
        let _ = server.await;
        std::fs::remove_dir_all(dir).unwrap();
    }

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
        let legacy = base64_simd::STANDARD.encode_to_string(br#"6({"deps":{}})"#);
        let get = client
            .get(format!("{base}/dep_tree/{legacy}"))
            .send()
            .await
            .unwrap();
        assert_eq!(get.status(), 200);
        let expected = get.bytes().await.unwrap();
        // The `{ deps, pins }` query is v6-only; an older protocol is refused.
        let outdated = base64_simd::STANDARD.encode_to_string(b"5({})");
        let rejected = client
            .get(format!("{base}/dep_tree/{outdated}"))
            .send()
            .await
            .unwrap();
        assert_eq!(rejected.status(), 400);
        let large = base64_simd::STANDARD
            .encode_to_string(format!("6({{\"deps\":{{}}{}}})", " ".repeat(1000)).as_bytes());
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

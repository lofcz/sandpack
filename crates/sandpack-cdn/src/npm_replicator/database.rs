use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use lru::LruCache;
use parking_lot::Mutex;
use rusqlite::{named_params, Connection, OpenFlags, OptionalExtension};

use crate::app_error::{AppResult, ServerError};

use super::types::document::{MinimalPackageData, RegistryDocument};

/// Shared client for on-demand npm registry lookups. We fetch package
/// manifests lazily (only the packages users actually import) instead of
/// replicating the entire npm registry.
static NPM_HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent("sandpack-cdn")
        .build()
        .expect("failed to build npm registry http client")
});

const NPM_REGISTRY_URL: &str = "https://registry.npmjs.org";

/// A stored manifest is re-downloaded at most this often, however many
/// requests miss a version in it (a never-published version must not turn
/// every request into a registry round trip).
const MIN_REFRESH_INTERVAL: Duration = Duration::from_secs(60);

/// Manifests older than this are refreshed before a dist-tag (`latest`) or a
/// range is resolved, so a stored packument does not pin `latest` forever.
pub const MANIFEST_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Clone, Debug)]
pub struct NpmDatabase {
    db: Arc<Mutex<Connection>>,
    cache: Arc<Mutex<LruCache<String, MinimalPackageData>>>,
    /// Last on-demand refresh per package (process lifetime), see `refresh_package`.
    refreshed: Arc<Mutex<HashMap<String, Instant>>>,
}

impl NpmDatabase {
    pub fn new(db_path: &str) -> AppResult<Self> {
        let connection = Connection::open_with_flags(
            db_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_URI,
        )?;
        let cache = LruCache::new(NonZeroUsize::new(500).unwrap());

        Ok(Self {
            db: Arc::new(Mutex::new(connection)),
            cache: Arc::new(Mutex::new(cache)),
            refreshed: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn init(&self) -> AppResult<()> {
        let connection = self.db.lock();

        connection.execute(
            "CREATE TABLE IF NOT EXISTS package (
                id    TEXT PRIMARY KEY,
                content  TEXT NOT NULL
            );",
            (),
        )?;
        // Databases written before manifests carried a timestamp: NULL means
        // "age unknown", which `ensure_fresh_package` treats as stale once.
        let has_fetched_at = {
            let mut stmt = connection.prepare("PRAGMA table_info(package);")?;
            let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
            let found = columns.filter_map(Result::ok).any(|name| name == "fetched_at");
            found
        };
        if !has_fetched_at {
            connection.execute("ALTER TABLE package ADD COLUMN fetched_at INTEGER;", ())?;
        }

        Ok(())
    }

    pub fn delete_package(&self, name: &str) -> AppResult<usize> {
        let connection = self.db.lock();
        let mut stmt = connection.prepare("DELETE FROM package WHERE id = (:id);")?;
        let res = stmt.execute(named_params! { ":id": name })?;
        let mut cache = self.cache.lock();
        cache.pop(name);
        Ok(res)
    }

    pub fn write_package(&self, pkg: MinimalPackageData) -> AppResult<usize> {
        if pkg.versions.is_empty() {
            println!("Tried to write pkg {}, but has no versions", pkg.name);
            return self.delete_package(&pkg.name);
        }

        let pkg_name = pkg.name.clone();
        let content = serde_json::to_string(&pkg)?;
        let res = {
            let connection = self.db.lock();
            let mut stmt = connection.prepare(
                "INSERT OR REPLACE INTO package (id, content, fetched_at) VALUES (:id, :content, :fetched_at);",
            )?;
            stmt.execute(named_params! { ":id": pkg.name, ":content": content, ":fetched_at": now_secs() })
        }?;

        let mut cache = self.cache.lock();
        cache.pop(&pkg_name);

        Ok(res)
    }

    pub fn get_package(&self, name: &str) -> AppResult<MinimalPackageData> {
        {
            let mut cache = self.cache.lock();
            let cached_value = cache.get(name);
            if let Some(pkg_data) = cached_value {
                return Ok(pkg_data.clone());
            }
        };

        let content_val: Option<String> = {
            let connection = self.db.lock();
            let mut stmt = connection.prepare("SELECT content FROM package where id = (:id);")?;
            stmt.query_row(named_params! { ":id": name }, |row| row.get(0))
                .optional()?
        };

        if let Some(pkg_content) = content_val {
            let found_pkg: MinimalPackageData = serde_json::from_str(&pkg_content)?;
            let mut cache = self.cache.lock();
            cache.put(name.to_string(), found_pkg.clone());
            Ok(found_pkg)
        } else {
            Err(crate::app_error::ServerError::PackageNotFound(
                name.to_string(),
            ))
        }
    }

    /// Returns true if the package manifest is already known locally (cache or
    /// SQLite). Cheap, synchronous, holds no lock across an await.
    fn has_package(&self, name: &str) -> bool {
        {
            let mut cache = self.cache.lock();
            if cache.get(name).is_some() {
                return true;
            }
        }

        let connection = self.db.lock();
        let exists = match connection.prepare("SELECT 1 FROM package WHERE id = (:id) LIMIT 1;") {
            Ok(mut stmt) => stmt
                .exists(named_params! { ":id": name })
                .unwrap_or(false),
            Err(_) => false,
        };
        exists
    }

    /// Download a single package manifest from the npm registry and persist it.
    /// Reuses `MinimalPackageData::from_doc`, which parses exactly the packument
    /// shape that `registry.npmjs.org/<pkg>` returns.
    async fn fetch_and_store(&self, name: &str) -> AppResult<()> {
        let url = format!("{}/{}", NPM_REGISTRY_URL, name.replace('/', "%2f"));
        let response = NPM_HTTP
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(ServerError::NpmManifestDownloadError {
                status_code: response.status().as_u16(),
                package_name: name.to_string(),
            });
        }

        let body = response.text().await?;
        let doc: RegistryDocument = serde_json::from_str(&body)?;
        self.write_package(MinimalPackageData::from_doc(doc))?;
        Ok(())
    }

    /// Ensure a package manifest exists locally, fetching it on demand from the
    /// npm registry if missing. This replaces the old full-registry replication
    /// thread: we only ever store the packages that get imported.
    pub async fn ensure_package(&self, name: &str) -> AppResult<()> {
        if self.has_package(name) {
            return Ok(());
        }
        self.fetch_and_store(name).await
    }

    /// When the stored manifest was downloaded, or None for rows written before
    /// the column existed (or for unknown packages).
    fn fetched_at(&self, name: &str) -> Option<i64> {
        let connection = self.db.lock();
        let mut stmt = connection
            .prepare("SELECT fetched_at FROM package WHERE id = (:id);")
            .ok()?;
        let value = stmt
            .query_row(named_params! { ":id": name }, |row| row.get::<_, Option<i64>>(0))
            .optional()
            .ok()
            .flatten()
            .flatten();
        value
    }

    /// Re-download a manifest that is already stored, so versions published
    /// after it was first cached become resolvable (katex 0.19.1 was "not
    /// found" on every CDN for weeks while npm had it). Rate-limited per
    /// package; returns whether a download happened.
    pub async fn refresh_package(&self, name: &str) -> AppResult<bool> {
        {
            let mut refreshed = self.refreshed.lock();
            if let Some(last) = refreshed.get(name) {
                if last.elapsed() < MIN_REFRESH_INTERVAL {
                    return Ok(false);
                }
            }
            refreshed.insert(name.to_string(), Instant::now());
        }
        self.fetch_and_store(name).await?;
        Ok(true)
    }

    /// `ensure_package`, plus a refresh when the stored manifest is older than
    /// `max_age` (or of unknown age). Used before resolving dist-tags and
    /// ranges, which must follow npm; exact versions use `refresh_package`
    /// only when they are missing.
    pub async fn ensure_fresh_package(&self, name: &str, max_age: Duration) -> AppResult<()> {
        if !self.has_package(name) {
            return self.fetch_and_store(name).await;
        }
        let stale = match self.fetched_at(name) {
            Some(fetched_at) => now_secs().saturating_sub(fetched_at) > max_age.as_secs() as i64,
            None => true,
        };
        if stale {
            // A failed refresh keeps serving the stored manifest.
            if let Err(err) = self.refresh_package(name).await {
                tracing::warn!("manifest refresh for {} failed, serving the stored copy: {:?}", name, err);
            }
        }
        Ok(())
    }

    /// Cheap liveness probe used by `/health`. An empty database is healthy;
    /// an unreadable one is not.
    pub fn ping(&self) -> AppResult<()> {
        let connection = self.db.lock();
        connection.query_row("SELECT 1", [], |_| Ok(()))?;
        Ok(())
    }
}

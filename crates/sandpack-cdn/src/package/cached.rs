use std::{fmt, path::PathBuf, sync::Arc, time::Duration};

use crate::{
    app_error::ServerError, cached::Cached, npm::package_content::PackageContentFetcher,
    npm_replicator::database::NpmDatabase,
};
use moka::future::Cache;
use parking_lot::Mutex;
use std::collections::HashMap;
use tracing::warn;

use super::disk_cache;
use super::entries::untransformed_entry_files;
use super::process::{extend_npm_package, process_npm_package, MinimalCachedModule, ModuleDependenciesMap};

pub type Content = Arc<(MinimalCachedModule, ModuleDependenciesMap)>;

#[tracing::instrument(
    name = "get_processed_pkg",
    skip(temp_dir, package_cache_dir, cached, npm_db, content_fetcher)
)]
async fn get_processed_pkg(
    package_name: &str,
    package_version: &str,
    temp_dir: &str,
    package_cache_dir: PathBuf,
    cached: Cached<Content>,
    npm_db: NpmDatabase,
    content_fetcher: PackageContentFetcher,
) -> Result<Content, ServerError> {
    let package_name = String::from(package_name);
    let package_version = String::from(package_version);
    let temp_dir = String::from(temp_dir);
    let res = cached
        .get_cached(|_last_val| {
            Box::pin(async move {
                // Exact versions are immutable — prefer the on-disk transform
                // cache (survives CDN process restarts / prewarm).
                if let Some((module, deps)) =
                    disk_cache::load(&package_cache_dir, &package_name, &package_version)?
                {
                    return Ok::<_, ServerError>(Arc::new((module, deps)));
                }

                let content = process_npm_package(
                    &package_name,
                    &package_version,
                    &temp_dir,
                    &npm_db,
                    &content_fetcher,
                )
                .await?;

                if let Err(err) = disk_cache::store(
                    &package_cache_dir,
                    &package_name,
                    &package_version,
                    &content.0,
                    &content.1,
                ) {
                    // Non-fatal: still serve the freshly transformed package.
                    warn!(
                        "Failed to persist package cache for {}@{}: {:?}",
                        package_name, package_version, err
                    );
                }

                Ok::<_, ServerError>(Arc::new(content))
            })
        })
        .await?;

    Ok(res)
}

#[derive(Clone)]
pub struct CachedPackageProcessor {
    cache: Cache<String, Cached<Content>>,
    refresh_interval: Duration,
    npm_db: NpmDatabase,
    content_fetcher: PackageContentFetcher,
    temp_dir: String,
    package_cache_dir: PathBuf,
    /// One extension of a package at a time (`get_with_entries`).
    extending: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
}

impl CachedPackageProcessor {
    pub fn new(
        npm_db: NpmDatabase,
        content_fetcher: PackageContentFetcher,
        temp_dir: &str,
        package_cache_dir: PathBuf,
    ) -> CachedPackageProcessor {
        if let Err(err) = disk_cache::ensure_dir(&package_cache_dir) {
            warn!(
                "Could not create package cache dir {}: {:?}",
                package_cache_dir.display(),
                err
            );
        }

        let ttl = Duration::from_secs(86400);
        let max_capacity = 250;
        CachedPackageProcessor {
            cache: Cache::builder()
                .max_capacity(max_capacity)
                .time_to_idle(ttl)
                .build(),
            // Long enough that warm hits stay in memory; disk covers restarts.
            refresh_interval: Duration::from_secs(604800),
            npm_db,
            content_fetcher,
            temp_dir: String::from(temp_dir),
            package_cache_dir,
            extending: Default::default(),
        }
    }

    /// The processed package with the code `entries` name transformed.
    ///
    /// A package is processed from the entries it declares. Any other file of
    /// it may still be imported (`dayjs/plugin/utc`, `lodash/debounce`,
    /// `elkjs/lib/elk.bundled.js`); left as it is, the bundler downloads such a
    /// file as published, finds its imports one download at a time, and
    /// compiles it in the browser. So it is transformed, with what it loads,
    /// the first time it is asked for, and kept like the rest.
    #[tracing::instrument(name = "processed_pkg_get_with_entries", skip(self))]
    pub async fn get_with_entries(
        &self,
        package_name: &str,
        package_version: &str,
        entries: &[String],
    ) -> Result<Content, ServerError> {
        let content = self.get(package_name, package_version).await?;
        if untransformed_entry_files(package_name, &content.0, entries).is_empty() {
            return Ok(content);
        }

        let key = format!("{}@{}", package_name, package_version);
        let gate = self.extending.lock().entry(key.clone()).or_default().clone();
        let _turn = gate.lock().await;
        // Another request may have transformed them while this one waited.
        let content = self.get(package_name, package_version).await?;
        let missing = untransformed_entry_files(package_name, &content.0, entries);
        if missing.is_empty() {
            return Ok(content);
        }

        let extended = match extend_npm_package(
            package_name,
            package_version,
            &self.temp_dir,
            &self.npm_db,
            &self.content_fetcher,
            content.0.clone(),
            missing,
        )
        .await
        {
            Ok(module) => module,
            Err(err) => {
                // The files stay listed, and reach the bundler as published.
                warn!("Could not transform entries {:?} of {}: {:?}", entries, key, err);
                return Ok(content);
            }
        };
        if let Err(err) = disk_cache::store(
            &self.package_cache_dir,
            package_name,
            package_version,
            &extended,
            &content.1,
        ) {
            warn!("Failed to persist package cache for {}: {:?}", key, err);
        }
        let extended: Content = Arc::new((extended, content.1.clone()));
        self.cache.insert(key, Cached::ready(self.refresh_interval, extended.clone())).await;
        Ok(extended)
    }

    #[tracing::instrument(name = "processed_pkg_get", skip(self))]
    pub async fn get(
        &self,
        package_name: &str,
        package_version: &str,
    ) -> Result<Content, ServerError> {
        let key = format!("{}@{}", package_name, package_version);
        if let Some(found_value) = self.cache.get(&key).await {
            get_processed_pkg(
                package_name,
                package_version,
                &self.temp_dir,
                self.package_cache_dir.clone(),
                found_value,
                self.npm_db.clone(),
                self.content_fetcher.clone(),
            )
            .await
        } else {
            let cached: Cached<Content> = Cached::new(self.refresh_interval);
            self.cache.insert(key, cached.clone()).await;
            get_processed_pkg(
                package_name,
                package_version,
                &self.temp_dir,
                self.package_cache_dir.clone(),
                cached,
                self.npm_db.clone(),
                self.content_fetcher.clone(),
            )
            .await
        }
    }
}

impl fmt::Debug for CachedPackageProcessor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("CachedPackageProcessor")
    }
}

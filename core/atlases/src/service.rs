/*!
 * Atlas Service - handles atlas loading and management operations
 */

use crate::catalog::AtlasCatalog;
use crate::types::*;
use neuroatlas::{
    atlas::{ASEGAtlas, Atlas, GlasserAtlas, OlsenMTLAtlas, SchaeferAtlas},
    core::types::{Hemisphere, Network, Resolution, Space},
};
use std::fs;
use std::path::{Component, Path};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, error, info, warn};

/// Service for managing atlas operations
pub struct AtlasService {
    catalog: Arc<RwLock<AtlasCatalog>>,
    progress_tx: broadcast::Sender<AtlasLoadProgress>,
    cache_dir: std::path::PathBuf,
    // Track active subscriptions for proper cleanup
    active_subscriptions: Arc<std::sync::atomic::AtomicUsize>,
}

impl AtlasService {
    /// Create a new atlas service
    pub fn new(cache_dir: std::path::PathBuf) -> Result<Self, AtlasError> {
        let (progress_tx, _) = broadcast::channel(32);

        // Validate and canonicalize the cache directory path
        let cache_dir = Self::sanitize_cache_dir(cache_dir)?;

        Ok(Self {
            catalog: Arc::new(RwLock::new(AtlasCatalog::new())),
            progress_tx,
            cache_dir,
            active_subscriptions: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        })
    }

    /// Sanitize and validate cache directory path to prevent directory traversal attacks
    fn sanitize_cache_dir(cache_dir: std::path::PathBuf) -> Result<std::path::PathBuf, AtlasError> {
        // Create the directory if it doesn't exist
        if !cache_dir.exists() {
            std::fs::create_dir_all(&cache_dir).map_err(|e| {
                AtlasError::IoError(format!("Failed to create cache directory: {}", e))
            })?;
        }

        // Convert to absolute path to resolve any relative components
        let abs_path = cache_dir.canonicalize().map_err(|e| {
            AtlasError::PathSecurityViolation(format!(
                "Failed to canonicalize cache directory: {}",
                e
            ))
        })?;

        // Check for directory traversal attempts in the original path
        for component in cache_dir.components() {
            match component {
                Component::ParentDir => {
                    return Err(AtlasError::PathSecurityViolation(
                        "Parent directory traversal (..) not allowed in cache path".to_string(),
                    ));
                }
                Component::CurDir => {
                    // Current directory (.) is acceptable
                    continue;
                }
                Component::Normal(_) | Component::RootDir | Component::Prefix(_) => {
                    // These are acceptable components
                    continue;
                }
            }
        }

        // Ensure the path is within expected bounds (not system directories)
        let path_str = abs_path.to_string_lossy();
        if path_str.starts_with("/System/")
            || path_str.starts_with("/usr/")
            || path_str.starts_with("/bin/")
            || path_str.starts_with("/sbin/")
            || path_str.starts_with("/etc/")
        {
            return Err(AtlasError::PathSecurityViolation(format!(
                "Cache directory cannot be in system path: {}",
                path_str
            )));
        }

        info!("Atlas cache directory validated: {}", abs_path.display());
        Ok(abs_path)
    }

    /// Get a sanitized path within the cache directory
    fn get_cache_path(&self, relative_path: &str) -> Result<std::path::PathBuf, AtlasError> {
        // Sanitize the relative path
        let sanitized_relative = Self::sanitize_relative_path(relative_path)?;

        // Join with cache directory
        let full_path = self.cache_dir.join(sanitized_relative);

        // Ensure the result is still within the cache directory
        let canonical_path = full_path.canonicalize().unwrap_or(full_path); // If path doesn't exist yet, that's okay

        if !canonical_path.starts_with(&self.cache_dir) {
            return Err(AtlasError::PathSecurityViolation(format!(
                "Path escapes cache directory: {}",
                canonical_path.display()
            )));
        }

        Ok(canonical_path)
    }

    /// Sanitize a relative path to prevent directory traversal
    fn sanitize_relative_path(path: &str) -> Result<std::path::PathBuf, AtlasError> {
        let path_buf = std::path::PathBuf::from(path);

        // Check each component for security violations
        for component in path_buf.components() {
            match component {
                Component::ParentDir => {
                    return Err(AtlasError::PathSecurityViolation(
                        "Parent directory traversal (..) not allowed in relative path".to_string(),
                    ));
                }
                Component::RootDir | Component::Prefix(_) => {
                    return Err(AtlasError::PathSecurityViolation(
                        "Absolute paths not allowed in relative path".to_string(),
                    ));
                }
                Component::Normal(name) => {
                    // Check for potentially dangerous filenames
                    let name_str = name.to_string_lossy();
                    if name_str.contains('\0') || name_str.len() > 255 {
                        return Err(AtlasError::PathSecurityViolation(
                            "Invalid filename in path".to_string(),
                        ));
                    }
                }
                Component::CurDir => {
                    // Current directory (.) is acceptable
                    continue;
                }
            }
        }

        Ok(path_buf)
    }

    /// Get the catalog of available atlases
    pub async fn get_catalog(&self) -> Result<Vec<AtlasCatalogEntry>, AtlasError> {
        let catalog = self.catalog.read().await;
        Ok(catalog.get_entries(None))
    }

    /// Get filtered atlas entries
    pub async fn get_filtered_atlases(
        &self,
        filter: &AtlasFilter,
    ) -> Result<Vec<AtlasCatalogEntry>, AtlasError> {
        let catalog = self.catalog.read().await;
        Ok(catalog.get_entries(Some(filter)))
    }

    /// Get a specific atlas entry by ID
    pub async fn get_atlas_entry(&self, id: &str) -> Result<Option<AtlasCatalogEntry>, AtlasError> {
        let catalog = self.catalog.read().await;
        Ok(catalog.get_entry(id).cloned())
    }

    /// Toggle favorite status for an atlas
    pub async fn toggle_favorite(&self, id: &str) -> Result<bool, AtlasError> {
        let mut catalog = self.catalog.write().await;
        catalog
            .toggle_favorite(id)
            .map_err(|e| AtlasError::ValidationFailed(e.to_string()))
    }

    /// Get recent atlases
    pub async fn get_recent_atlases(&self) -> Result<Vec<AtlasCatalogEntry>, AtlasError> {
        let catalog = self.catalog.read().await;
        Ok(catalog.get_recent())
    }

    /// Get favorite atlases
    pub async fn get_favorite_atlases(&self) -> Result<Vec<AtlasCatalogEntry>, AtlasError> {
        let catalog = self.catalog.read().await;
        Ok(catalog.get_favorites())
    }

    /// Check if atlas configuration is valid
    pub async fn validate_config(&self, config: &AtlasConfig) -> Result<(), AtlasError> {
        let catalog = self.catalog.read().await;

        // Validate and parse the configuration using type-safe enums
        let atlas_type = config.parse_atlas_type()?;
        let _space = config.parse_space()?;
        let _resolution = config.parse_resolution()?;

        // Check if atlas exists
        let entry = catalog
            .get_entry(&config.atlas_id)
            .ok_or_else(|| AtlasError::AtlasNotFound(config.atlas_id.clone()))?;

        // Check if space is compatible
        if !entry.allowed_spaces.iter().any(|s| s.id == config.space) {
            return Err(AtlasError::UnsupportedSpace(config.space.clone()));
        }

        // Check if resolution is available
        if !entry
            .resolutions
            .iter()
            .any(|r| r.value == config.resolution)
        {
            return Err(AtlasError::UnsupportedResolution(config.resolution.clone()));
        }

        // Validate Schaefer-specific parameters
        if matches!(atlas_type, AtlasType::Schaefer2018) {
            if let Some(networks) = config.networks {
                if let Some(valid_networks) = &entry.network_options {
                    if !valid_networks.contains(&networks) {
                        return Err(AtlasError::InvalidParameter {
                            field: "networks".to_string(),
                            value: networks.to_string(),
                        });
                    }
                } else {
                    return Err(AtlasError::ValidationFailed(
                        "Network options not available for this atlas".to_string(),
                    ));
                }
            }

            if let Some(parcels) = config.parcels {
                if let Some(valid_parcels) = &entry.parcel_options {
                    if !valid_parcels.contains(&parcels) {
                        return Err(AtlasError::InvalidParameter {
                            field: "parcels".to_string(),
                            value: parcels.to_string(),
                        });
                    }
                } else {
                    return Err(AtlasError::ValidationFailed(
                        "Parcel options not available for this atlas".to_string(),
                    ));
                }
            }
        }

        Ok(())
    }

    /// Load an atlas with the given configuration
    pub async fn load_atlas(&self, config: AtlasConfig) -> Result<AtlasLoadResult, AtlasError> {
        info!(
            "Loading atlas: {} in space {} at {}",
            config.atlas_id, config.space, config.resolution
        );

        // Validate configuration first - this will parse and validate the enum types
        self.validate_config(&config).await?;

        // Parse the atlas type for type-safe dispatch
        let atlas_type = config.parse_atlas_type()?;

        // Send initial progress
        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::CheckingCache,
            progress: 0.1,
            message: "Checking cache...".to_string(),
        });

        // Check cache first
        if let Ok(Some((cached_data, cached_metadata))) = self.load_from_cache(&config).await {
            self.send_progress(AtlasLoadProgress {
                atlas_id: config.atlas_id.clone(),
                stage: LoadingStage::Complete,
                progress: 1.0,
                message: "Loaded from cache".to_string(),
            });

            // Mark atlas as used
            {
                let mut catalog = self.catalog.write().await;
                let _ = catalog.mark_used(&config.atlas_id);
            }

            // TODO: Convert cached data back to volume handle - this will need integration with the volume system
            let volume_handle = format!("atlas_{}", config.atlas_id);

            return Ok(AtlasLoadResult {
                atlas_metadata: cached_metadata,
                volume_handle,
            });
        }

        // Mark atlas as used
        {
            let mut catalog = self.catalog.write().await;
            let _ = catalog.mark_used(&config.atlas_id);
        }

        // Load based on atlas type using type-safe enum dispatch
        match atlas_type {
            AtlasType::Schaefer2018 => self.load_schaefer_atlas(config).await,
            AtlasType::Glasser2016 => self.load_glasser_atlas(config).await,
            AtlasType::FreeSurferAseg => self.load_aseg_atlas(config).await,
            AtlasType::OlsenMtl => self.load_olsen_mtl_atlas(config).await,
        }
    }

    /// Subscribe to atlas loading progress updates
    /// Subscribe to atlas loading progress events
    /// Returns a receiver that will receive progress updates
    pub fn subscribe_progress(&self) -> broadcast::Receiver<AtlasLoadProgress> {
        // Track active subscription
        self.active_subscriptions
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        debug!(
            "Progress subscription created, active subscriptions: {}",
            self.active_subscriptions
                .load(std::sync::atomic::Ordering::Relaxed)
        );

        self.progress_tx.subscribe()
    }

    /// Get the number of active progress subscriptions
    pub fn active_subscription_count(&self) -> usize {
        self.active_subscriptions
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Send a progress update with subscription tracking
    fn send_progress(&self, progress: AtlasLoadProgress) {
        // Only send if there are active subscribers to reduce overhead
        if self.active_subscription_count() > 0 {
            let receiver_count = self.progress_tx.receiver_count();
            if receiver_count > 0 {
                if let Err(e) = self.progress_tx.send(progress) {
                    debug!(
                        "Failed to send progress update: {} (no active receivers)",
                        e
                    );
                    // Update subscription count if send failed due to no receivers
                    self.active_subscriptions
                        .store(0, std::sync::atomic::Ordering::Relaxed);
                }
            } else {
                // No receivers, reset subscription count
                self.active_subscriptions
                    .store(0, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }

    /// Cleanup method to be called when service is being dropped
    pub fn cleanup(&self) {
        debug!(
            "AtlasService cleanup: {} active subscriptions",
            self.active_subscription_count()
        );
        // The broadcast channel will be dropped automatically, closing all receivers
    }

    /// Check if atlas data is cached
    pub async fn is_cached(&self, config: &AtlasConfig) -> bool {
        let cache_key = self.generate_cache_key(config);
        let cache_path = self.cache_dir.join(format!("{}.cache", cache_key));
        cache_path.exists()
    }

    /// Generate a unique cache key for the given configuration
    fn generate_cache_key(&self, config: &AtlasConfig) -> String {
        format!(
            "{}_{}_{}_{}_{}",
            config.atlas_id,
            config.space,
            config.resolution,
            config.networks.unwrap_or(7),
            config.parcels.unwrap_or(400)
        )
    }

    /// Get cache file path for the given configuration
    fn get_cache_file_path(&self, config: &AtlasConfig) -> std::path::PathBuf {
        let cache_key = self.generate_cache_key(config);
        self.cache_dir.join(format!("{}.cache", cache_key))
    }

    /// Get cache metadata file path for the given configuration
    fn get_cache_metadata_path(&self, config: &AtlasConfig) -> std::path::PathBuf {
        let cache_key = self.generate_cache_key(config);
        self.cache_dir.join(format!("{}.meta", cache_key))
    }

    /// Cache atlas data to disk
    async fn cache_atlas_data(
        &self,
        config: &AtlasConfig,
        data: &[u8],
        metadata: &AtlasMetadata,
    ) -> Result<(), AtlasError> {
        let cache_file = self.get_cache_file_path(config);
        let meta_file = self.get_cache_metadata_path(config);

        // Write data to cache in blocking task
        let cache_file_clone = cache_file.clone();
        let data_vec = data.to_vec();
        tokio::task::spawn_blocking(move || {
            fs::write(&cache_file_clone, data_vec)
                .map_err(|e| AtlasError::IoError(format!("Failed to write cache file: {}", e)))
        })
        .await
        .map_err(|e| AtlasError::IoError(format!("Cache write task failed: {}", e)))??;

        // Write metadata to cache
        let meta_file_clone = meta_file.clone();
        let metadata_json = serde_json::to_string_pretty(metadata)
            .map_err(|e| AtlasError::IoError(format!("Failed to serialize metadata: {}", e)))?;

        tokio::task::spawn_blocking(move || {
            fs::write(&meta_file_clone, metadata_json)
                .map_err(|e| AtlasError::IoError(format!("Failed to write metadata file: {}", e)))
        })
        .await
        .map_err(|e| AtlasError::IoError(format!("Metadata write task failed: {}", e)))??;

        info!("Atlas data cached successfully: {}", cache_file.display());
        Ok(())
    }

    /// Load atlas data from cache
    async fn load_from_cache(
        &self,
        config: &AtlasConfig,
    ) -> Result<Option<(Vec<u8>, AtlasMetadata)>, AtlasError> {
        let cache_file = self.get_cache_file_path(config);
        let meta_file = self.get_cache_metadata_path(config);

        if !cache_file.exists() || !meta_file.exists() {
            return Ok(None);
        }

        // Check cache age (optional - implement cache expiration)
        if let Ok(metadata) = cache_file.metadata() {
            if let Ok(modified) = metadata.modified() {
                if let Ok(duration) = SystemTime::now().duration_since(modified) {
                    // Cache expires after 30 days
                    if duration.as_secs() > 30 * 24 * 60 * 60 {
                        info!("Cache expired for: {}", cache_file.display());
                        return Ok(None);
                    }
                }
            }
        }

        // Load data from cache in blocking task
        let cache_file_clone = cache_file.clone();
        let meta_file_clone = meta_file.clone();

        let (data, metadata) = tokio::task::spawn_blocking(move || {
            let data = fs::read(&cache_file_clone)
                .map_err(|e| AtlasError::IoError(format!("Failed to read cache file: {}", e)))?;

            let metadata_str = fs::read_to_string(&meta_file_clone)
                .map_err(|e| AtlasError::IoError(format!("Failed to read metadata file: {}", e)))?;

            let metadata: AtlasMetadata = serde_json::from_str(&metadata_str)
                .map_err(|e| AtlasError::IoError(format!("Failed to parse metadata: {}", e)))?;

            Ok::<(Vec<u8>, AtlasMetadata), AtlasError>((data, metadata))
        })
        .await
        .map_err(|e| AtlasError::IoError(format!("Cache read task failed: {}", e)))??;

        info!("Atlas data loaded from cache: {}", cache_file.display());
        Ok(Some((data, metadata)))
    }

    /// Clear cache for a specific atlas configuration
    pub async fn clear_cache(&self, config: &AtlasConfig) -> Result<(), AtlasError> {
        let cache_file = self.get_cache_file_path(config);
        let meta_file = self.get_cache_metadata_path(config);

        let cache_file_clone = cache_file.clone();
        let meta_file_clone = meta_file.clone();

        tokio::task::spawn_blocking(move || {
            if cache_file_clone.exists() {
                fs::remove_file(&cache_file_clone).map_err(|e| {
                    AtlasError::IoError(format!("Failed to remove cache file: {}", e))
                })?;
            }

            if meta_file_clone.exists() {
                fs::remove_file(&meta_file_clone).map_err(|e| {
                    AtlasError::IoError(format!("Failed to remove metadata file: {}", e))
                })?;
            }

            Ok::<(), AtlasError>(())
        })
        .await
        .map_err(|e| AtlasError::IoError(format!("Cache clear task failed: {}", e)))??;

        info!("Cache cleared for atlas: {}", config.atlas_id);
        Ok(())
    }

    /// Clear all cached atlas data
    pub async fn clear_all_cache(&self) -> Result<(), AtlasError> {
        let cache_dir = self.cache_dir.clone();

        tokio::task::spawn_blocking(move || {
            if cache_dir.exists() {
                for entry in fs::read_dir(&cache_dir).map_err(|e| {
                    AtlasError::IoError(format!("Failed to read cache directory: {}", e))
                })? {
                    let entry = entry.map_err(|e| {
                        AtlasError::IoError(format!("Failed to read directory entry: {}", e))
                    })?;
                    let path = entry.path();

                    if path.is_file()
                        && (path.extension() == Some(std::ffi::OsStr::new("cache"))
                            || path.extension() == Some(std::ffi::OsStr::new("meta")))
                    {
                        fs::remove_file(&path).map_err(|e| {
                            AtlasError::IoError(format!("Failed to remove file: {}", e))
                        })?;
                    }
                }
            }

            Ok::<(), AtlasError>(())
        })
        .await
        .map_err(|e| AtlasError::IoError(format!("Cache clear all task failed: {}", e)))??;

        info!("All atlas cache cleared");
        Ok(())
    }

    /// Get cache statistics
    pub async fn get_cache_stats(&self) -> Result<CacheStats, AtlasError> {
        let cache_dir = self.cache_dir.clone();

        let stats = tokio::task::spawn_blocking(move || {
            let mut total_size = 0u64;
            let mut file_count = 0usize;
            let mut cache_files = Vec::new();

            if cache_dir.exists() {
                for entry in fs::read_dir(&cache_dir).map_err(|e| {
                    AtlasError::IoError(format!("Failed to read cache directory: {}", e))
                })? {
                    let entry = entry.map_err(|e| {
                        AtlasError::IoError(format!("Failed to read directory entry: {}", e))
                    })?;
                    let path = entry.path();

                    if path.is_file() {
                        if let Ok(metadata) = fs::metadata(&path) {
                            total_size += metadata.len();
                            file_count += 1;

                            if path.extension() == Some(std::ffi::OsStr::new("cache")) {
                                if let Some(stem) = path.file_stem() {
                                    cache_files.push(stem.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }

            Ok::<CacheStats, AtlasError>(CacheStats {
                total_size_bytes: total_size,
                file_count,
                cached_atlases: cache_files,
            })
        })
        .await
        .map_err(|e| AtlasError::IoError(format!("Cache stats task failed: {}", e)))??;

        Ok(stats)
    }

    /// Load Schaefer atlas
    async fn load_schaefer_atlas(
        &self,
        config: AtlasConfig,
    ) -> Result<AtlasLoadResult, AtlasError> {
        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Loading,
            progress: 0.3,
            message: "Loading Schaefer atlas...".to_string(),
        });

        // Parse and validate configuration using type-safe enums
        let _space_enum = config.parse_space()?;
        let _resolution_enum = config.parse_resolution()?;

        // Convert string values to neuroatlas types (validated above)
        let space = match config.space.as_str() {
            "MNI152NLin2009cAsym" => Space::MNI152NLin2009cAsym,
            "MNI152NLin6Asym" => Space::MNI152NLin6Asym,
            "fsaverage" => Space::FSAverage,
            "fsaverage5" => Space::FSAverage5,
            "fsaverage6" => Space::FSAverage6,
            _ => return Err(AtlasError::UnsupportedSpace(config.space)),
        };

        let resolution = match config.resolution.as_str() {
            "1mm" => Resolution::MM1,
            "2mm" => Resolution::MM2,
            _ => return Err(AtlasError::UnsupportedResolution(config.resolution)),
        };

        // Get networks and parcels
        let networks = config.networks.unwrap_or(7);
        let parcels = config.parcels.unwrap_or(400);

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Processing,
            progress: 0.7,
            message: format!(
                "Processing Schaefer {} parcels, {} networks...",
                parcels, networks
            ),
        });

        // Move CPU-heavy atlas creation and loading to blocking thread
        let atlas_id = config.atlas_id.clone();
        let progress_tx = self.progress_tx.clone();

        let atlas_result = tokio::task::spawn_blocking(move || {
            // Create the atlas using neuroatlas-rs builder pattern
            let atlas_result = if networks == 7 {
                SchaeferAtlas::new_7_network(parcels)
            } else {
                SchaeferAtlas::new_17_network(parcels)
            };

            match atlas_result {
                Ok(mut atlas) => {
                    // Load the atlas data (blocking operation)
                    match futures::executor::block_on(atlas.load()) {
                        Ok(_) => Ok(atlas),
                        Err(e) => {
                            let error_msg = format!("Failed to load Schaefer atlas data: {}", e);
                            error!("{}", error_msg);

                            let _ = progress_tx.send(AtlasLoadProgress {
                                atlas_id: atlas_id.clone(),
                                stage: LoadingStage::Error,
                                progress: 0.0,
                                message: error_msg.clone(),
                            });

                            Err(AtlasError::LoadFailed(error_msg))
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("Failed to create Schaefer atlas: {}", e);
                    error!("{}", error_msg);

                    let _ = progress_tx.send(AtlasLoadProgress {
                        atlas_id: atlas_id.clone(),
                        stage: LoadingStage::Error,
                        progress: 0.0,
                        message: error_msg.clone(),
                    });

                    Err(AtlasError::LoadFailed(error_msg))
                }
            }
        })
        .await
        .map_err(|e| AtlasError::LoadFailed(format!("Atlas loading task failed: {}", e)))?;

        match atlas_result {
            Ok(atlas) => {
                self.send_progress(AtlasLoadProgress {
                    atlas_id: config.atlas_id.clone(),
                    stage: LoadingStage::Complete,
                    progress: 1.0,
                    message: "Atlas loaded successfully".to_string(),
                });

                // Create metadata
                let metadata = AtlasMetadata {
                    id: config.atlas_id.clone(),
                    name: format!("Schaefer {} parcels, {} networks", parcels, networks),
                    description: "Cortical parcellations based on connectivity gradients".to_string(),
                    n_regions: atlas.n_regions(),
                    space: config.space.clone(),
                    resolution: config.resolution.clone(),
                    citation: Some("Schaefer et al. (2018). Local-Global Parcellation of the Human Cerebral Cortex. Cerebral Cortex.".to_string()),
                    bounds_mm: None, // TODO: Extract from atlas
                    data_range: None, // TODO: Extract from atlas
                };

                // TODO: Convert to volume handle - this will need integration with the volume system
                let volume_handle = format!("atlas_{}", config.atlas_id);

                Ok(AtlasLoadResult {
                    atlas_metadata: metadata,
                    volume_handle,
                })
            }
            Err(e) => Err(e),
        }
    }

    /// Load Glasser atlas
    async fn load_glasser_atlas(&self, config: AtlasConfig) -> Result<AtlasLoadResult, AtlasError> {
        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Loading,
            progress: 0.3,
            message: "Loading Glasser atlas...".to_string(),
        });

        // Parse space
        let space = match config.space.as_str() {
            "MNI152NLin2009cAsym" => Space::MNI152NLin2009cAsym,
            "MNI152NLin6Asym" => Space::MNI152NLin6Asym,
            "fsaverage" => Space::FSAverage,
            "fsaverage5" => Space::FSAverage5,
            "fsaverage6" => Space::FSAverage6,
            _ => return Err(AtlasError::UnsupportedSpace(config.space)),
        };

        // Parse resolution
        let resolution = match config.resolution.as_str() {
            "1mm" => Resolution::MM1,
            "2mm" => Resolution::MM2,
            _ => return Err(AtlasError::UnsupportedResolution(config.resolution)),
        };

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Processing,
            progress: 0.7,
            message: "Processing Glasser HCP-MMP1.0...".to_string(),
        });

        // Move CPU-heavy atlas creation and loading to blocking thread
        let atlas_id = config.atlas_id.clone();
        let progress_tx = self.progress_tx.clone();

        let atlas_result = tokio::task::spawn_blocking(move || {
            // Create the atlas using neuroatlas-rs
            match GlasserAtlas::new() {
                Ok(mut atlas) => {
                    // Load the atlas data (blocking operation)
                    match futures::executor::block_on(atlas.load()) {
                        Ok(_) => Ok(atlas),
                        Err(e) => {
                            let error_msg = format!("Failed to load Glasser atlas data: {}", e);
                            error!("{}", error_msg);

                            let _ = progress_tx.send(AtlasLoadProgress {
                                atlas_id: atlas_id.clone(),
                                stage: LoadingStage::Error,
                                progress: 0.0,
                                message: error_msg.clone(),
                            });

                            Err(AtlasError::LoadFailed(error_msg))
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("Failed to create Glasser atlas: {}", e);
                    error!("{}", error_msg);

                    let _ = progress_tx.send(AtlasLoadProgress {
                        atlas_id: atlas_id.clone(),
                        stage: LoadingStage::Error,
                        progress: 0.0,
                        message: error_msg.clone(),
                    });

                    Err(AtlasError::LoadFailed(error_msg))
                }
            }
        })
        .await
        .map_err(|e| AtlasError::LoadFailed(format!("Atlas loading task failed: {}", e)))?;

        match atlas_result {
            Ok(atlas) => {
                self.send_progress(AtlasLoadProgress {
                    atlas_id: config.atlas_id.clone(),
                    stage: LoadingStage::Complete,
                    progress: 1.0,
                    message: "Atlas loaded successfully".to_string(),
                });

                let metadata = AtlasMetadata {
                    id: config.atlas_id.clone(),
                    name: "Glasser 2016 (HCP-MMP1.0)".to_string(),
                    description: "Human Connectome Project Multi-Modal Parcellation (360 areas)".to_string(),
                    n_regions: atlas.n_regions(),
                    space: config.space,
                    resolution: config.resolution,
                    citation: Some("Glasser et al. (2016). A multi-modal parcellation of human cerebral cortex. Nature.".to_string()),
                    bounds_mm: None,
                    data_range: None,
                };

                let volume_handle = format!("atlas_{}", config.atlas_id);

                Ok(AtlasLoadResult {
                    atlas_metadata: metadata,
                    volume_handle,
                })
            }
            Err(e) => Err(e),
        }
    }

    /// Load FreeSurfer ASEG atlas
    async fn load_aseg_atlas(&self, config: AtlasConfig) -> Result<AtlasLoadResult, AtlasError> {
        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Loading,
            progress: 0.3,
            message: "Loading FreeSurfer ASEG atlas...".to_string(),
        });

        // Parse space (ASEG is volume-only, so only MNI spaces)
        let space = match config.space.as_str() {
            "MNI152NLin2009cAsym" => Space::MNI152NLin2009cAsym,
            "MNI152NLin6Asym" => Space::MNI152NLin6Asym,
            _ => return Err(AtlasError::UnsupportedSpace(config.space)),
        };

        let resolution = match config.resolution.as_str() {
            "1mm" => Resolution::MM1,
            "2mm" => Resolution::MM2,
            _ => return Err(AtlasError::UnsupportedResolution(config.resolution)),
        };

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Processing,
            progress: 0.7,
            message: "Processing ASEG subcortical structures...".to_string(),
        });

        // Move CPU-heavy atlas creation and loading to blocking thread
        let atlas_id = config.atlas_id.clone();
        let progress_tx = self.progress_tx.clone();

        let atlas_result = tokio::task::spawn_blocking(move || {
            match ASEGAtlas::new() {
                Ok(mut atlas) => {
                    // Load the atlas data (blocking operation)
                    match futures::executor::block_on(atlas.load()) {
                        Ok(_) => Ok(atlas),
                        Err(e) => {
                            let error_msg = format!("Failed to load ASEG atlas data: {}", e);
                            error!("{}", error_msg);

                            let _ = progress_tx.send(AtlasLoadProgress {
                                atlas_id: atlas_id.clone(),
                                stage: LoadingStage::Error,
                                progress: 0.0,
                                message: error_msg.clone(),
                            });

                            Err(AtlasError::LoadFailed(error_msg))
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("Failed to create ASEG atlas: {}", e);
                    error!("{}", error_msg);

                    let _ = progress_tx.send(AtlasLoadProgress {
                        atlas_id: atlas_id.clone(),
                        stage: LoadingStage::Error,
                        progress: 0.0,
                        message: error_msg.clone(),
                    });

                    Err(AtlasError::LoadFailed(error_msg))
                }
            }
        })
        .await
        .map_err(|e| AtlasError::LoadFailed(format!("Atlas loading task failed: {}", e)))?;

        match atlas_result {
            Ok(atlas) => {
                self.send_progress(AtlasLoadProgress {
                    atlas_id: config.atlas_id.clone(),
                    stage: LoadingStage::Complete,
                    progress: 1.0,
                    message: "Atlas loaded successfully".to_string(),
                });

                let metadata = AtlasMetadata {
                    id: config.atlas_id.clone(),
                    name: "FreeSurfer ASEG".to_string(),
                    description: "Automated subcortical segmentation".to_string(),
                    n_regions: atlas.n_regions(),
                    space: config.space,
                    resolution: config.resolution,
                    citation: Some(
                        "Fischl et al. (2002). Whole brain segmentation. Neuron.".to_string(),
                    ),
                    bounds_mm: None,
                    data_range: None,
                };

                let volume_handle = format!("atlas_{}", config.atlas_id);

                Ok(AtlasLoadResult {
                    atlas_metadata: metadata,
                    volume_handle,
                })
            }
            Err(e) => Err(e),
        }
    }

    /// Load Olsen MTL atlas
    async fn load_olsen_mtl_atlas(
        &self,
        config: AtlasConfig,
    ) -> Result<AtlasLoadResult, AtlasError> {
        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Loading,
            progress: 0.3,
            message: "Loading Olsen MTL atlas...".to_string(),
        });

        let space = match config.space.as_str() {
            "MNI152NLin2009cAsym" => Space::MNI152NLin2009cAsym,
            "MNI152NLin6Asym" => Space::MNI152NLin6Asym,
            _ => return Err(AtlasError::UnsupportedSpace(config.space)),
        };

        let resolution = match config.resolution.as_str() {
            "1mm" => Resolution::MM1,
            "2mm" => Resolution::MM2,
            _ => return Err(AtlasError::UnsupportedResolution(config.resolution)),
        };

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Processing,
            progress: 0.7,
            message: "Processing MTL structures...".to_string(),
        });

        // Move CPU-heavy atlas creation and loading to blocking thread
        let atlas_id = config.atlas_id.clone();
        let progress_tx = self.progress_tx.clone();

        let atlas_result = tokio::task::spawn_blocking(move || {
            match OlsenMTLAtlas::new() {
                Ok(mut atlas) => {
                    // Load the atlas data (blocking operation)
                    match futures::executor::block_on(atlas.load()) {
                        Ok(_) => Ok(atlas),
                        Err(e) => {
                            let error_msg = format!("Failed to load Olsen MTL atlas data: {}", e);
                            error!("{}", error_msg);

                            let _ = progress_tx.send(AtlasLoadProgress {
                                atlas_id: atlas_id.clone(),
                                stage: LoadingStage::Error,
                                progress: 0.0,
                                message: error_msg.clone(),
                            });

                            Err(AtlasError::LoadFailed(error_msg))
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("Failed to create Olsen MTL atlas: {}", e);
                    error!("{}", error_msg);

                    let _ = progress_tx.send(AtlasLoadProgress {
                        atlas_id: atlas_id.clone(),
                        stage: LoadingStage::Error,
                        progress: 0.0,
                        message: error_msg.clone(),
                    });

                    Err(AtlasError::LoadFailed(error_msg))
                }
            }
        })
        .await
        .map_err(|e| AtlasError::LoadFailed(format!("Atlas loading task failed: {}", e)))?;

        match atlas_result {
            Ok(atlas) => {
                self.send_progress(AtlasLoadProgress {
                    atlas_id: config.atlas_id.clone(),
                    stage: LoadingStage::Complete,
                    progress: 1.0,
                    message: "Atlas loaded successfully".to_string(),
                });

                let metadata = AtlasMetadata {
                    id: config.atlas_id.clone(),
                    name: "Olsen MTL".to_string(),
                    description: "High-resolution medial temporal lobe parcellation".to_string(),
                    n_regions: atlas.n_regions(),
                    space: config.space,
                    resolution: config.resolution,
                    citation: Some("Olsen et al. MTL parcellation atlas.".to_string()),
                    bounds_mm: None,
                    data_range: None,
                };

                let volume_handle = format!("atlas_{}", config.atlas_id);

                Ok(AtlasLoadResult {
                    atlas_metadata: metadata,
                    volume_handle,
                })
            }
            Err(e) => Err(e),
        }
    }
}

/// Implement Drop to ensure proper cleanup of resources
impl Drop for AtlasService {
    fn drop(&mut self) {
        self.cleanup();
    }
}

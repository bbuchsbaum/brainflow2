/*!
 * Atlas Service - handles atlas loading and management operations
 */

use crate::catalog::AtlasCatalog;
use crate::types::*;
use neuroatlas::{
    atlas::{ASEGAtlas, Atlas, GlasserAtlas, GlasserSurfAtlas, OlsenMTLAtlas, SchaeferAtlas},
    core::types::Hemisphere,
};
use std::fs;
use std::path::Component;
use std::sync::Arc;
use std::time::SystemTime;
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, error, info, warn};

/// Return (name, description, citation) for a given atlas type and config.
fn atlas_metadata_info(atlas_type: &AtlasType, config: &AtlasConfig) -> (String, String, String) {
    match atlas_type {
        AtlasType::Schaefer2018 => {
            let parcels = config.parcels.unwrap_or(400);
            let networks = config.networks.unwrap_or(7);
            (
                format!("Schaefer {} parcels, {} networks", parcels, networks),
                "Cortical parcellations based on connectivity gradients".to_string(),
                "Schaefer et al. (2018). Local-Global Parcellation of the Human Cerebral Cortex. Cerebral Cortex.".to_string(),
            )
        }
        AtlasType::Glasser2016 => (
            "Glasser 2016 (HCP-MMP1.0)".to_string(),
            "Human Connectome Project Multi-Modal Parcellation (360 areas)".to_string(),
            "Glasser et al. (2016). A multi-modal parcellation of human cerebral cortex. Nature."
                .to_string(),
        ),
        AtlasType::FreeSurferAseg => (
            "FreeSurfer ASEG".to_string(),
            "Automated subcortical segmentation".to_string(),
            "Fischl et al. (2002). Whole brain segmentation. Neuron.".to_string(),
        ),
        AtlasType::OlsenMtl => (
            "Olsen MTL".to_string(),
            "High-resolution medial temporal lobe parcellation".to_string(),
            "Olsen et al. MTL parcellation atlas.".to_string(),
        ),
    }
}

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
    #[allow(dead_code)]
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
    #[allow(dead_code)]
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
        if let Ok(Some((_cached_data, cached_metadata))) = self.load_from_cache(&config).await {
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

        // Load via unified loader
        self.load_atlas_unified(atlas_type, config).await
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
    #[allow(dead_code)]
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

    /// Unified atlas loader — dispatches construction by atlas type,
    /// handles progress, spawn_blocking, metadata, and volume_handle in one place.
    async fn load_atlas_unified(
        &self,
        atlas_type: AtlasType,
        config: AtlasConfig,
    ) -> Result<AtlasLoadResult, AtlasError> {
        // Validate space/resolution via neuroatlas types
        let _space = config.parse_space()?;
        let _resolution = config.parse_resolution()?;

        let atlas_label = atlas_type.to_string();

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Loading,
            progress: 0.3,
            message: format!("Loading {} atlas...", atlas_label),
        });

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Processing,
            progress: 0.7,
            message: format!("Processing {}...", atlas_label),
        });

        let atlas_id = config.atlas_id.clone();
        let networks = config.networks.unwrap_or(7);
        let parcels = config.parcels.unwrap_or(400);
        let progress_tx = self.progress_tx.clone();
        let atlas_type_clone = atlas_type.clone();

        // Helper: create, load, and return n_regions for a concrete atlas type.
        // We use a macro to avoid `dyn Atlas` (which isn't dyn-compatible due to
        // generic methods on the Atlas trait).
        macro_rules! load_concrete_atlas {
            ($create_expr:expr, $progress_tx:expr, $atlas_id:expr) => {{
                let progress_tx = $progress_tx;
                let atlas_id = $atlas_id;
                match $create_expr {
                    Ok(mut atlas) => match futures::executor::block_on(atlas.load()) {
                        Ok(_) => Ok(atlas.n_regions()),
                        Err(e) => {
                            let msg = format!("Failed to load atlas data: {}", e);
                            error!("{}", msg);
                            let _ = progress_tx.send(AtlasLoadProgress {
                                atlas_id,
                                stage: LoadingStage::Error,
                                progress: 0.0,
                                message: msg.clone(),
                            });
                            Err(AtlasError::LoadFailed(msg))
                        }
                    },
                    Err(e) => {
                        let msg = format!("Failed to create atlas: {}", e);
                        error!("{}", msg);
                        let _ = progress_tx.send(AtlasLoadProgress {
                            atlas_id,
                            stage: LoadingStage::Error,
                            progress: 0.0,
                            message: msg.clone(),
                        });
                        Err(AtlasError::LoadFailed(msg))
                    }
                }
            }};
        }

        // Dispatch construction and loading on a blocking thread
        let n_regions = tokio::task::spawn_blocking(move || match atlas_type_clone {
            AtlasType::Schaefer2018 => {
                let create = if networks == 7 {
                    SchaeferAtlas::new_7_network(parcels)
                } else {
                    SchaeferAtlas::new_17_network(parcels)
                };
                load_concrete_atlas!(create, progress_tx, atlas_id)
            }
            AtlasType::Glasser2016 => {
                load_concrete_atlas!(GlasserAtlas::new(), progress_tx, atlas_id)
            }
            AtlasType::FreeSurferAseg => {
                load_concrete_atlas!(ASEGAtlas::new(), progress_tx, atlas_id)
            }
            AtlasType::OlsenMtl => {
                load_concrete_atlas!(OlsenMTLAtlas::new(), progress_tx, atlas_id)
            }
        })
        .await
        .map_err(|e| AtlasError::LoadFailed(format!("Atlas loading task failed: {}", e)))??;

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Complete,
            progress: 1.0,
            message: "Atlas loaded successfully".to_string(),
        });

        let (name, description, citation) = atlas_metadata_info(&atlas_type, &config);
        let metadata = AtlasMetadata {
            id: config.atlas_id.clone(),
            name,
            description,
            n_regions,
            space: config.space,
            resolution: config.resolution,
            citation: Some(citation),
            bounds_mm: None,
            data_range: None,
        };

        let volume_handle = format!("atlas_{}", config.atlas_id);

        Ok(AtlasLoadResult {
            atlas_metadata: metadata,
            volume_handle,
        })
    }

    /// Load a surface atlas (Glasser or Schaefer) and return per-vertex labels
    pub async fn load_surface_atlas(
        &self,
        config: AtlasConfig,
    ) -> Result<SurfaceAtlasLoadResult, AtlasError> {
        let atlas_type = config.parse_atlas_type()?;

        info!(
            "Loading surface atlas: {} (space: {})",
            config.atlas_id, config.space
        );

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Loading,
            progress: 0.2,
            message: "Loading surface atlas...".to_string(),
        });

        match atlas_type {
            AtlasType::Glasser2016 => self.load_glasser_surface_atlas(config).await,
            AtlasType::Schaefer2018 => self.load_schaefer_surface_atlas(config).await,
            _ => Err(AtlasError::ValidationFailed(format!(
                "Atlas '{}' does not have a surface representation",
                config.atlas_id
            ))),
        }
    }

    fn should_retry_after_surface_cache_repair(error: &AtlasError) -> bool {
        let msg = error.to_string().to_ascii_lowercase();
        let likely_corrupt_file = msg.contains("failed to fill whole buffer")
            || msg.contains("unexpected eof")
            || msg.contains("truncated");
        let surface_context =
            msg.contains("fsaverage") || msg.contains("surf.gii") || msg.contains("surface");

        likely_corrupt_file && surface_context
    }

    fn to_templateflow_surface_type(surf_type: &str) -> neuroatlas::SurfaceType {
        match surf_type {
            "white" => neuroatlas::SurfaceType::White,
            "inflated" => neuroatlas::SurfaceType::Inflated,
            "midthickness" => neuroatlas::SurfaceType::Midthickness,
            _ => neuroatlas::SurfaceType::Pial,
        }
    }

    async fn repair_fsaverage_surface_cache(&self, atlas_id: &str, surf_type: &str) {
        self.send_progress(AtlasLoadProgress {
            atlas_id: atlas_id.to_string(),
            stage: LoadingStage::Downloading,
            progress: 0.35,
            message: "Detected corrupted fsaverage cache, refreshing files and retrying..."
                .to_string(),
        });

        let tf_surface_type = Self::to_templateflow_surface_type(surf_type);
        let hemis = [
            neuroatlas::SurfaceHemi::Left,
            neuroatlas::SurfaceHemi::Right,
        ];

        for hemi in hemis {
            match neuroatlas::fetch_surface_template(
                "fsaverage",
                tf_surface_type,
                hemi,
                Some("164k"),
                None,
            )
            .await
            {
                Ok(path) => {
                    if path.exists() {
                        match fs::remove_file(&path) {
                            Ok(_) => info!(
                                "Removed cached fsaverage surface file before retry: {}",
                                path.display()
                            ),
                            Err(e) => warn!(
                                "Failed to remove cached fsaverage surface file {}: {}",
                                path.display(),
                                e
                            ),
                        }
                    }
                }
                Err(e) => warn!(
                    "Could not resolve cached fsaverage {} surface for {:?}: {}",
                    surf_type, hemi, e
                ),
            }
        }

        // Glasser/Schaefer surface loaders also depend on cached HCP-MMP1 annotations.
        let annot_cache = neuroatlas::io::cache::AtlasCache::new();
        for annot_rel in ["glasser/lh.HCP-MMP1.annot", "glasser/rh.HCP-MMP1.annot"] {
            let annot_path = annot_cache.get_path(annot_rel);
            if annot_path.exists() {
                match fs::remove_file(&annot_path) {
                    Ok(_) => info!(
                        "Removed cached Glasser annotation file before retry: {}",
                        annot_path.display()
                    ),
                    Err(e) => warn!(
                        "Failed to remove cached Glasser annotation file {}: {}",
                        annot_path.display(),
                        e
                    ),
                }
            }
        }

        if let Err(e) = neuroatlas::clear_cache() {
            warn!(
                "Failed to clear legacy neuroatlas templateflow cache: {}",
                e
            );
        }
    }

    async fn load_glasser_surface_atlas_once(
        surf_type: String,
    ) -> Result<GlasserSurfAtlas, AtlasError> {
        tokio::task::spawn_blocking(move || {
            let mut atlas = GlasserSurfAtlas::new(&surf_type).map_err(|e| {
                AtlasError::LoadFailed(format!("Failed to create Glasser surface atlas: {}", e))
            })?;

            futures::executor::block_on(atlas.load()).map_err(|e| {
                AtlasError::LoadFailed(format!("Failed to load Glasser surface atlas: {}", e))
            })?;

            Ok::<GlasserSurfAtlas, AtlasError>(atlas)
        })
        .await
        .map_err(|e| AtlasError::LoadFailed(format!("Task failed: {}", e)))?
    }

    async fn load_schaefer_surface_atlas_once(
        parcels: u32,
        networks: u32,
        surf_type: String,
    ) -> Result<
        (
            neuroatlas::core::surface::SurfaceAtlas,
            neuroatlas::core::surface::SurfaceAtlas,
        ),
        AtlasError,
    > {
        tokio::task::spawn_blocking(move || {
            // Build a temporary Glasser surface atlas to obtain fsaverage geometry.
            let mut geom_atlas = GlasserSurfAtlas::new(&surf_type).map_err(|e| {
                AtlasError::LoadFailed(format!("Failed to create geometry loader: {}", e))
            })?;

            futures::executor::block_on(geom_atlas.load()).map_err(|e| {
                AtlasError::LoadFailed(format!("Failed to load fsaverage geometry: {}", e))
            })?;

            let lh_geom = geom_atlas.lh_atlas().ok_or_else(|| {
                AtlasError::LoadFailed("No LH geometry from Glasser atlas".to_string())
            })?;
            let rh_geom = geom_atlas.rh_atlas().ok_or_else(|| {
                AtlasError::LoadFailed("No RH geometry from Glasser atlas".to_string())
            })?;

            let surface_type = neurosurf_rs::geometry::SurfaceType::from_str(&surf_type);
            let lh_verts_f64 = lh_geom.vertices.mapv(|v| v as f64);
            let lh_faces_usize = lh_geom.faces.mapv(|f| f as usize);
            let lh_surf_geom = neurosurf_rs::geometry::SurfaceGeometry::new(
                lh_verts_f64,
                lh_faces_usize,
                neurosurf_rs::geometry::Hemisphere::Left,
                surface_type.clone(),
            )
            .map_err(|e| {
                AtlasError::LoadFailed(format!("Failed to create LH surface geometry: {}", e))
            })?;

            let rh_verts_f64 = rh_geom.vertices.mapv(|v| v as f64);
            let rh_faces_usize = rh_geom.faces.mapv(|f| f as usize);
            let rh_surf_geom = neurosurf_rs::geometry::SurfaceGeometry::new(
                rh_verts_f64,
                rh_faces_usize,
                neurosurf_rs::geometry::Hemisphere::Right,
                surface_type,
            )
            .map_err(|e| {
                AtlasError::LoadFailed(format!("Failed to create RH surface geometry: {}", e))
            })?;

            let lh_atlas = futures::executor::block_on(SchaeferAtlas::create_surface_atlas(
                parcels,
                networks,
                Hemisphere::Left,
                &lh_surf_geom,
            ))
            .map_err(|e| {
                AtlasError::LoadFailed(format!("Failed to create Schaefer LH surface atlas: {}", e))
            })?;

            let rh_atlas = futures::executor::block_on(SchaeferAtlas::create_surface_atlas(
                parcels,
                networks,
                Hemisphere::Right,
                &rh_surf_geom,
            ))
            .map_err(|e| {
                AtlasError::LoadFailed(format!("Failed to create Schaefer RH surface atlas: {}", e))
            })?;

            Ok::<
                (
                    neuroatlas::core::surface::SurfaceAtlas,
                    neuroatlas::core::surface::SurfaceAtlas,
                ),
                AtlasError,
            >((lh_atlas, rh_atlas))
        })
        .await
        .map_err(|e| AtlasError::LoadFailed(format!("Task failed: {}", e)))?
    }

    /// Load the Glasser HCP-MMP1.0 surface atlas
    async fn load_glasser_surface_atlas(
        &self,
        config: AtlasConfig,
    ) -> Result<SurfaceAtlasLoadResult, AtlasError> {
        let surf_type = config.surf_type.as_deref().unwrap_or("pial");
        let atlas_id = config.atlas_id.clone();
        let surf_type_owned = surf_type.to_string();

        self.send_progress(AtlasLoadProgress {
            atlas_id: atlas_id.clone(),
            stage: LoadingStage::Downloading,
            progress: 0.3,
            message: format!("Downloading Glasser surface atlas ({})...", surf_type),
        });

        let mut atlas_result = Self::load_glasser_surface_atlas_once(surf_type_owned.clone()).await;
        if let Err(err) = &atlas_result {
            if Self::should_retry_after_surface_cache_repair(err) {
                warn!(
                    "Glasser surface atlas load failed with likely corrupted fsaverage cache, retrying once: {}",
                    err
                );
                self.repair_fsaverage_surface_cache(&atlas_id, surf_type)
                    .await;
                atlas_result = Self::load_glasser_surface_atlas_once(surf_type_owned).await;
            }
        }

        let atlas_result = match atlas_result {
            Ok(result) => result,
            Err(e) => {
                self.send_progress(AtlasLoadProgress {
                    atlas_id: atlas_id.clone(),
                    stage: LoadingStage::Error,
                    progress: 0.0,
                    message: format!("Failed to load Glasser surface atlas: {}", e),
                });
                return Err(e);
            }
        };

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Processing,
            progress: 0.8,
            message: "Processing surface labels...".to_string(),
        });

        let (labels_lh, n_vertices_lh) = match atlas_result.lh_atlas() {
            Some(sa) => (sa.labels.to_vec(), sa.n_vertices()),
            None => (vec![], 0),
        };
        let (labels_rh, n_vertices_rh) = match atlas_result.rh_atlas() {
            Some(sa) => (sa.labels.to_vec(), sa.n_vertices()),
            None => (vec![], 0),
        };

        let label_info: Vec<SurfaceAtlasLabelInfo> = atlas_result
            .labels()
            .iter()
            .map(|l| SurfaceAtlasLabelInfo {
                id: l.id,
                name: l.name.clone(),
                color: l.color,
                hemisphere: l.hemisphere.as_ref().map(|h| match h {
                    Hemisphere::Left => "Left".to_string(),
                    Hemisphere::Right => "Right".to_string(),
                    Hemisphere::Bilateral => "Bilateral".to_string(),
                }),
                network: l.network.as_ref().map(|n| n.name.clone()),
            })
            .collect();

        let n_regions = label_info.len();

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Complete,
            progress: 1.0,
            message: "Surface atlas loaded successfully".to_string(),
        });

        {
            let mut catalog = self.catalog.write().await;
            let _ = catalog.mark_used(&config.atlas_id);
        }

        Ok(SurfaceAtlasLoadResult {
            atlas_metadata: AtlasMetadata {
                id: config.atlas_id,
                name: format!("Glasser 2016 (HCP-MMP1.0) - {} surface", surf_type),
                description: "Human Connectome Project Multi-Modal Parcellation (360 areas) on surface".to_string(),
                n_regions,
                space: "fsaverage".to_string(),
                resolution: "surface".to_string(),
                citation: Some("Glasser et al. (2016). A multi-modal parcellation of human cerebral cortex. Nature.".to_string()),
                bounds_mm: None,
                data_range: None,
            },
            labels_lh,
            labels_rh,
            label_info,
            space: "fsaverage".to_string(),
            n_vertices_lh,
            n_vertices_rh,
        })
    }

    /// Load the Schaefer 2018 surface atlas
    async fn load_schaefer_surface_atlas(
        &self,
        config: AtlasConfig,
    ) -> Result<SurfaceAtlasLoadResult, AtlasError> {
        let parcels = config.parcels.unwrap_or(400);
        let networks = config.networks.unwrap_or(7) as u32;
        let surf_type = config.surf_type.as_deref().unwrap_or("pial");
        let surf_type_owned = surf_type.to_string();
        let atlas_id = config.atlas_id.clone();

        self.send_progress(AtlasLoadProgress {
            atlas_id: atlas_id.clone(),
            stage: LoadingStage::Downloading,
            progress: 0.3,
            message: format!(
                "Downloading Schaefer surface atlas ({} parcels, {} networks, {} surface)...",
                parcels, networks, surf_type
            ),
        });

        let mut atlas_result =
            Self::load_schaefer_surface_atlas_once(parcels, networks, surf_type_owned.clone())
                .await;
        if let Err(err) = &atlas_result {
            if Self::should_retry_after_surface_cache_repair(err) {
                warn!(
                    "Schaefer surface atlas load failed with likely corrupted fsaverage cache, retrying once: {}",
                    err
                );
                self.repair_fsaverage_surface_cache(&atlas_id, surf_type)
                    .await;
                atlas_result =
                    Self::load_schaefer_surface_atlas_once(parcels, networks, surf_type_owned)
                        .await;
            }
        }

        let atlas_result = match atlas_result {
            Ok(result) => result,
            Err(e) => {
                self.send_progress(AtlasLoadProgress {
                    atlas_id: atlas_id.clone(),
                    stage: LoadingStage::Error,
                    progress: 0.0,
                    message: format!("Failed to load fsaverage geometry: {}", e),
                });
                return Err(e);
            }
        };

        let (lh_atlas, rh_atlas) = atlas_result;

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Processing,
            progress: 0.8,
            message: "Processing surface labels...".to_string(),
        });

        let labels_lh = lh_atlas.labels.to_vec();
        let labels_rh = rh_atlas.labels.to_vec();
        let n_vertices_lh = lh_atlas.n_vertices();
        let n_vertices_rh = rh_atlas.n_vertices();

        let mut label_info_map = std::collections::HashMap::new();
        for l in lh_atlas.label_info.iter().chain(rh_atlas.label_info.iter()) {
            label_info_map
                .entry(l.id)
                .or_insert_with(|| SurfaceAtlasLabelInfo {
                    id: l.id,
                    name: l.name.clone(),
                    color: l.color,
                    hemisphere: l.hemisphere.as_ref().map(|h| match h {
                        Hemisphere::Left => "Left".to_string(),
                        Hemisphere::Right => "Right".to_string(),
                        Hemisphere::Bilateral => "Bilateral".to_string(),
                    }),
                    network: l.network.as_ref().map(|n| n.name.clone()),
                });
        }
        let mut label_info: Vec<SurfaceAtlasLabelInfo> = label_info_map.into_values().collect();
        label_info.sort_by_key(|l| l.id);

        let n_regions = label_info.len();

        self.send_progress(AtlasLoadProgress {
            atlas_id: config.atlas_id.clone(),
            stage: LoadingStage::Complete,
            progress: 1.0,
            message: "Surface atlas loaded successfully".to_string(),
        });

        {
            let mut catalog = self.catalog.write().await;
            let _ = catalog.mark_used(&config.atlas_id);
        }

        Ok(SurfaceAtlasLoadResult {
            atlas_metadata: AtlasMetadata {
                id: config.atlas_id,
                name: format!(
                    "Schaefer 2018 ({} parcels, {} networks) {} surface",
                    parcels, networks, surf_type
                ),
                description: "Cortical parcellations based on connectivity gradients (surface)"
                    .to_string(),
                n_regions,
                space: "fsaverage".to_string(),
                resolution: "surface".to_string(),
                citation: Some("Schaefer et al. (2018). Local-Global Parcellation of the Human Cerebral Cortex. Cerebral Cortex.".to_string()),
                bounds_mm: None,
                data_range: None,
            },
            labels_lh,
            labels_rh,
            label_info,
            space: "fsaverage".to_string(),
            n_vertices_lh,
            n_vertices_rh,
        })
    }
}

/// Implement Drop to ensure proper cleanup of resources
impl Drop for AtlasService {
    fn drop(&mut self) {
        self.cleanup();
    }
}

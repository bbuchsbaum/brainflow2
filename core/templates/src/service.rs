/*!
 * Template Service - handles template loading and management operations
 */

use crate::catalog::TemplateCatalog;
use crate::types::*;
use bridge_types::{Loader, TimeSeriesInfo, VolumeHandleInfo, VolumeType};
use reqwest;
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, info};
use uuid::Uuid;
use volmath::NeuroSpaceExt;

/// Service for managing template operations
pub struct TemplateService {
    catalog: Arc<RwLock<TemplateCatalog>>,
    progress_tx: broadcast::Sender<TemplateLoadProgress>,
    cache_dir: std::path::PathBuf,
    http_client: reqwest::Client,
    // Track active subscriptions for proper cleanup
    active_subscriptions: Arc<std::sync::atomic::AtomicUsize>,
}

impl TemplateService {
    /// Create a new template service
    pub fn new(cache_dir: std::path::PathBuf) -> Result<Self, TemplateError> {
        let (progress_tx, _) = broadcast::channel(32);

        // Validate and canonicalize the cache directory path
        let cache_dir = Self::sanitize_cache_dir(cache_dir)?;

        // Create templates subdirectory in cache
        let template_cache_dir = cache_dir.join("templates");

        let http_client = reqwest::Client::builder()
            .user_agent("Brainflow2/1.0")
            .timeout(std::time::Duration::from_secs(300)) // 5 minutes for large downloads
            .build()
            .map_err(|e| {
                TemplateError::LoadFailed(format!("Failed to create HTTP client: {}", e))
            })?;

        Ok(Self {
            catalog: Arc::new(RwLock::new(TemplateCatalog::new())),
            progress_tx,
            cache_dir: template_cache_dir,
            http_client,
            active_subscriptions: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        })
    }

    /// Sanitize and validate cache directory path
    fn sanitize_cache_dir(
        cache_dir: std::path::PathBuf,
    ) -> Result<std::path::PathBuf, TemplateError> {
        // Create the directory if it doesn't exist
        if !cache_dir.exists() {
            std::fs::create_dir_all(&cache_dir).map_err(|e| {
                TemplateError::IoError(format!("Failed to create cache directory: {}", e))
            })?;
        }

        // Convert to absolute path to resolve any relative components
        let abs_path = cache_dir.canonicalize().map_err(|e| {
            TemplateError::PathSecurityViolation(format!(
                "Failed to canonicalize cache directory: {}",
                e
            ))
        })?;

        // Check for directory traversal attempts
        for component in cache_dir.components() {
            match component {
                Component::ParentDir => {
                    return Err(TemplateError::PathSecurityViolation(
                        "Parent directory traversal (..) not allowed in cache path".to_string(),
                    ));
                }
                Component::CurDir => continue,
                Component::Normal(_) | Component::RootDir | Component::Prefix(_) => continue,
            }
        }

        info!("Template cache directory validated: {}", abs_path.display());
        Ok(abs_path)
    }

    /// Get the complete template catalog
    pub async fn get_catalog(&self) -> Result<Vec<TemplateCatalogEntry>, TemplateError> {
        let catalog = self.catalog.read().await;
        Ok(catalog.get_all())
    }

    /// Get filtered template entries
    pub async fn get_filtered_templates(
        &self,
        filter: &TemplateFilter,
    ) -> Result<Vec<TemplateCatalogEntry>, TemplateError> {
        let catalog = self.catalog.read().await;
        Ok(catalog.get_filtered(filter))
    }

    /// Get a specific template entry by ID
    pub async fn get_template_entry(
        &self,
        template_id: &str,
    ) -> Result<Option<TemplateCatalogEntry>, TemplateError> {
        let catalog = self.catalog.read().await;
        Ok(catalog.get_by_id(template_id).cloned())
    }

    /// Get templates organized for menu building
    pub async fn get_menu_structure(
        &self,
    ) -> Result<
        HashMap<TemplateSpace, HashMap<TemplateType, Vec<TemplateCatalogEntry>>>,
        TemplateError,
    > {
        let catalog = self.catalog.read().await;
        Ok(catalog.get_organized_for_menu())
    }

    /// Validate a template configuration
    pub async fn validate_config(&self, config: &TemplateConfig) -> Result<bool, TemplateError> {
        let catalog = self.catalog.read().await;
        let template_id = config.id();

        match catalog.get_by_id(&template_id) {
            Some(_) => Ok(true),
            None => Err(TemplateError::TemplateNotFound(template_id)),
        }
    }

    /// Load a template with the given configuration
    pub async fn load_template(
        &self,
        config: TemplateConfig,
    ) -> Result<TemplateLoadResult, TemplateError> {
        let template_id = config.id();
        info!("Loading template: {}", template_id);

        // Emit loading started progress
        self.emit_progress(
            &template_id,
            LoadingStage::CheckingCache,
            0.0,
            "Checking cache...",
        )
        .await;

        // Get template entry from catalog
        let entry = {
            let catalog = self.catalog.read().await;
            catalog
                .get_by_id(&template_id)
                .ok_or_else(|| TemplateError::TemplateNotFound(template_id.clone()))?
                .clone()
        };

        // Check if template is cached
        let cache_path = self.get_cache_path(&template_id)?;

        if !cache_path.exists() {
            // Download template if not cached
            self.download_template(&entry, &cache_path).await?;

            // Mark as cached in catalog
            let mut catalog = self.catalog.write().await;
            catalog.mark_as_cached(&template_id);
        } else {
            info!("Template {} found in cache", template_id);
        }

        // Update last accessed time
        {
            let mut catalog = self.catalog.write().await;
            catalog.update_last_accessed(&template_id);
        }

        // Emit loading stage
        self.emit_progress(
            &template_id,
            LoadingStage::Loading,
            0.8,
            "Loading template data...",
        )
        .await;

        // Load the actual volume from the cached file
        let volume_handle_info = self.load_template_volume(&template_id, &cache_path).await?;

        // Create template metadata with actual volume information
        let template_metadata = TemplateMetadata {
            id: template_id.clone(),
            name: entry.name.clone(),
            description: entry.description.clone(),
            space: config.space.as_str().to_string(),
            resolution: config.resolution.as_str().to_string(),
            template_type: config.template_type.as_str().to_string(),
            bounds_mm: None,  // Could be calculated from volume bounds if needed
            data_range: None, // Could be calculated from volume data if needed
        };

        // Emit completion
        self.emit_progress(
            &template_id,
            LoadingStage::Complete,
            1.0,
            "Template loaded successfully",
        )
        .await;

        // Return the actual volume handle info
        let result = TemplateLoadResult {
            template_metadata,
            volume_handle_info,
        };

        Ok(result)
    }

    /// Download template from remote URL
    async fn download_template(
        &self,
        entry: &TemplateCatalogEntry,
        cache_path: &Path,
    ) -> Result<(), TemplateError> {
        let download_url = entry.download_url.as_ref().ok_or_else(|| {
            TemplateError::DownloadFailed("No download URL available".to_string())
        })?;

        info!("Downloading template from: {}", download_url);

        // Create parent directory if it doesn't exist
        if let Some(parent) = cache_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                TemplateError::IoError(format!("Failed to create cache directory: {}", e))
            })?;
        }

        // Emit download progress
        self.emit_progress(
            &entry.id,
            LoadingStage::Downloading,
            0.1,
            "Starting download...",
        )
        .await;

        // Download the file
        let response = self
            .http_client
            .get(download_url)
            .send()
            .await
            .map_err(|e| TemplateError::DownloadFailed(format!("HTTP request failed: {}", e)))?;

        if !response.status().is_success() {
            return Err(TemplateError::DownloadFailed(format!(
                "HTTP error {}: {}",
                response.status(),
                response.status().canonical_reason().unwrap_or("Unknown")
            )));
        }

        let total_size = response.content_length().unwrap_or(0);
        let mut downloaded = 0;

        // Create temporary file
        let temp_path = cache_path.with_extension(".tmp");
        let mut temp_file = tokio::fs::File::create(&temp_path)
            .await
            .map_err(|e| TemplateError::IoError(format!("Failed to create temp file: {}", e)))?;

        // Stream download with progress updates
        let mut stream = response.bytes_stream();
        use futures::StreamExt;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| {
                TemplateError::DownloadFailed(format!("Download stream error: {}", e))
            })?;

            temp_file
                .write_all(&chunk)
                .await
                .map_err(|e| TemplateError::IoError(format!("Failed to write chunk: {}", e)))?;

            downloaded += chunk.len();

            if total_size > 0 {
                let progress = 0.1 + (downloaded as f32 / total_size as f32) * 0.6; // 0.1 to 0.7 for download
                self.emit_progress(
                    &entry.id,
                    LoadingStage::Downloading,
                    progress,
                    &format!(
                        "Downloaded {:.1} MB of {:.1} MB",
                        downloaded as f64 / 1024.0 / 1024.0,
                        total_size as f64 / 1024.0 / 1024.0
                    ),
                )
                .await;
            }
        }

        // Flush and close the temp file
        temp_file
            .flush()
            .await
            .map_err(|e| TemplateError::IoError(format!("Failed to flush temp file: {}", e)))?;
        drop(temp_file);

        // Move temp file to final location
        fs::rename(&temp_path, cache_path).map_err(|e| {
            TemplateError::IoError(format!("Failed to move temp file to cache: {}", e))
        })?;

        info!("Template downloaded successfully: {}", cache_path.display());
        Ok(())
    }

    /// Load a template volume from the cached file
    async fn load_template_volume(
        &self,
        template_id: &str,
        cache_path: &Path,
    ) -> Result<VolumeHandleInfo, TemplateError> {
        info!("Loading template volume from: {}", cache_path.display());

        // Validate that the file exists and is loadable
        if !cache_path.exists() {
            return Err(TemplateError::IoError(format!(
                "Template file not found: {}",
                cache_path.display()
            )));
        }

        if !brainflow_loaders::is_loadable(cache_path) {
            return Err(TemplateError::IoError(format!(
                "Template file format not supported: {}",
                cache_path.display()
            )));
        }

        // Load the volume data using the same logic as load_file
        let (volume_sendable, _affine) =
            nifti_loader::load_nifti_volume_auto(cache_path).map_err(|e| {
                TemplateError::IoError(format!(
                    "Failed to load template volume {}: {}",
                    cache_path.display(),
                    e
                ))
            })?;

        // Extract metadata from the loaded volume
        let loaded_data = nifti_loader::NiftiLoader::load(cache_path).map_err(|e| {
            TemplateError::IoError(format!(
                "Failed to load template metadata for {}: {}",
                cache_path.display(),
                e
            ))
        })?;

        let (dims, dtype) = match loaded_data {
            bridge_types::Loaded::Volume { dims, dtype, .. } => (dims, dtype),
            _ => {
                return Err(TemplateError::IoError(
                    "Only volume files are supported for templates.".to_string(),
                ));
            }
        };

        // Determine if this is a 4D volume by checking the VolumeSendable
        let (volume_type, time_series_info) = match &volume_sendable {
            bridge_types::VolumeSendable::VolF32(vol, _) => {
                let vol_dims = vol.space().dims();
                if vol_dims.len() > 3 && vol_dims[3] > 1 {
                    (
                        VolumeType::TimeSeries4D,
                        Some(TimeSeriesInfo {
                            num_timepoints: vol_dims[3],
                            tr: None,
                            temporal_unit: None,
                            acquisition_time: None,
                        }),
                    )
                } else {
                    (VolumeType::Volume3D, None)
                }
            }
            // For other types, assume 3D for now
            _ => (VolumeType::Volume3D, None),
        };

        // Generate a unique handle ID for the template
        let handle_id = format!("template_{}", Uuid::new_v4());

        // Get template name from the file path
        let template_name = cache_path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or(template_id);

        // Create and return the volume handle info
        Ok(VolumeHandleInfo {
            id: handle_id,
            name: template_name.to_string(),
            dims: dims.iter().map(|&d| d as usize).collect(),
            dtype,
            volume_type,
            num_timepoints: time_series_info.as_ref().map(|ts| ts.num_timepoints),
            current_timepoint: None,
            time_series_info,
        })
    }

    /// Get cache path for a template
    pub fn get_cache_path(&self, template_id: &str) -> Result<std::path::PathBuf, TemplateError> {
        // Sanitize template ID to prevent path traversal
        let sanitized_id = template_id.replace(['/', '\\'], "_").replace("..", "_");
        let filename = format!("{}.nii.gz", sanitized_id);
        Ok(self.cache_dir.join(filename))
    }

    /// Emit progress update
    async fn emit_progress(
        &self,
        template_id: &str,
        stage: LoadingStage,
        progress: f32,
        message: &str,
    ) {
        let progress_update = TemplateLoadProgress {
            template_id: template_id.to_string(),
            stage,
            progress,
            message: message.to_string(),
        };

        if let Err(e) = self.progress_tx.send(progress_update) {
            debug!("No active progress subscribers: {}", e);
        }
    }

    /// Subscribe to progress updates
    pub fn subscribe_progress(&self) -> broadcast::Receiver<TemplateLoadProgress> {
        self.active_subscriptions
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.progress_tx.subscribe()
    }

    /// Get current number of progress subscriptions (for debugging)
    pub fn get_subscription_count(&self) -> usize {
        self.active_subscriptions
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Get cache statistics
    pub async fn get_cache_stats(&self) -> Result<TemplateCacheStats, TemplateError> {
        let mut cached_templates = Vec::new();
        let mut total_size = 0u64;
        let mut file_count = 0;

        if self.cache_dir.exists() {
            let mut entries = fs::read_dir(&self.cache_dir).map_err(|e| {
                TemplateError::IoError(format!("Failed to read cache directory: {}", e))
            })?;

            while let Some(entry) = entries.next() {
                let entry = entry.map_err(|e| {
                    TemplateError::IoError(format!("Failed to read directory entry: {}", e))
                })?;

                if entry
                    .file_type()
                    .map_err(|e| TemplateError::IoError(format!("Failed to get file type: {}", e)))?
                    .is_file()
                {
                    let metadata = entry.metadata().map_err(|e| {
                        TemplateError::IoError(format!("Failed to get file metadata: {}", e))
                    })?;

                    total_size += metadata.len();
                    file_count += 1;

                    // Extract template ID from filename
                    if let Some(filename) = entry.file_name().to_str() {
                        if let Some(template_id) = filename.strip_suffix(".nii.gz") {
                            cached_templates.push(template_id.to_string());
                        }
                    }
                }
            }
        }

        Ok(TemplateCacheStats {
            total_size_bytes: total_size,
            file_count,
            cached_templates,
        })
    }

    /// Clear template cache
    pub async fn clear_cache(&self) -> Result<(), TemplateError> {
        if self.cache_dir.exists() {
            fs::remove_dir_all(&self.cache_dir)
                .map_err(|e| TemplateError::CacheError(format!("Failed to clear cache: {}", e)))?;

            fs::create_dir_all(&self.cache_dir).map_err(|e| {
                TemplateError::CacheError(format!("Failed to recreate cache directory: {}", e))
            })?;
        }

        // TODO: reset per-entry cached status in catalog when a reset API exists.

        info!("Template cache cleared");
        Ok(())
    }
}

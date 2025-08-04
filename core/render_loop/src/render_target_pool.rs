/// Render Target Pool - LRU cache for offscreen render targets
///
/// This module implements render target pooling to avoid expensive GPU texture
/// creation/destruction during frequent resize operations. It uses an LRU strategy
/// to cache render targets by (width, height, format) dimensions.
use std::collections::{HashMap, VecDeque};
use wgpu;

/// Key for identifying render targets by their properties
#[derive(Clone, Debug, Hash, PartialEq, Eq)]
pub struct RenderTargetKey {
    pub width: u32,
    pub height: u32,
    pub format: wgpu::TextureFormat,
}

impl RenderTargetKey {
    pub fn new(width: u32, height: u32, format: wgpu::TextureFormat) -> Self {
        Self {
            width,
            height,
            format,
        }
    }
}

/// Cached render target entry
pub struct RenderTargetEntry {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    /// Track when this entry was last accessed for LRU eviction
    pub last_used: std::time::Instant,
}

impl RenderTargetEntry {
    fn new(texture: wgpu::Texture, view: wgpu::TextureView) -> Self {
        Self {
            texture,
            view,
            last_used: std::time::Instant::now(),
        }
    }

    /// Update last used time
    pub fn touch(&mut self) {
        self.last_used = std::time::Instant::now();
    }
}

/// LRU cache for render targets to avoid expensive GPU texture creation/destruction
pub struct RenderTargetPool {
    /// Cache mapping keys to render targets
    cache: HashMap<RenderTargetKey, RenderTargetEntry>,
    /// LRU order tracking - most recently used at back
    lru_order: VecDeque<RenderTargetKey>,
    /// Maximum number of cached render targets
    max_entries: usize,
    /// GPU device for creating new render targets
    device: std::sync::Arc<wgpu::Device>,
    /// GPU queue for initialization
    queue: std::sync::Arc<wgpu::Queue>,
}

impl RenderTargetPool {
    /// Create a new render target pool
    pub fn new(
        device: std::sync::Arc<wgpu::Device>,
        queue: std::sync::Arc<wgpu::Queue>,
        max_entries: usize,
    ) -> Self {
        Self {
            cache: HashMap::new(),
            lru_order: VecDeque::new(),
            max_entries,
            device,
            queue,
        }
    }

    /// Get or create a render target for the given dimensions
    /// Returns the key to use with get_current_target()
    pub fn ensure_target(
        &mut self,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> Result<(RenderTargetKey, bool), RenderTargetPoolError> {
        let key = RenderTargetKey::new(width, height, format);

        // Check if we have a cached entry
        if self.cache.contains_key(&key) {
            // Move to end of LRU (most recently used)
            self.move_to_back(&key);
            // Update last used time
            if let Some(entry) = self.cache.get_mut(&key) {
                entry.touch();
            }
            return Ok((key, false));
        }

        // Create new render target
        let (texture, view) = self.create_render_target(width, height, format)?;
        let entry = RenderTargetEntry::new(texture, view);

        // Evict oldest entries if we're at capacity
        while self.cache.len() >= self.max_entries {
            self.evict_oldest();
        }

        // Insert new entry
        self.cache.insert(key.clone(), entry);
        self.lru_order.push_back(key.clone());

        Ok((key, true))
    }

    /// Get references to the current render target by key
    /// This should be called after ensure_target() with the returned key
    pub fn get_current_target(
        &self,
        key: &RenderTargetKey,
    ) -> Option<(&wgpu::Texture, &wgpu::TextureView)> {
        self.cache
            .get(key)
            .map(|entry| (&entry.texture, &entry.view))
    }

    /// Create a new render target with the specified dimensions
    fn create_render_target(
        &self,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> Result<(wgpu::Texture, wgpu::TextureView), RenderTargetPoolError> {
        if width == 0 || height == 0 {
            return Err(RenderTargetPoolError::InvalidDimensions { width, height });
        }

        // Create the offscreen texture
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("Pooled Render Target {}x{}", width, height)),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Clear the texture to ensure it starts clean
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Clear Pooled Render Target"),
            });

        {
            let _render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Clear Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
            });
            // Just begin and end the pass to clear the texture
        }

        self.queue.submit(std::iter::once(encoder.finish()));

        Ok((texture, view))
    }

    /// Move a key to the back of the LRU order (mark as most recently used)
    fn move_to_back(&mut self, key: &RenderTargetKey) {
        // Remove from current position and add to back
        self.lru_order.retain(|k| k != key);
        self.lru_order.push_back(key.clone());
    }

    /// Evict the oldest (least recently used) entry
    fn evict_oldest(&mut self) {
        if let Some(oldest_key) = self.lru_order.pop_front() {
            self.cache.remove(&oldest_key);
            log::info!(
                "Evicted render target: {}x{}",
                oldest_key.width,
                oldest_key.height
            );
        }
    }

    /// Get cache statistics
    pub fn stats(&self) -> RenderTargetPoolStats {
        RenderTargetPoolStats {
            cached_entries: self.cache.len(),
            max_entries: self.max_entries,
            cache_utilization: self.cache.len() as f32 / self.max_entries as f32,
        }
    }

    /// Clear all cached render targets
    pub fn clear(&mut self) {
        self.cache.clear();
        self.lru_order.clear();
    }
}

/// Statistics for render target pool
#[derive(Debug)]
pub struct RenderTargetPoolStats {
    pub cached_entries: usize,
    pub max_entries: usize,
    pub cache_utilization: f32,
}

/// Errors that can occur in render target pool operations
#[derive(Debug, thiserror::Error)]
pub enum RenderTargetPoolError {
    #[error("Invalid render target dimensions: {width}x{height}. Dimensions must be non-zero.")]
    InvalidDimensions { width: u32, height: u32 },

    #[error("GPU error while creating render target: {details}")]
    GpuError { details: String },
}

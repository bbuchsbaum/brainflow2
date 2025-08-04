// NOTE: Future Tauri Integration Consideration
//
// The current implementation uses offscreen rendering to avoid complications with
// passing window handles between Tauri and wgpu. This approach works well but
// involves CPU-GPU data transfer overhead.
//
// If future Tauri versions provide better WebGPU integration (e.g., direct access
// to the webview's rendering context or a built-in way to create wgpu surfaces
// from webview canvases), we should revisit the direct surface rendering approach
// for better performance.
//
// The ideal solution would be to render directly to a canvas element in the webview
// without the need for image data transfer. Keep monitoring Tauri's WebGPU support
// for such improvements.

use crate::view_state::{FrameResult, ViewContext, ViewId, ViewState};
use nalgebra::Matrix4;
use raw_window_handle::{HasDisplayHandle, HasWindowHandle}; // Add for surface creation
use std::collections::HashMap;
use std::sync::Arc; // Re-add Arc import
use thiserror::Error; // Add for error handling
use volmath::{DataRange, DenseVolume3, NeuroSpaceExt, NumericType, VoxelData}; // Import DataRange directly
use wgpu;
use wgpu::util::DeviceExt; // For create_buffer_init helper trait

// --- Modules ---
pub mod benchmarks;
pub mod layer_storage;
pub mod layer_uniforms;
pub mod layer_uniforms_optimized;
pub mod multi_texture_manager;
pub mod optimized_renderer;
pub mod pipeline;
pub mod render_state;
pub mod render_target_pool;
pub mod shader_watcher;
pub mod shaders;
pub mod slice_adapter;
pub mod slice_variant;
pub mod smart_texture_manager;
pub mod texture_manager;
pub mod transform_validator;
pub mod ubo;
pub mod view_state;

pub mod test_fixtures;

// Re-export commonly used types from ubo module
pub use ubo::{CrosshairUbo, CrosshairUboUpdated, FrameUbo, LayerUboStd140, ViewPlaneUbo};
// Re-export render state types for external use
pub use render_state::{BlendMode, LayerInfo, ThresholdMode};
// Re-export slice adapter for GPU-CPU differential testing
pub use slice_adapter::{GpuSliceAdapter, SliceSpecMapper};
// Re-export benchmarking utilities
pub use benchmarks::{FrameTimeTracker, PerformanceComparison, RenderPassProfiler};
// Re-export optimized renderer
use layer_uniforms::LayerUniformManager;
use multi_texture_manager::MultiTextureManager;
pub use optimized_renderer::{OptimizedRenderer, PerformanceMonitor};
use pipeline::{PipelineKey, PipelineManager};
use render_state::{FrameStats, LayerStateManager, RenderPassManager, RenderState};
use render_target_pool::RenderTargetPool;
use shader_watcher::{ShaderWatchEvent, ShaderWatcher};
use shaders::ShaderManager;
use texture_manager::TextureManager;

// External logging
extern crate log;

/// Convert nalgebra Matrix4 to column-major array for GPU upload
/// WGSL expects matrices in column-major order, but nalgebra's Into trait
/// produces row-major order, so we need to manually extract columns.
fn matrix_to_cols_array(m: &Matrix4<f32>) -> [[f32; 4]; 4] {
    // Explicitly extract columns to ensure correct column-major layout
    // Each inner array is a column of the matrix
    [
        [m[(0, 0)], m[(1, 0)], m[(2, 0)], m[(3, 0)]], // Column 0
        [m[(0, 1)], m[(1, 1)], m[(2, 1)], m[(3, 1)]], // Column 1
        [m[(0, 2)], m[(1, 2)], m[(2, 2)], m[(3, 2)]], // Column 2
        [m[(0, 3)], m[(1, 3)], m[(2, 3)], m[(3, 3)]], // Column 3 - translation
    ]
}

#[derive(Error, Debug)]
pub enum RenderLoopError {
    #[error("Failed to find suitable WGPU adapter")]
    AdapterNotFound,
    #[error("Failed to request WGPU adapter")]
    AdapterRequestFailed,
    #[error("Failed to get WGPU device: {0}")]
    DeviceRequestFailed(#[from] wgpu::RequestDeviceError),
    #[error("Texture atlas is full")]
    AtlasFull,
    #[error("Failed to get slice data: {0}")]
    SliceRetrievalFailed(String),
    #[error("Unsupported volume format for atlas upload: {0:?}")]
    UnsupportedVolumeFormat(NumericType),
    #[error("Volume dimensions ({width}x{height}) exceed atlas dimensions ({atlas_width}x{atlas_height})")]
    SliceTooLarge {
        width: u32,
        height: u32,
        atlas_width: u32,
        atlas_height: u32,
    },
    #[error("Surface creation failed: {0}")]
    SurfaceCreationFailed(#[from] wgpu::CreateSurfaceError),
    #[error("Surface is not configured or is missing")]
    SurfaceNotConfigured,
    #[error("No compatible surface format found")]
    SurfaceFormatNotFound,
    #[error("Surface error: {0:?}")]
    SurfaceError(#[from] wgpu::SurfaceError),
    #[error("Internal error: {details} (code: {code})")]
    Internal { code: u16, details: String },
}

// --- Texture Atlas ---

pub struct TextureAtlas {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    format: wgpu::TextureFormat,
    size: wgpu::Extent3d,
    is_3d: bool,           // Track if this is a 3D texture
    free_layers: Vec<u32>, // Track available layers (for 2D array mode)
}

impl TextureAtlas {
    /// Creates a new 3D Texture Atlas for volume rendering.
    pub fn new_3d(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        size: wgpu::Extent3d,
        label: Option<&str>,
    ) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label,
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D3, // 3D texture
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D3), // View as 3D
            ..Default::default()
        });

        Self {
            texture,
            view,
            format,
            size,
            is_3d: true,
            free_layers: vec![], // Not used for 3D textures
        }
    }

    /// Creates a new 2D Array Texture Atlas (legacy mode).
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        size: wgpu::Extent3d,
        label: Option<&str>,
    ) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label,
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[], // Add view formats if needed later
        });

        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2Array), // View as 2D Array
            ..Default::default()
        });

        // Initialize free layers list with all indices
        let free_layers = (0..size.depth_or_array_layers).collect();

        Self {
            texture,
            view,
            format,
            size,
            is_3d: false,
            free_layers,
        }
    }

    /// Allocates the next available layer index from the atlas.
    /// Returns `None` if the atlas is full.
    pub fn allocate_layer(&mut self) -> Option<u32> {
        // if self.next_free_layer < self.size.depth_or_array_layers { // Old logic
        //     let layer_index = self.next_free_layer;
        //     self.next_free_layer += 1;
        //     println!("Allocated atlas layer: {}", layer_index);
        //     Some(layer_index)
        // } else {
        //     println!("Texture atlas is full!");
        //     None
        // }
        let layer_index = self.free_layers.pop(); // Get the last index from the free list
        if let Some(index) = layer_index {
            println!("Allocated atlas layer: {}", index);
        } else {
            println!("Texture atlas is full!");
        }
        layer_index
    }

    /// Marks a layer index as free and adds it back to the available list.
    /// Ensures no duplicates are added.
    /// Note: Does not clear the texture data in the layer.
    pub fn free_layer(&mut self, layer_index: u32) {
        if layer_index >= self.size.depth_or_array_layers {
            eprintln!(
                "Error: Attempted to free invalid layer index: {}",
                layer_index
            );
            return;
        }
        // Check if the layer is already marked as free to avoid duplicates
        if !self.free_layers.contains(&layer_index) {
            println!("Freeing atlas layer: {}", layer_index);
            self.free_layers.push(layer_index);
        } else {
            eprintln!(
                "Warning: Attempted to free layer {} which is already free.",
                layer_index
            );
        }
    }

    // --- Getters ---
    pub fn texture(&self) -> &wgpu::Texture {
        &self.texture
    }
    pub fn view(&self) -> &wgpu::TextureView {
        &self.view
    }
    pub fn format(&self) -> wgpu::TextureFormat {
        self.format
    }
    pub fn size(&self) -> wgpu::Extent3d {
        self.size
    }
    pub fn layer_count(&self) -> u32 {
        self.size.depth_or_array_layers
    }
}

// --- Volume Metadata ---

/// Metadata for a volume layer
#[derive(Debug, Clone)]
pub struct VolumeMetadata {
    /// Volume dimensions (width, height, depth)
    pub dimensions: (u32, u32, u32),
    /// World to voxel transformation matrix
    pub world_to_voxel: Matrix4<f32>,
    /// Voxel to world transformation matrix
    pub voxel_to_world: Matrix4<f32>,
    /// Volume origin in world coordinates
    pub origin: [f32; 3],
    /// Voxel spacing in mm
    pub spacing: [f32; 3],
    /// Data intensity range (min, max)
    pub data_range: (f32, f32),
}

/// Entry in the volume registry
#[derive(Debug, Clone)]
pub struct VolumeRegistryEntry {
    /// Atlas index for this volume
    pub atlas_index: u32,
    /// Volume metadata
    pub metadata: VolumeMetadata,
    /// Texture format
    pub format: wgpu::TextureFormat,
}

impl Default for VolumeMetadata {
    fn default() -> Self {
        Self {
            dimensions: (256, 256, 128),
            world_to_voxel: Matrix4::identity(),
            voxel_to_world: Matrix4::identity(),
            origin: [0.0, 0.0, 0.0],
            spacing: [1.0, 1.0, 1.0],
            data_range: (0.0, 1.0),
        }
    }
}

// --- RenderLoopService ---

pub struct RenderLoopService {
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: Arc<wgpu::Device>,
    pub queue: Arc<wgpu::Queue>,
    pub volume_atlas: TextureAtlas, // Now mutable via service methods
    pub frame_ubo_buffer: wgpu::Buffer, // ADDED: Frame UBO buffer
    pub crosshair_ubo_buffer: wgpu::Buffer,
    pub global_bind_group_layout: wgpu::BindGroupLayout,
    // --- New fields for surface management --- Make public for BridgeState::default
    pub surface: Option<wgpu::Surface<'static>>, // Use 'static lifetime
    pub surface_config: Option<wgpu::SurfaceConfiguration>,
    // --- Shader management ---
    pub shader_manager: ShaderManager,
    pub shader_watcher: Option<ShaderWatcher>,
    // --- Pipeline management ---
    pub pipeline_manager: PipelineManager,
    // --- Bind group layouts ---
    pub frame_bind_group_layout: Option<wgpu::BindGroupLayout>,
    pub layer_bind_group_layout: Option<wgpu::BindGroupLayout>,
    pub texture_bind_group_layout: Option<wgpu::BindGroupLayout>,
    // --- Render state management ---
    pub render_state: RenderState,
    pub render_pass_manager: RenderPassManager,
    pub layer_state_manager: LayerStateManager,
    // --- Uniform buffer management ---
    pub layer_uniform_manager: LayerUniformManager,
    // --- Texture management ---
    pub texture_manager: TextureManager,
    // --- Multi-texture management for world-space rendering ---
    pub multi_texture_manager: Option<MultiTextureManager>,
    // --- Smart texture management with pooling ---
    pub smart_texture_manager: Option<smart_texture_manager::SmartTextureManager>,
    // --- Layer storage manager for world-space rendering ---
    pub layer_storage_manager: Option<layer_storage::LayerStorageManager>,
    // --- Volume metadata tracking ---
    volume_metadata: HashMap<u32, VolumeMetadata>, // atlas_index -> metadata
    // --- Current texture bind group ---
    texture_bind_group_id: Option<u64>,
    // --- Offscreen render target dimensions (used for backward compatibility) ---
    offscreen_dimensions: (u32, u32),
    // --- Render target pooling ---
    render_target_pool: Option<RenderTargetPool>,
    current_render_target_key: Option<render_target_pool::RenderTargetKey>,
    // --- Current pipeline tracking ---
    current_pipeline: Option<String>,
    // --- View management ---
    views: HashMap<ViewId, ViewContext>,
    // --- World-space rendering mode ---
    world_space_enabled: bool,
    // --- Volume registry - maps volume IDs to their metadata ---
    volumes: HashMap<String, VolumeRegistryEntry>,
}

impl RenderLoopService {
    /// Initializes the core WGPU components.
    ///
    /// This function requests an adapter and device. It does *not* create a surface
    /// or swapchain yet, as that requires a window handle.
    pub async fn new() -> Result<Self, RenderLoopError> {
        println!("RenderLoopService: Initializing WGPU...");

        // 1. Create Instance
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..Default::default()
        });

        // 2. Request Adapter
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .ok_or(RenderLoopError::AdapterRequestFailed)?;

        let adapter_info = adapter.get_info();
        println!("RenderLoopService: Found adapter: {:?}", adapter_info);

        // Check if float32-filterable is supported
        let adapter_features = adapter.features();
        let supports_float32_filterable =
            adapter_features.contains(wgpu::Features::FLOAT32_FILTERABLE);

        if !supports_float32_filterable {
            println!("WARNING: FLOAT32_FILTERABLE feature not supported on this adapter.");
            println!("         Linear filtering of R32Float textures will not work correctly.");
            println!("         Consider using nearest neighbor sampling or R16Float textures.");
        }

        // 3. Request Device and Queue
        let mut required_features = wgpu::Features::TEXTURE_BINDING_ARRAY
            | wgpu::Features::SAMPLED_TEXTURE_AND_STORAGE_BUFFER_ARRAY_NON_UNIFORM_INDEXING;

        // Only request FLOAT32_FILTERABLE if supported
        if supports_float32_filterable {
            required_features |= wgpu::Features::FLOAT32_FILTERABLE;
        }

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("Brainflow Render Device"),
                    required_features,
                    required_limits: wgpu::Limits::default(),
                },
                None, // Trace path
            )
            .await?;

        println!("RenderLoopService: Device and Queue obtained successfully.");

        let device_arc = Arc::new(device);
        let queue_arc = Arc::new(queue);

        // --- Create the default Texture Atlas ---
        // For 3D textures, we need to store actual volume data, not slices
        // Start with a reasonable default size that can hold a typical brain volume
        let atlas_size = wgpu::Extent3d {
            width: 256,
            height: 256,
            depth_or_array_layers: 256, // This is now the Z dimension for 3D texture
        };
        let atlas_format = wgpu::TextureFormat::R16Float;

        let volume_atlas = TextureAtlas::new_3d(
            &device_arc,
            atlas_format,
            atlas_size,
            Some("Volume 3D Texture Atlas"),
        );

        // --- Create the Frame UBO Buffer ---
        let initial_frame_data = FrameUbo::default();
        let frame_ubo_buffer = device_arc.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Frame UBO Buffer"),
            contents: bytemuck::bytes_of(&initial_frame_data),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        println!("RenderLoopService: Frame UBO buffer created.");

        // --- Create the Crosshair UBO Buffer ---
        // Use the updated struct with show_crosshair flag
        let initial_crosshair_data = CrosshairUboUpdated::default();
        let crosshair_ubo_buffer =
            device_arc.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Crosshair UBO Buffer"),
                contents: bytemuck::bytes_of(&initial_crosshair_data),
                // COPY_SRC added for testing read-back
                usage: wgpu::BufferUsages::UNIFORM
                    | wgpu::BufferUsages::COPY_DST
                    | wgpu::BufferUsages::COPY_SRC,
            });
        println!("RenderLoopService: Crosshair UBO buffer created.");

        // --- Create Global Bind Group Layout using the standardized layout ---
        let global_bind_group_layout = shaders::layouts::create_frame_layout(&device_arc);
        println!("RenderLoopService: Global bind group layout created.");

        // Create texture manager and initialize colormaps
        let mut texture_manager = TextureManager::new(&device_arc);
        texture_manager.init_colormaps(&device_arc, &queue_arc);
        // All builtin colormaps are now uploaded automatically

        // Initialize world-space rendering components
        let multi_texture_manager = Some(MultiTextureManager::new(
            multi_texture_manager::MAX_TEXTURES as u32,
        ));
        let mut layer_storage_manager =
            Some(layer_storage::LayerStorageManager::new(&device_arc, 32));

        // Create bind group layouts for world-space rendering
        let frame_bind_group_layout = Some(shaders::layouts::create_frame_layout(&device_arc));
        let layer_bind_group_layout =
            Some(layer_storage::LayerStorageManager::create_bind_group_layout(&device_arc));
        let texture_bind_group_layout = Some(MultiTextureManager::create_bind_group_layout(
            &device_arc,
            multi_texture_manager::MAX_TEXTURES as u32,
        ));

        // Create bind groups for the managers
        if let (Some(ref mut layer_storage), Some(ref layer_layout)) =
            (&mut layer_storage_manager, &layer_bind_group_layout)
        {
            layer_storage.create_bind_group(&device_arc, layer_layout);
        }

        Ok(Self {
            instance,
            adapter,
            device: device_arc.clone(),
            queue: queue_arc,
            volume_atlas,
            frame_ubo_buffer, // ADDED: Store frame UBO
            crosshair_ubo_buffer,
            global_bind_group_layout,
            surface: None,
            surface_config: None,
            shader_manager: ShaderManager::new(),
            shader_watcher: None,
            pipeline_manager: PipelineManager::new(),
            frame_bind_group_layout,
            layer_bind_group_layout,
            texture_bind_group_layout,
            render_state: RenderState::new(),
            render_pass_manager: RenderPassManager::new(),
            layer_state_manager: LayerStateManager::new(8), // Support up to 8 layers
            layer_uniform_manager: LayerUniformManager::new(&device_arc),
            texture_manager,
            multi_texture_manager, // Initialized for world-space rendering
            smart_texture_manager: None, // Will be initialized on demand
            layer_storage_manager, // Initialized for world-space rendering
            volume_metadata: HashMap::new(),
            texture_bind_group_id: None,
            offscreen_dimensions: (0, 0),
            render_target_pool: None, // Will be initialized lazily
            current_render_target_key: None,
            current_pipeline: None,
            views: HashMap::new(),
            world_space_enabled: true, // Default to world-space rendering
            volumes: HashMap::new(),
        })
    }

    /// Creates and configures the WGPU surface using a window handle.
    /// This should be called after the window is available.
    pub fn create_surface(
        &mut self,
        window: Arc<impl HasWindowHandle + HasDisplayHandle + Send + Sync + 'static>,
        initial_width: u32,
        initial_height: u32,
    ) -> Result<(), RenderLoopError> {
        println!("Creating surface for window...");
        let surface = self.instance.create_surface(window)?;

        let surface_caps = surface.get_capabilities(&self.adapter);
        // Find a suitable sRGB format
        let surface_format = surface_caps
            .formats
            .iter()
            .copied()
            .find(|f| f.is_srgb())
            .or_else(|| surface_caps.formats.first().copied())
            .ok_or(RenderLoopError::SurfaceFormatNotFound)?;

        println!("Selected surface format: {:?}", surface_format);

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width: initial_width,
            height: initial_height,
            present_mode: surface_caps
                .present_modes
                .first()
                .copied()
                .unwrap_or(wgpu::PresentMode::Fifo), // Default to Fifo
            alpha_mode: surface_caps
                .alpha_modes
                .first()
                .copied()
                .unwrap_or(wgpu::CompositeAlphaMode::Auto),
            view_formats: vec![],
            desired_maximum_frame_latency: 2, // Added from wgpu 0.19 examples
        };

        surface.configure(&self.device, &config);

        self.surface = Some(surface);
        self.surface_config = Some(config);

        // --- Create Render Pipeline --- (Example - Needs proper setup)
        // self.create_render_pipeline(); // Call helper to create pipeline after surface exists

        println!("Surface created and configured.");
        Ok(())
    }

    /// Load all required shaders with validation
    pub fn load_shaders(&mut self) -> Result<(), RenderLoopError> {
        // Load the world-space shader for multi-texture rendering
        let (_shader, validation) = self
            .shader_manager
            .load_shader_validated(
                &self.device,
                "slice_world_space",
                shaders::sources::SLICE_WORLD_SPACE,
            )
            .map_err(|e| RenderLoopError::Internal {
                code: 9020,
                details: format!("Failed to load slice_world_space shader: {}", e),
            })?;

        // Report world-space shader warnings
        for warning in &validation.warnings {
            println!("Slice world-space shader warning: {}", warning);
        }

        // Load the optimized world-space shader
        let (_shader_opt, validation_opt) = self
            .shader_manager
            .load_shader_validated(
                &self.device,
                "slice_world_space_optimized",
                shaders::sources::SLICE_WORLD_SPACE_OPTIMIZED,
            )
            .map_err(|e| RenderLoopError::Internal {
                code: 9021,
                details: format!("Failed to load slice_world_space_optimized shader: {}", e),
            })?;

        // Report optimized shader warnings
        for warning in &validation_opt.warnings {
            println!("Slice world-space optimized shader warning: {}", warning);
        }

        println!("Shaders loaded and validated successfully.");

        // Initialize colormaps
        self.texture_manager
            .init_colormaps(&self.device, &self.queue);
        println!("Colormaps initialized successfully.");

        Ok(())
    }

    /// Enable shader hot-reload for development
    pub fn enable_shader_hot_reload(&mut self) -> Result<(), RenderLoopError> {
        // Find the shader directory relative to the workspace root
        let shader_dir = if std::path::Path::new("core/render_loop/shaders").exists() {
            "core/render_loop/shaders"
        } else if std::path::Path::new("shaders").exists() {
            "shaders"
        } else {
            return Err(RenderLoopError::Internal {
                code: 9004,
                details: "Could not find shader directory".to_string(),
            });
        };

        let mut watcher = ShaderWatcher::new(shader_dir);
        watcher
            .start_watching()
            .map_err(|e| RenderLoopError::Internal {
                code: 9004,
                details: format!("Failed to start shader watcher: {}", e),
            })?;

        self.shader_watcher = Some(watcher);
        println!("Shader hot-reload enabled.");
        Ok(())
    }

    /// Check for shader updates and reload if necessary
    pub fn check_shader_updates(&mut self) -> Result<bool, RenderLoopError> {
        let mut updated = false;

        if let Some(watcher) = &mut self.shader_watcher {
            let events = watcher.check_events();

            for event in events {
                match event {
                    ShaderWatchEvent::Modified { path, name } => {
                        println!("Shader modified: {} at {:?}", name, path);

                        // Reload the shader with validation
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            match self.shader_manager.load_shader_validated(
                                &self.device,
                                &name,
                                &content,
                            ) {
                                Ok((_shader, validation)) => {
                                    // Report validation warnings
                                    for warning in &validation.warnings {
                                        println!("Shader {} warning: {}", name, warning);
                                    }
                                    println!("Shader {} reloaded successfully", name);
                                }
                                Err(e) => {
                                    // Don't fail the whole update, just report the error
                                    eprintln!("Failed to reload shader {}: {}", name, e);
                                    continue;
                                }
                            }

                            // Clear cached pipelines for this shader
                            self.pipeline_manager.clear_shader_pipelines(&name);
                            updated = true;
                        }
                    }
                    ShaderWatchEvent::Error(e) => {
                        eprintln!("Shader watch error: {}", e);
                    }
                }
            }
        }

        Ok(updated)
    }

    /// Create bind group layouts if not already created
    fn ensure_bind_group_layouts(&mut self) {
        if self.layer_bind_group_layout.is_none() {
            let layout = shaders::layouts::create_layer_layout(&self.device);
            // Create bind group for layer uniforms
            self.layer_uniform_manager
                .create_bind_group(&self.device, &layout);
            self.layer_bind_group_layout = Some(layout);
        }
        if self.texture_bind_group_layout.is_none() {
            // Use 3D layout if we have a 3D texture atlas
            let layout = if self.volume_atlas.is_3d {
                shaders::layouts::create_texture_layout_3d(&self.device)
            } else {
                shaders::layouts::create_texture_layout(&self.device)
            };
            // Create texture bind group
            let bind_group_id = self.texture_manager.create_bind_group(
                &self.device,
                &layout,
                self.volume_atlas.view(),
            );
            self.texture_bind_group_id = Some(bind_group_id);
            self.texture_bind_group_layout = Some(layout);
        }
    }

    /// Ensure a render pipeline exists for the given shader
    pub fn ensure_pipeline(&mut self, shader_name: &str) -> Result<(), RenderLoopError> {
        // Use surface format if available, otherwise use offscreen format
        let surface_format = if let Some(config) = self.surface_config.as_ref() {
            config.format
        } else if self.render_target_pool.is_some() {
            // For offscreen rendering, use RGBA8Unorm (linear color space)
            wgpu::TextureFormat::Rgba8Unorm
        } else {
            return Err(RenderLoopError::SurfaceNotConfigured);
        };

        // Create pipeline key
        let key = PipelineKey::new(shader_name, surface_format);

        println!(
            "ensure_pipeline: Creating pipeline for shader '{}' with format {:?}",
            shader_name, surface_format
        );

        // Check if pipeline already exists
        if self.pipeline_manager.get_pipeline(&key).is_some() {
            println!("ensure_pipeline: Pipeline already exists");
            return Ok(());
        }

        // Ensure bind group layouts exist first
        self.ensure_bind_group_layouts();

        // Get all the immutable references we need
        let shader_name_owned = shader_name.to_string();
        let device = &self.device;
        let global_layout = &self.global_bind_group_layout;
        let layer_layout =
            self.layer_bind_group_layout
                .as_ref()
                .ok_or_else(|| RenderLoopError::Internal {
                    code: 9004,
                    details: "Layer bind group layout not initialized".to_string(),
                })?;
        let texture_layout =
            self.texture_bind_group_layout
                .as_ref()
                .ok_or_else(|| RenderLoopError::Internal {
                    code: 9005,
                    details: "Texture bind group layout not initialized".to_string(),
                })?;

        // Get the shader (immutable borrow), load if not found
        let shader = match self.shader_manager.get_shader(&shader_name_owned) {
            Some(shader) => shader,
            None => {
                println!("WARNING: Shader '{}' not found in cache, attempting to load it", shader_name_owned);
                
                // Try to load the shader on-demand
                let shader_source = match shader_name_owned.as_str() {
                    "slice_world_space" => shaders::sources::SLICE_WORLD_SPACE,
                    "slice_world_space_optimized" => shaders::sources::SLICE_WORLD_SPACE_OPTIMIZED,
                    _ => {
                        return Err(RenderLoopError::Internal {
                            code: 9003,
                            details: format!("Unknown shader '{}' - no source available", shader_name_owned),
                        });
                    }
                };
                
                // Load the shader
                let (shader, validation) = self
                    .shader_manager
                    .load_shader_validated(device, &shader_name_owned, shader_source)
                    .map_err(|e| RenderLoopError::Internal {
                        code: 9004,
                        details: format!("Failed to load shader '{}' on-demand: {}", shader_name_owned, e),
                    })?;
                
                // Report warnings
                for warning in &validation.warnings {
                    println!("On-demand shader '{}' warning: {}", shader_name_owned, warning);
                }
                
                println!("Successfully loaded shader '{}' on-demand", shader_name_owned);
                shader
            }
        };

        // Now work with the pipeline manager
        let bind_group_layouts = vec![global_layout, layer_layout, texture_layout];

        let layout = self.pipeline_manager.get_or_create_layout(
            device,
            &shader_name_owned,
            &bind_group_layouts[..],
        );

        // Create pipeline
        self.pipeline_manager.get_or_create_pipeline(
            device, key, shader, &layout, None, // Use default config
        )?;

        // Track the current pipeline
        self.current_pipeline = Some(shader_name.to_string());

        println!(
            "ensure_pipeline: Successfully created pipeline for shader '{}'",
            shader_name
        );

        Ok(())
    }

    /// Get a render pipeline for the given shader
    pub fn get_pipeline(
        &self,
        shader_name: &str,
    ) -> Result<&wgpu::RenderPipeline, RenderLoopError> {
        // Use surface format if available, otherwise use offscreen format
        let surface_format = if let Some(config) = self.surface_config.as_ref() {
            config.format
        } else if self.render_target_pool.is_some() {
            // For offscreen rendering, use RGBA8Unorm (linear color space)
            wgpu::TextureFormat::Rgba8Unorm
        } else {
            return Err(RenderLoopError::SurfaceNotConfigured);
        };

        let key = PipelineKey::new(shader_name, surface_format);
        self.pipeline_manager
            .get_pipeline(&key)
            .ok_or_else(|| RenderLoopError::Internal {
                code: 9005,
                details: format!("Pipeline for {} not found", shader_name),
            })
    }

    /// Create the render pipeline (exposed for testing)
    pub fn _create_render_pipeline(&mut self) -> Result<(), RenderLoopError> {
        // This now just ensures the pipeline is created and cached
        self.ensure_pipeline("slice")?;
        println!("Render pipeline created successfully.");
        Ok(())
    }

    /// Uploads a single 2D slice from a DenseVolume3 to the next available layer
    /// in the volume texture atlas.
    pub fn upload_slice<T>(
        &mut self,
        source_volume: &DenseVolume3<T>,
        slice_axis: usize,
        slice_index: usize,
    ) -> Result<(u32, f32, f32, f32, f32), RenderLoopError>
    where
        T: VoxelData + num_traits::NumCast + serde::Serialize + DataRange<T>,
    {
        // 1. Check source volume type compatibility
        let _source_format = source_volume.voxel_type();

        // 2. Get slice dimensions
        let vol_dims = source_volume.space.dims();
        let (slice_width, slice_height) = match slice_axis {
            0 => (vol_dims[1], vol_dims[2]), // YZ slice
            1 => (vol_dims[0], vol_dims[2]), // XZ slice
            2 => (vol_dims[0], vol_dims[1]), // XY slice
            _ => panic!("Invalid slice_axis: {}", slice_axis),
        };

        // 3. Check if slice fits within atlas dimensions
        let atlas_dims = self.volume_atlas.size();
        if slice_width as u32 > atlas_dims.width || slice_height as u32 > atlas_dims.height {
            return Err(RenderLoopError::SliceTooLarge {
                width: slice_width as u32,
                height: slice_height as u32,
                atlas_width: atlas_dims.width,
                atlas_height: atlas_dims.height,
            });
        }

        // 4. Get slice data as f16 bytes
        let slice_bytes = source_volume
            .get_slice_as_f16_bytes(slice_axis, slice_index)
            .map_err(|e| {
                RenderLoopError::SliceRetrievalFailed(format!(
                    "Failed to get or convert slice (axis={}, index={}): {}",
                    slice_axis, slice_index, e
                ))
            })?;

        // 5. Allocate a layer in the atlas
        let atlas_layer_index = self
            .volume_atlas
            .allocate_layer()
            .ok_or(RenderLoopError::AtlasFull)?;

        // 6. Upload data to the allocated layer
        self.queue.write_texture(
            // Destination texture view
            wgpu::ImageCopyTexture {
                texture: &self.volume_atlas.texture(),
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: 0,
                    z: atlas_layer_index,
                }, // Write to allocated layer
                aspect: wgpu::TextureAspect::All,
            },
            // Source data
            &slice_bytes,
            // Data layout
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(2 * slice_width as u32), // 2 bytes per f16 pixel
                rows_per_image: Some(slice_height as u32),
            },
            // Size of the slice to copy
            wgpu::Extent3d {
                width: slice_width as u32,
                height: slice_height as u32,
                depth_or_array_layers: 1, // Only copy one layer
            },
        );

        // Store volume metadata for this layer
        // Get the actual affine transforms from the volume's space
        let world_to_voxel = source_volume.space.0.world_to_voxel();
        let voxel_to_world = source_volume.space.0.voxel_to_world();

        // Get spacing and origin for metadata
        let spacing = source_volume.space.0.spacing();
        let origin = source_volume.space.0.origin();

        let metadata = VolumeMetadata {
            dimensions: (vol_dims[0] as u32, vol_dims[1] as u32, vol_dims[2] as u32),
            world_to_voxel,
            voxel_to_world,
            origin: [origin[0], origin[1], origin[2]],
            spacing: [spacing[0], spacing[1], spacing[2]],
            data_range: (0.0, 1.0), // TODO: Get actual range for slice data
        };
        self.volume_metadata.insert(atlas_layer_index, metadata);

        // Calculate texture coordinates (simple placeholder, assumes slice fills the layer)
        let u_min = 0.0;
        let v_min = 0.0;
        let u_max = slice_width as f32 / atlas_dims.width as f32;
        let v_max = slice_height as f32 / atlas_dims.height as f32;

        Ok((atlas_layer_index, u_min, v_min, u_max, v_max))
    }

    /// Uploads a volume to a dedicated 3D texture using multi-texture support
    /// Returns the texture index and world-to-voxel transform
    pub fn upload_volume_multi_texture<T>(
        &mut self,
        source_volume: &DenseVolume3<T>,
        format: wgpu::TextureFormat,
    ) -> Result<(u32, Matrix4<f32>), RenderLoopError>
    where
        T: VoxelData
            + num_traits::NumCast
            + serde::Serialize
            + DataRange<T>
            + num_traits::Zero
            + std::ops::Sub<Output = T>
            + std::ops::Div<Output = T>
            + std::ops::Mul<Output = T>,
    {
        // Initialize multi-texture manager if not already done
        if self.multi_texture_manager.is_none() {
            self.multi_texture_manager = Some(MultiTextureManager::new(
                multi_texture_manager::MAX_TEXTURES as u32,
            ));
        }

        let manager = self.multi_texture_manager.as_mut().unwrap();

        // Upload volume and get texture index and transform
        let (texture_index, world_to_voxel) =
            manager.upload_volume(&self.device, &self.queue, source_volume, format)?;

        Ok((texture_index, world_to_voxel))
    }

    /// Configure the render loop for world-space multi-texture rendering
    pub fn enable_world_space_rendering(&mut self) -> Result<(), RenderLoopError> {
        // Initialize multi-texture manager if needed
        if self.multi_texture_manager.is_none() {
            self.multi_texture_manager = Some(MultiTextureManager::new(
                multi_texture_manager::MAX_TEXTURES as u32,
            ));
        }

        // Load world-space shader
        let (_shader, validation) = self
            .shader_manager
            .load_shader_validated(
                &self.device,
                "slice_world_space",
                shaders::sources::SLICE_WORLD_SPACE,
            )
            .map_err(|e| RenderLoopError::Internal {
                code: 9020,
                details: format!("Failed to load world-space shader: {}", e),
            })?;

        // Report any warnings
        for warning in &validation.warnings {
            println!("World-space shader warning: {}", warning);
        }

        // Create bind group layouts for world-space rendering
        let frame_layout = shaders::layouts::create_frame_layout(&self.device);
        let layer_storage_layout =
            layer_storage::LayerStorageManager::create_bind_group_layout(&self.device);
        let texture_layout = MultiTextureManager::create_bind_group_layout(
            &self.device,
            multi_texture_manager::MAX_TEXTURES as u32,
        );

        // Store layouts for later use
        self.frame_bind_group_layout = Some(frame_layout);
        self.layer_bind_group_layout = Some(layer_storage_layout);
        self.texture_bind_group_layout = Some(texture_layout);

        // Initialize layer storage manager for world-space rendering
        self.layer_storage_manager =
            Some(layer_storage::LayerStorageManager::new(&self.device, 32));

        // Set world-space rendering flag
        self.world_space_enabled = true;

        Ok(())
    }

    /// Initialize the colormap texture
    pub fn initialize_colormap(&mut self) -> Result<(), RenderLoopError> {
        self.texture_manager
            .init_colormaps(&self.device, &self.queue);
        Ok(())
    }

    /// Create bind groups for world-space rendering
    pub fn create_world_space_bind_groups(&mut self) -> Result<(), RenderLoopError> {
        // Ensure world-space rendering is enabled
        if self.multi_texture_manager.is_none() || self.layer_storage_manager.is_none() {
            return Err(RenderLoopError::Internal {
                code: 9021,
                details: "World-space rendering not enabled".to_string(),
            });
        }

        let multi_texture_manager = self.multi_texture_manager.as_mut().unwrap();
        let layer_storage_manager = self.layer_storage_manager.as_mut().unwrap();

        // Create texture bind group
        if let (Some(texture_layout), Some(colormap_view)) = (
            self.texture_bind_group_layout.as_ref(),
            self.texture_manager.colormap_view(),
        ) {
            let linear_sampler = self.texture_manager.linear_sampler();
            let colormap_sampler = self.texture_manager.colormap_sampler();

            multi_texture_manager.create_bind_group(
                &self.device,
                texture_layout,
                linear_sampler,
                colormap_view,
                colormap_sampler,
            )?;
        }

        // Create layer bind group
        if let Some(layer_layout) = self.layer_bind_group_layout.as_ref() {
            layer_storage_manager.create_bind_group(&self.device, layer_layout);
        }

        Ok(())
    }

    /// Uploads a complete 3D volume to the 3D texture atlas or multi-texture manager.
    /// Returns the layer index and the world-to-voxel transform.
    pub fn upload_volume_3d<T>(
        &mut self,
        source_volume: &DenseVolume3<T>,
    ) -> Result<(u32, Matrix4<f32>), RenderLoopError>
    where
        T: VoxelData
            + num_traits::NumCast
            + serde::Serialize
            + DataRange<T>
            + num_traits::Zero
            + std::ops::Sub<Output = T>
            + std::ops::Div<Output = T>
            + std::ops::Mul<Output = T>,
    {
        // Use multi-texture manager for world-space rendering
        if self.world_space_enabled {
            if let Some(ref mut multi_texture_manager) = self.multi_texture_manager {
                // Determine texture format based on data type
                // Use R16Float for all types to ensure filtering support
                let format = match source_volume.voxel_type() {
                    NumericType::U8 => wgpu::TextureFormat::R8Unorm,
                    _ => wgpu::TextureFormat::R16Float, // Use R16Float for everything else to support filtering
                };

                // Upload to multi-texture manager
                let (texture_index, world_to_voxel) = multi_texture_manager.upload_volume(
                    &self.device,
                    &self.queue,
                    source_volume,
                    format,
                )?;

                // Store volume metadata for the texture index
                let vol_dims = source_volume.space.dims();
                let spacing = source_volume.space.0.spacing();
                let origin = source_volume.space.0.origin();

                // Calculate voxel_to_world matrix
                let voxel_to_world = nalgebra::Matrix4::from_row_slice(&[
                    spacing[0], 0.0, 0.0, origin[0], 0.0, spacing[1], 0.0, origin[1], 0.0, 0.0,
                    spacing[2], origin[2], 0.0, 0.0, 0.0, 1.0,
                ]);

                // Get data range
                let (data_min, data_max) = source_volume.range().unwrap_or((
                    num_traits::cast::<f32, T>(0.0).unwrap_or_else(|| panic!("Failed to cast 0.0")),
                    num_traits::cast::<f32, T>(1.0).unwrap_or_else(|| panic!("Failed to cast 1.0")),
                ));

                let metadata = VolumeMetadata {
                    dimensions: (vol_dims[0] as u32, vol_dims[1] as u32, vol_dims[2] as u32),
                    world_to_voxel: world_to_voxel.clone(),
                    voxel_to_world,
                    origin: [origin[0], origin[1], origin[2]],
                    spacing: [spacing[0], spacing[1], spacing[2]],
                    data_range: (
                        num_traits::cast::<T, f32>(data_min).unwrap_or(0.0),
                        num_traits::cast::<T, f32>(data_max).unwrap_or(1.0),
                    ),
                };
                self.volume_metadata.insert(texture_index, metadata);

                // Update texture bind group if needed
                if let (Some(texture_layout), Some(colormap_view)) = (
                    self.texture_bind_group_layout.as_ref(),
                    self.texture_manager.colormap_view(),
                ) {
                    multi_texture_manager.create_bind_group(
                        &self.device,
                        texture_layout,
                        self.texture_manager.linear_sampler(),
                        colormap_view,
                        self.texture_manager.colormap_sampler(),
                    )?;
                }

                return Ok((texture_index, world_to_voxel));
            }
        }
        // Ensure we have a 3D texture atlas
        if !self.volume_atlas.is_3d {
            return Err(RenderLoopError::Internal {
                code: 9010,
                details: "Atlas is not configured for 3D textures".to_string(),
            });
        }

        // Get volume dimensions
        let vol_dims = source_volume.space.dims();
        let (width, height, depth) = (vol_dims[0] as u32, vol_dims[1] as u32, vol_dims[2] as u32);

        // Check if volume fits within atlas dimensions
        let atlas_dims = self.volume_atlas.size();
        if width > atlas_dims.width
            || height > atlas_dims.height
            || depth > atlas_dims.depth_or_array_layers
        {
            return Err(RenderLoopError::Internal {
                code: 9011,
                details: format!(
                    "Volume dimensions {}x{}x{} exceed atlas dimensions {}x{}x{}",
                    width,
                    height,
                    depth,
                    atlas_dims.width,
                    atlas_dims.height,
                    atlas_dims.depth_or_array_layers
                ),
            });
        }

        // Convert entire volume to f16 bytes
        let mut volume_bytes = source_volume.to_f16_bytes();

        // Debug: Check the converted data
        let voxel_count = width as usize * height as usize * depth as usize;
        println!("=== UPLOAD_VOLUME_3D CALLED ===");
        println!(
            "DEBUG: Volume upload - converting {} voxels to f16",
            voxel_count
        );
        println!("DEBUG: Volume dimensions: {}x{}x{}", width, height, depth);
        println!(
            "DEBUG: Original volume bytes size: {} bytes",
            volume_bytes.len()
        );
        println!(
            "DEBUG: Expected size: {} bytes ({}x{}x{} * 2 bytes/pixel)",
            width * height * depth * 2,
            width,
            height,
            depth
        );

        // Sample some values to see what we're uploading
        if volume_bytes.len() >= 8 {
            let sample_f16_bytes = &volume_bytes[0..8];
            println!(
                "DEBUG: First 4 f16 values (as bytes): {:?}",
                sample_f16_bytes
            );
        }

        // Calculate aligned bytes_per_row
        // WebGPU requires bytes_per_row to be aligned to 256 bytes
        let bytes_per_pixel = 2u32; // f16 = 2 bytes
        let unpadded_bytes_per_row = width * bytes_per_pixel;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT; // 256 bytes
        let padded_bytes_per_row = ((unpadded_bytes_per_row + align - 1) / align) * align;

        // Check if unpadded data already meets alignment requirements
        let needs_padding = unpadded_bytes_per_row % align != 0;
        let actual_bytes_per_row = if needs_padding {
            padded_bytes_per_row
        } else {
            unpadded_bytes_per_row
        };

        if !needs_padding {
            println!(
                "DEBUG: No padding needed - unpadded bytes per row ({}) is already aligned to {}",
                unpadded_bytes_per_row, align
            );
        } else {
            println!(
                "DEBUG: Padding required: {} -> {} bytes per row",
                unpadded_bytes_per_row, padded_bytes_per_row
            );
        }

        // If padding is needed, we need to repack the data
        if needs_padding {
            println!(
                "DEBUG: Repacking data with padding: {} -> {} bytes per row",
                unpadded_bytes_per_row, padded_bytes_per_row
            );

            // TEMPORARY: For debugging, let's check if the original data is correct
            println!("DEBUG: First few values before padding:");
            for i in 0..10 {
                if i * 2 + 1 < volume_bytes.len() {
                    let b0 = volume_bytes[i * 2];
                    let b1 = volume_bytes[i * 2 + 1];
                    let f16_bits = u16::from_le_bytes([b0, b1]);
                    println!("  [{}] bytes: [{}, {}] = 0x{:04X}", i, b0, b1, f16_bits);
                }
            }

            let mut padded_data = Vec::new();
            let row_padding = (padded_bytes_per_row - unpadded_bytes_per_row) as usize;

            for z in 0..depth as usize {
                for y in 0..height as usize {
                    let start = (z * height as usize + y) * width as usize * 2;
                    let end = start + (width as usize * 2);
                    padded_data.extend_from_slice(&volume_bytes[start..end]);
                    // Add padding bytes
                    padded_data.extend(vec![0u8; row_padding]);
                }
            }

            volume_bytes = padded_data;
            println!(
                "DEBUG: Padded volume bytes size: {} bytes",
                volume_bytes.len()
            );
        }

        // Upload entire volume to the 3D texture
        // For 3D textures, we always need to specify bytes_per_row and rows_per_image
        // when copying more than one row/slice
        self.queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &self.volume_atlas.texture(),
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &volume_bytes,
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(actual_bytes_per_row),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: depth,
            },
        );

        // Get the actual affine transforms from the volume's space
        let world_to_voxel = source_volume.space.0.world_to_voxel();
        let voxel_to_world = source_volume.space.0.voxel_to_world();

        // Get spacing and origin for metadata
        let spacing = source_volume.space.0.spacing();
        let origin = source_volume.space.0.origin();

        // Get the actual data range from the volume
        let (data_min, data_max) = source_volume
            .range()
            .map(|(min, max)| (min, max))
            .unwrap_or_else(|| {
                // If range is not available, use a reasonable default based on the data type
                // For most medical imaging data, 0-1 is a reasonable default for normalized data
                // The actual values will be cast to f32 below
                if let (Some(zero), Some(one)) = (
                    num_traits::cast::<f32, T>(0.0),
                    num_traits::cast::<f32, T>(1.0),
                ) {
                    (zero, one)
                } else {
                    // This should never happen for standard numeric types
                    panic!("Unable to create default range for type")
                }
            });

        // Store volume metadata
        let metadata = VolumeMetadata {
            dimensions: (width, height, depth),
            world_to_voxel: world_to_voxel.clone(),
            voxel_to_world,
            origin: [origin[0], origin[1], origin[2]],
            spacing: [spacing[0], spacing[1], spacing[2]],
            data_range: (
                num_traits::cast::<T, f32>(data_min).unwrap_or(0.0),
                num_traits::cast::<T, f32>(data_max).unwrap_or(1.0),
            ),
        };
        // For non-world-space rendering, we always use texture index 0
        // This matches what we return at the end of this function
        self.volume_metadata.insert(0, metadata.clone());

        // Calculate world bounds using 8-corner method for debugging
        let corners = [
            [0.0, 0.0, 0.0],
            [metadata.dimensions.0 as f32 - 1.0, 0.0, 0.0],
            [0.0, metadata.dimensions.1 as f32 - 1.0, 0.0],
            [
                metadata.dimensions.0 as f32 - 1.0,
                metadata.dimensions.1 as f32 - 1.0,
                0.0,
            ],
            [0.0, 0.0, metadata.dimensions.2 as f32 - 1.0],
            [
                metadata.dimensions.0 as f32 - 1.0,
                0.0,
                metadata.dimensions.2 as f32 - 1.0,
            ],
            [
                0.0,
                metadata.dimensions.1 as f32 - 1.0,
                metadata.dimensions.2 as f32 - 1.0,
            ],
            [
                metadata.dimensions.0 as f32 - 1.0,
                metadata.dimensions.1 as f32 - 1.0,
                metadata.dimensions.2 as f32 - 1.0,
            ],
        ];

        let mut min_bounds = [f32::INFINITY; 3];
        let mut max_bounds = [f32::NEG_INFINITY; 3];

        for corner in &corners {
            let voxel_point = nalgebra::Point4::new(corner[0], corner[1], corner[2], 1.0);
            let world_point = metadata.voxel_to_world * voxel_point;
            let world_coords = [
                world_point[0] / world_point[3],
                world_point[1] / world_point[3],
                world_point[2] / world_point[3],
            ];

            for i in 0..3 {
                min_bounds[i] = min_bounds[i].min(world_coords[i]);
                max_bounds[i] = max_bounds[i].max(world_coords[i]);
            }
        }

        let world_center = [
            (min_bounds[0] + max_bounds[0]) / 2.0,
            (min_bounds[1] + max_bounds[1]) / 2.0,
            (min_bounds[2] + max_bounds[2]) / 2.0,
        ];

        println!("DEBUG: Uploaded volume metadata:");
        println!("  Dimensions: {:?}", metadata.dimensions);
        println!("  Origin: {:?}", metadata.origin);
        println!("  Spacing: {:?}", metadata.spacing);
        println!(
            "  World bounds: [{:.1}, {:.1}, {:.1}] to [{:.1}, {:.1}, {:.1}]",
            min_bounds[0],
            min_bounds[1],
            min_bounds[2],
            max_bounds[0],
            max_bounds[1],
            max_bounds[2]
        );
        println!(
            "  World center: [{:.1}, {:.1}, {:.1}]",
            world_center[0], world_center[1], world_center[2]
        );
        println!("  Data range: {:?}", metadata.data_range);
        println!("  Voxel_to_world matrix:");
        for i in 0..4 {
            println!(
                "    [{:8.3}, {:8.3}, {:8.3}, {:8.3}]",
                voxel_to_world[(i, 0)],
                voxel_to_world[(i, 1)],
                voxel_to_world[(i, 2)],
                voxel_to_world[(i, 3)]
            );
        }
        println!("  World_to_voxel matrix:");
        for i in 0..4 {
            println!(
                "    [{:8.3}, {:8.3}, {:8.3}, {:8.3}]",
                world_to_voxel[(i, 0)],
                world_to_voxel[(i, 1)],
                world_to_voxel[(i, 2)],
                world_to_voxel[(i, 3)]
            );
        }

        // Test the transform with center coordinates
        let test_world =
            nalgebra::Point4::new(world_center[0], world_center[1], world_center[2], 1.0);
        let test_voxel = world_to_voxel * test_world;
        let test_voxel_coords = [
            test_voxel[0] / test_voxel[3],
            test_voxel[1] / test_voxel[3],
            test_voxel[2] / test_voxel[3],
        ];
        println!(
            "  Transform test: world center [{:.1}, {:.1}, {:.1}] -> voxel [{:.1}, {:.1}, {:.1}]",
            world_center[0],
            world_center[1],
            world_center[2],
            test_voxel_coords[0],
            test_voxel_coords[1],
            test_voxel_coords[2]
        );

        // For identity transform, world should equal voxel
        let expected_voxel_center = [
            (metadata.dimensions.0 as f32 - 1.0) / 2.0,
            (metadata.dimensions.1 as f32 - 1.0) / 2.0,
            (metadata.dimensions.2 as f32 - 1.0) / 2.0,
        ];
        println!(
            "  Expected voxel center: [{:.1}, {:.1}, {:.1}]",
            expected_voxel_center[0], expected_voxel_center[1], expected_voxel_center[2]
        );

        Ok((0, world_to_voxel))
    }

    /// Register a volume with a unique ID and data range for use with ViewState API
    pub fn register_volume_with_range(
        &mut self,
        volume_id: String,
        texture_index: u32,
        data_range: (f32, f32),
    ) -> Result<(), RenderLoopError> {
        // Get metadata from volume_metadata and update data range
        let mut metadata = self
            .volume_metadata
            .get(&texture_index)
            .ok_or_else(|| RenderLoopError::Internal {
                code: 1503,
                details: format!("No metadata found for texture index {}", texture_index),
            })?
            .clone();

        // Update the data range with the actual computed values
        metadata.data_range = data_range;
        println!(
            "register_volume_with_range: Setting data_range to ({}, {})",
            data_range.0, data_range.1
        );

        // Also update volume_metadata with the correct data range
        self.volume_metadata.insert(texture_index, metadata.clone());

        // Register in volumes map
        self.volumes.insert(
            volume_id.clone(),
            VolumeRegistryEntry {
                atlas_index: texture_index,
                metadata,
                format: wgpu::TextureFormat::R32Float, // TODO: Get from actual upload
            },
        );

        Ok(())
    }

    /// Register a volume with a unique ID for use with ViewState API
    pub fn register_volume(
        &mut self,
        volume_id: String,
        texture_index: u32,
    ) -> Result<(), RenderLoopError> {
        // Get metadata from volume_metadata
        let metadata = self
            .volume_metadata
            .get(&texture_index)
            .ok_or_else(|| RenderLoopError::Internal {
                code: 1503,
                details: format!("No metadata found for texture index {}", texture_index),
            })?
            .clone();

        // Register in volumes map
        self.volumes.insert(
            volume_id.clone(),
            VolumeRegistryEntry {
                atlas_index: texture_index,
                metadata,
                format: wgpu::TextureFormat::R32Float, // TODO: Get from actual texture
            },
        );

        Ok(())
    }

    /// Update layer uniforms directly with layer info
    pub fn update_layer_uniforms_direct(
        &mut self,
        layer_infos: &[LayerInfo],
        layer_dims: &[(u32, u32, u32)],
        world_to_voxels: &[Matrix4<f32>],
    ) {
        // Use layer storage manager for world-space rendering
        if let Some(layer_storage) = &mut self.layer_storage_manager {
            if let Some(layout) = &self.layer_bind_group_layout {
                layer_storage.update_layers(
                    &self.device,
                    &self.queue,
                    layout,
                    layer_infos,
                    layer_dims,
                    world_to_voxels,
                );
            }
        }
    }

    /// Release a volume texture and free its GPU resources
    pub fn release_volume(&mut self, texture_index: u32) -> Result<(), RenderLoopError> {
        // Use multi-texture manager for world-space rendering
        if self.world_space_enabled {
            if let Some(ref mut multi_texture_manager) = self.multi_texture_manager {
                // Remove from multi-texture manager
                multi_texture_manager.release_volume(texture_index)?;

                // Remove volume metadata
                self.volume_metadata.remove(&texture_index);

                // Remove from volumes registry
                self.volumes
                    .retain(|_, entry| entry.atlas_index != texture_index);

                // Recreate bind group since textures have changed
                if let (Some(layout), Some(colormap_view)) = (
                    self.texture_bind_group_layout.as_ref(),
                    self.texture_manager.colormap_view(),
                ) {
                    multi_texture_manager.create_bind_group(
                        &self.device,
                        layout,
                        self.texture_manager.nearest_sampler(),
                        colormap_view,
                        self.texture_manager.colormap_sampler(),
                    )?;
                }

                Ok(())
            } else {
                Err(RenderLoopError::Internal {
                    code: 1501,
                    details: "Multi-texture manager not initialized".to_string(),
                })
            }
        } else {
            // Legacy path - not implemented
            Err(RenderLoopError::Internal {
                code: 1502,
                details: "Volume release not supported in legacy mode".to_string(),
            })
        }
    }

    /// Renders a single frame to the configured surface.
    pub fn render(&mut self) -> Result<(), RenderLoopError> {
        // Begin new frame
        self.render_state.begin_frame();

        // Update layer uniforms before rendering
        self.update_all_layer_uniforms()?;

        // Ensure pipeline exists
        self.ensure_pipeline("slice")?;

        let surface = self
            .surface
            .as_ref()
            .ok_or(RenderLoopError::SurfaceNotConfigured)?;

        match surface.get_current_texture() {
            Ok(output) => {
                let view = output
                    .texture
                    .create_view(&wgpu::TextureViewDescriptor::default());
                let mut encoder =
                    self.device
                        .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                            label: Some("Render Encoder"),
                        });

                // --- Create Global Bind Group --- ADDED ---
                let global_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Global Bind Group"),
                    layout: &self.global_bind_group_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: self.frame_ubo_buffer.as_entire_binding(),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: self.crosshair_ubo_buffer.as_entire_binding(),
                        },
                        // ViewPlaneUbo removed - view plane info is now encoded in frame vectors
                    ],
                });

                // Create render pass using the pass manager operations
                let (load_op, store_op) = self.render_pass_manager.get_pass_operations();
                let pass_label = self.render_pass_manager.get_pass_label();

                // Get the pipeline
                let pipeline = self.get_pipeline("slice")?;

                {
                    let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some(&pass_label),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &view,
                            resolve_target: None,
                            ops: wgpu::Operations {
                                load: load_op,
                                store: store_op,
                            },
                        })],
                        depth_stencil_attachment: None,
                        occlusion_query_set: None,
                        timestamp_writes: None,
                    });

                    // Set the render pipeline
                    render_pass.set_pipeline(pipeline);

                    // Set bind groups
                    render_pass.set_bind_group(0, &global_bind_group, &[]);

                    // Set layer bind group if available
                    if let Some(layer_bind_group) = self.layer_uniform_manager.bind_group() {
                        render_pass.set_bind_group(1, layer_bind_group, &[]);
                    }

                    // Set texture bind group
                    if let Some(bind_group_id) = self.texture_bind_group_id {
                        if let Some(texture_bind_group) =
                            self.texture_manager.get_bind_group(bind_group_id)
                        {
                            render_pass.set_bind_group(2, texture_bind_group, &[]);
                        }
                    }

                    // Draw fullscreen quad (6 vertices for 2 triangles)
                    render_pass.draw(0..6, 0..1);
                } // render_pass dropped here

                // Record draw call after render pass is dropped
                self.render_state.record_draw();

                self.queue.submit(std::iter::once(encoder.finish()));
                output.present(); // Present the frame

                // End frame and collect stats
                let _stats = self.render_state.end_frame();

                Ok(())
            }
            // ... existing error handling for surface.get_current_texture() ...
            Err(wgpu::SurfaceError::Lost) => {
                eprintln!("Surface lost! Triggering device loss handling.");
                self.handle_device_loss();
                Err(RenderLoopError::SurfaceError(wgpu::SurfaceError::Lost))
            }
            Err(wgpu::SurfaceError::OutOfMemory) => {
                eprintln!("Surface out of memory! Triggering device loss handling.");
                self.handle_device_loss();
                Err(RenderLoopError::SurfaceError(
                    wgpu::SurfaceError::OutOfMemory,
                ))
            }
            Err(e) => {
                eprintln!("Unhandled surface error: {:?}", e);
                Err(RenderLoopError::SurfaceError(e))
            }
        }
    }

    /// Resizes the surface and updates its configuration.
    pub fn resize(&mut self, new_width: u32, new_height: u32) {
        if new_width > 0 && new_height > 0 {
            if let (Some(surface), Some(config)) =
                (self.surface.as_mut(), self.surface_config.as_mut())
            {
                println!("Resizing surface to {}x{}", new_width, new_height);
                config.width = new_width;
                config.height = new_height;
                surface.configure(&self.device, config); // Reconfigure with updated size

            // Note: Pipeline cache doesn't need to be cleared on resize
            // since the surface format doesn't change
            } else {
                println!("Resize called but surface is not configured.");
            }
        } else {
            println!(
                "Ignoring resize request with zero width or height ({}, {})",
                new_width, new_height
            );
        }
    }

    /// Handle surface format change (e.g., from HDR switch)
    pub fn update_surface_format(&mut self, new_format: wgpu::TextureFormat) {
        if let Some(config) = self.surface_config.as_mut() {
            config.format = new_format;
            if let Some(surface) = self.surface.as_ref() {
                surface.configure(&self.device, config);
            }
            // Clear pipeline cache since format changed
            self.pipeline_manager.clear_pipelines();
        }
    }

    /// Placeholder for handling device loss.
    pub fn handle_device_loss(&mut self) {
        eprintln!("Device loss detected! Attempting basic recovery (Not implemented yet).");
        // TODO: Implement robust device/resource recreation.
    }

    // --- Method to update the frame UBO ---
    pub fn update_frame_ubo(&self, origin_mm: [f32; 4], u_mm: [f32; 4], v_mm: [f32; 4]) {
        // Get atlas dimensions
        let atlas_dims = self.volume_atlas.size;
        let atlas_dim_u32 = [
            atlas_dims.width,
            atlas_dims.height,
            atlas_dims.depth_or_array_layers,
        ];

        // Get render target dimensions
        let target_dims = if self.offscreen_dimensions != (0, 0) {
            [self.offscreen_dimensions.0, self.offscreen_dimensions.1]
        } else {
            // Fallback to default if no offscreen target is configured
            [512, 512]
        };

        println!("DEBUG update_frame_ubo: atlas_dim = {:?}, target_dim = {:?}, offscreen_dimensions = {:?}", 
            atlas_dim_u32, target_dims, self.offscreen_dimensions);

        let data = FrameUbo {
            origin_mm,
            u_mm,
            v_mm,
            atlas_dim: atlas_dim_u32,
            _padding_frame: 0,
            target_dim: target_dims,
            _padding_target: [0, 0],
        };

        println!("[update_frame_ubo] Writing to GPU buffer:");
        println!(
            "  Origin: [{:.3}, {:.3}, {:.3}, {:.3}]",
            origin_mm[0], origin_mm[1], origin_mm[2], origin_mm[3]
        );
        println!(
            "  U: [{:.3}, {:.3}, {:.3}, {:.3}]",
            u_mm[0], u_mm[1], u_mm[2], u_mm[3]
        );
        println!(
            "  V: [{:.3}, {:.3}, {:.3}, {:.3}]",
            v_mm[0], v_mm[1], v_mm[2], v_mm[3]
        );

        self.queue
            .write_buffer(&self.frame_ubo_buffer, 0, bytemuck::bytes_of(&data));

        // Submit the queue to ensure the buffer write is processed
        self.queue.submit(std::iter::empty());

        // Ensure the buffer write is processed
        self.device.poll(wgpu::Maintain::Wait);
    }

    // --- Method to update the crosshair UBO (Separate from FrameUBO update) ---
    pub fn set_crosshair(&self, world_coords: [f32; 3]) {
        println!(
            "set_crosshair: Setting crosshair to world position [{:.2}, {:.2}, {:.2}]",
            world_coords[0], world_coords[1], world_coords[2]
        );

        // Verify crosshair is within volume bounds if we have metadata
        if let Some(metadata) = self.volume_metadata.get(&0) {
            // Convert to voxel coordinates to check bounds
            let world_point =
                nalgebra::Point4::new(world_coords[0], world_coords[1], world_coords[2], 1.0);
            let voxel_point = metadata.world_to_voxel * world_point;
            let voxel_coords = [
                voxel_point[0] / voxel_point[3],
                voxel_point[1] / voxel_point[3],
                voxel_point[2] / voxel_point[3],
            ];

            let in_bounds = voxel_coords[0] >= 0.0
                && voxel_coords[0] < metadata.dimensions.0 as f32
                && voxel_coords[1] >= 0.0
                && voxel_coords[1] < metadata.dimensions.1 as f32
                && voxel_coords[2] >= 0.0
                && voxel_coords[2] < metadata.dimensions.2 as f32;

            println!(
                "  Voxel coords: [{:.2}, {:.2}, {:.2}], In bounds: {}",
                voxel_coords[0], voxel_coords[1], voxel_coords[2], in_bounds
            );
        }

        let crosshair_data = CrosshairUboUpdated {
            world_position: world_coords,
            show_crosshair: 1, // Always show for now
        };
        self.queue.write_buffer(
            &self.crosshair_ubo_buffer,
            0,
            bytemuck::bytes_of(&crosshair_data),
        );
        // Note: This function ONLY updates the dedicated CrosshairUBO.
        // The FrameUBO's crosshair_voxel field must be updated via update_frame_ubo.
    }

    /// Update crosshair position and visibility
    pub fn update_crosshair_position(&self, world_coords: [f32; 3], show: bool) {
        println!(
            "update_crosshair_position: Position [{:.2}, {:.2}, {:.2}], Show: {}",
            world_coords[0], world_coords[1], world_coords[2], show
        );

        let crosshair_data = CrosshairUboUpdated {
            world_position: world_coords,
            show_crosshair: if show { 1 } else { 0 },
        };
        self.queue.write_buffer(
            &self.crosshair_ubo_buffer,
            0,
            bytemuck::bytes_of(&crosshair_data),
        );
    }

    /// Updates the frame UBO based on current crosshair and view plane for synchronized views
    /// This ensures all orthogonal views intersect at the crosshair position
    pub fn update_frame_for_synchronized_view(
        &self,
        view_width_mm: f32,
        view_height_mm: f32,
        crosshair_world: [f32; 3],
        plane_id: u32,
    ) {
        // Validate input dimensions
        if view_width_mm <= 0.0 || view_height_mm <= 0.0 {
            eprintln!(
                "WARNING: update_frame_for_synchronized_view called with invalid dimensions: w={}, h={}",
                view_width_mm, view_height_mm
            );
            return;
        }

        // Get volume bounds from metadata
        let (volume_min, volume_max) = if let Some(metadata) = self.volume_metadata.get(&0) {
            // Calculate volume bounds using 8-corner method
            let corners = [
                [0.0, 0.0, 0.0],
                [metadata.dimensions.0 as f32 - 1.0, 0.0, 0.0],
                [0.0, metadata.dimensions.1 as f32 - 1.0, 0.0],
                [
                    metadata.dimensions.0 as f32 - 1.0,
                    metadata.dimensions.1 as f32 - 1.0,
                    0.0,
                ],
                [0.0, 0.0, metadata.dimensions.2 as f32 - 1.0],
                [
                    metadata.dimensions.0 as f32 - 1.0,
                    0.0,
                    metadata.dimensions.2 as f32 - 1.0,
                ],
                [
                    0.0,
                    metadata.dimensions.1 as f32 - 1.0,
                    metadata.dimensions.2 as f32 - 1.0,
                ],
                [
                    metadata.dimensions.0 as f32 - 1.0,
                    metadata.dimensions.1 as f32 - 1.0,
                    metadata.dimensions.2 as f32 - 1.0,
                ],
            ];

            let mut min_bounds = [f32::INFINITY; 3];
            let mut max_bounds = [f32::NEG_INFINITY; 3];

            for corner in &corners {
                let voxel_point = nalgebra::Point4::new(corner[0], corner[1], corner[2], 1.0);
                let world_point = metadata.voxel_to_world * voxel_point;
                let world_coords = [
                    world_point[0] / world_point[3],
                    world_point[1] / world_point[3],
                    world_point[2] / world_point[3],
                ];

                for i in 0..3 {
                    min_bounds[i] = min_bounds[i].min(world_coords[i]);
                    max_bounds[i] = max_bounds[i].max(world_coords[i]);
                }
            }

            (min_bounds, max_bounds)
        } else {
            // Fallback to view dimensions if no metadata
            let half_width = view_width_mm / 2.0;
            let half_height = view_height_mm / 2.0;
            (
                [
                    crosshair_world[0] - half_width,
                    crosshair_world[1] - half_width,
                    crosshair_world[2] - half_height,
                ],
                [
                    crosshair_world[0] + half_width,
                    crosshair_world[1] + half_width,
                    crosshair_world[2] + half_height,
                ],
            )
        };

        // Calculate frame parameters based on view plane
        // The view should show the full volume extent, not centered on crosshair
        let (origin_mm, mut u_mm, mut v_mm) = match plane_id {
            0 => {
                // Axial view (XY plane at Z = current slice)
                let width = volume_max[0] - volume_min[0];
                let height = volume_max[1] - volume_min[1];
                let origin = [
                    volume_min[0],
                    volume_min[1],
                    crosshair_world[2], // Only Z comes from crosshair
                    1.0,
                ];
                let u = [width, 0.0, 0.0, 0.0];
                let v = [0.0, height, 0.0, 0.0];
                (origin, u, v)
            }
            1 => {
                // Coronal view (XZ plane at Y = current slice)
                let width = volume_max[0] - volume_min[0];
                let height = volume_max[2] - volume_min[2];
                let origin = [
                    volume_min[0],
                    crosshair_world[1], // Only Y comes from crosshair
                    volume_max[2],      // Start from top (max Z)
                    1.0,
                ];
                let u = [width, 0.0, 0.0, 0.0];
                let v = [0.0, 0.0, -height, 0.0]; // Negative to go from top to bottom
                (origin, u, v)
            }
            2 => {
                // Sagittal view (YZ plane at X = current slice)
                let width = volume_max[1] - volume_min[1];
                let height = volume_max[2] - volume_min[2];
                let origin = [
                    crosshair_world[0], // Only X comes from crosshair
                    volume_max[1],      // Start from anterior (max Y)
                    volume_max[2],      // Start from superior (max Z)
                    1.0,
                ];
                let u = [0.0, -width, 0.0, 0.0]; // Negative Y: anterior to posterior
                let v = [0.0, 0.0, -height, 0.0]; // Negative Z: superior to inferior
                (origin, u, v)
            }
            _ => {
                // Default to axial if invalid plane_id
                let width = volume_max[0] - volume_min[0];
                let height = volume_max[1] - volume_min[1];
                let origin = [volume_min[0], volume_min[1], crosshair_world[2], 1.0];
                let u = [width, 0.0, 0.0, 0.0];
                let v = [0.0, height, 0.0, 0.0];
                (origin, u, v)
            }
        };

        // Apply uniform scaling to preserve aspect ratio
        if view_width_mm > 0.0 && view_height_mm > 0.0 {
            // Calculate current u and v vector lengths
            let u_length = (u_mm[0] * u_mm[0] + u_mm[1] * u_mm[1] + u_mm[2] * u_mm[2]).sqrt();
            let v_length = (v_mm[0] * v_mm[0] + v_mm[1] * v_mm[1] + v_mm[2] * v_mm[2]).sqrt();

            if u_length > 1e-6 && v_length > 1e-6 {
                // Calculate scale factors for each axis
                let scale_x = view_width_mm / u_length;
                let scale_y = view_height_mm / v_length;

                // Use uniform scaling to preserve aspect ratio
                let scale = scale_x.min(scale_y);

                // Apply scaling to the vectors
                u_mm = [u_mm[0] * scale, u_mm[1] * scale, u_mm[2] * scale, u_mm[3]];
                v_mm = [v_mm[0] * scale, v_mm[1] * scale, v_mm[2] * scale, v_mm[3]];

                println!("RENDER_LOOP: Applied uniform scaling: scale={:.3}, scale_x={:.3}, scale_y={:.3}", 
                    scale, scale_x, scale_y);
            }
        }

        println!(
            "RENDER_LOOP: Received dimensions: {}x{}mm",
            view_width_mm, view_height_mm
        );
        println!("update_frame_for_synchronized_view: plane_id={}, view_size={}x{}mm, crosshair=[{:.1}, {:.1}, {:.1}]", 
            plane_id, view_width_mm, view_height_mm, 
            crosshair_world[0], crosshair_world[1], crosshair_world[2]);
        println!(
            "  Frame origin_mm: [{:.1}, {:.1}, {:.1}, {:.1}]",
            origin_mm[0], origin_mm[1], origin_mm[2], origin_mm[3]
        );
        println!(
            "  Frame u_mm (X axis): [{:.1}, {:.1}, {:.1}, {:.1}]",
            u_mm[0], u_mm[1], u_mm[2], u_mm[3]
        );
        println!(
            "  Frame v_mm (Y axis): [{:.1}, {:.1}, {:.1}, {:.1}]",
            v_mm[0], v_mm[1], v_mm[2], v_mm[3]
        );

        // Log what plane this corresponds to
        match plane_id {
            0 => println!("  Axial view: Shows XY plane, slice changes along Z"),
            1 => println!("  Coronal view: Shows XZ plane, slice changes along Y"),
            2 => println!("  Sagittal view: Shows YZ plane, slice changes along X"),
            _ => println!("  Unknown view plane"),
        }

        // Calculate and print the view bounds
        let bottom_left = [
            origin_mm[0] - u_mm[0] - v_mm[0],
            origin_mm[1] - u_mm[1] - v_mm[1],
            origin_mm[2] - u_mm[2] - v_mm[2],
        ];
        let top_right = [
            origin_mm[0] + u_mm[0] + v_mm[0],
            origin_mm[1] + u_mm[1] + v_mm[1],
            origin_mm[2] + u_mm[2] + v_mm[2],
        ];
        println!(
            "  View bounds: [{:.1}, {:.1}, {:.1}] to [{:.1}, {:.1}, {:.1}]",
            bottom_left[0],
            bottom_left[1],
            bottom_left[2],
            top_right[0],
            top_right[1],
            top_right[2]
        );

        // Add world FOV debug output
        let world_fov_width =
            2.0 * ((u_mm[0] * u_mm[0] + u_mm[1] * u_mm[1] + u_mm[2] * u_mm[2]).sqrt());
        let world_fov_height =
            2.0 * ((v_mm[0] * v_mm[0] + v_mm[1] * v_mm[1] + v_mm[2] * v_mm[2]).sqrt());
        println!(
            "  World FOV: {:.1}x{:.1}mm",
            world_fov_width, world_fov_height
        );

        // Print volume metadata if available
        if let Some(metadata) = self.volume_metadata.get(&0) {
            println!(
                "  Volume origin: [{:.1}, {:.1}, {:.1}]",
                metadata.origin[0], metadata.origin[1], metadata.origin[2]
            );

            // CRITICAL: Verify the crosshair transformation
            // Convert crosshair to homogeneous coordinates
            let crosshair_homogeneous = nalgebra::Point4::new(
                crosshair_world[0],
                crosshair_world[1],
                crosshair_world[2],
                1.0,
            );
            let crosshair_voxel_homo = metadata.world_to_voxel * crosshair_homogeneous;
            let crosshair_voxel = [
                crosshair_voxel_homo[0] / crosshair_voxel_homo[3],
                crosshair_voxel_homo[1] / crosshair_voxel_homo[3],
                crosshair_voxel_homo[2] / crosshair_voxel_homo[3],
            ];
            println!(
                "  Crosshair world: [{:.1}, {:.1}, {:.1}] -> voxel: [{:.1}, {:.1}, {:.1}]",
                crosshair_world[0],
                crosshair_world[1],
                crosshair_world[2],
                crosshair_voxel[0],
                crosshair_voxel[1],
                crosshair_voxel[2]
            );
            println!(
                "  Volume dimensions: {}x{}x{}",
                metadata.dimensions.0, metadata.dimensions.1, metadata.dimensions.2
            );

            // Check if voxel is within bounds
            let in_bounds = crosshair_voxel[0] >= 0.0
                && crosshair_voxel[0] < metadata.dimensions.0 as f32
                && crosshair_voxel[1] >= 0.0
                && crosshair_voxel[1] < metadata.dimensions.1 as f32
                && crosshair_voxel[2] >= 0.0
                && crosshair_voxel[2] < metadata.dimensions.2 as f32;
            println!("  Crosshair in bounds: {}", in_bounds);
            // Calculate volume bounds using 8-corner method
            // This is robust and works with any affine transformation
            let corners = [
                [0.0, 0.0, 0.0],
                [metadata.dimensions.0 as f32 - 1.0, 0.0, 0.0],
                [0.0, metadata.dimensions.1 as f32 - 1.0, 0.0],
                [
                    metadata.dimensions.0 as f32 - 1.0,
                    metadata.dimensions.1 as f32 - 1.0,
                    0.0,
                ],
                [0.0, 0.0, metadata.dimensions.2 as f32 - 1.0],
                [
                    metadata.dimensions.0 as f32 - 1.0,
                    0.0,
                    metadata.dimensions.2 as f32 - 1.0,
                ],
                [
                    0.0,
                    metadata.dimensions.1 as f32 - 1.0,
                    metadata.dimensions.2 as f32 - 1.0,
                ],
                [
                    metadata.dimensions.0 as f32 - 1.0,
                    metadata.dimensions.1 as f32 - 1.0,
                    metadata.dimensions.2 as f32 - 1.0,
                ],
            ];

            let mut min_bounds = [f32::INFINITY; 3];
            let mut max_bounds = [f32::NEG_INFINITY; 3];

            for corner in &corners {
                let voxel_point = nalgebra::Point4::new(corner[0], corner[1], corner[2], 1.0);
                let world_point = metadata.voxel_to_world * voxel_point;
                let world_coords = [
                    world_point[0] / world_point[3],
                    world_point[1] / world_point[3],
                    world_point[2] / world_point[3],
                ];

                for i in 0..3 {
                    min_bounds[i] = min_bounds[i].min(world_coords[i]);
                    max_bounds[i] = max_bounds[i].max(world_coords[i]);
                }
            }

            println!(
                "  Volume bounds: [{:.1}, {:.1}, {:.1}] to [{:.1}, {:.1}, {:.1}]",
                min_bounds[0],
                min_bounds[1],
                min_bounds[2],
                max_bounds[0],
                max_bounds[1],
                max_bounds[2]
            );
        }

        // Update the frame UBO
        println!(
            "[update_frame_for_synchronized_view] FINAL frame parameters being sent to shader:"
        );
        println!(
            "  Origin: [{:.3}, {:.3}, {:.3}, {:.3}]",
            origin_mm[0], origin_mm[1], origin_mm[2], origin_mm[3]
        );
        println!(
            "  U vector: [{:.3}, {:.3}, {:.3}, {:.3}]",
            u_mm[0], u_mm[1], u_mm[2], u_mm[3]
        );
        println!(
            "  V vector: [{:.3}, {:.3}, {:.3}, {:.3}]",
            v_mm[0], v_mm[1], v_mm[2], v_mm[3]
        );
        self.update_frame_ubo(origin_mm, u_mm, v_mm);
    }

    // --- Render state management methods ---

    /// Get current frame statistics
    pub fn get_frame_stats(&self) -> FrameStats {
        self.render_state.current_stats()
    }

    /// Add a layer to be rendered for world-space rendering
    pub fn add_layer_3d(
        &mut self,
        texture_index: u32,
        world_to_voxel: nalgebra::Matrix4<f32>,
        volume_dims: (u32, u32, u32),
        opacity: f32,
        colormap_id: u32,
    ) -> Result<usize, RenderLoopError> {
        println!(
            "add_layer_3d: Adding layer with texture_index={}, dims={:?}, opacity={}",
            texture_index, volume_dims, opacity
        );

        // For world-space rendering, we need to store the texture index and transform
        let layer_info = LayerInfo {
            atlas_index: texture_index,
            opacity,
            texture_coords: (0.0, 0.0, 1.0, 1.0), // Full texture for 3D volumes
            blend_mode: crate::render_state::BlendMode::Normal,
            colormap_id,
            intensity_range: (0.0, 1.0), // Will be updated later
            threshold_range: (-f32::INFINITY, f32::INFINITY),
            threshold_mode: crate::render_state::ThresholdMode::Range,
            is_mask: false,
        };

        let layer_index = self
            .layer_state_manager
            .add_layer(layer_info.clone())
            .map_err(|e| RenderLoopError::Internal {
                code: 1885,
                details: format!("Failed to add layer: {}", e),
            })?;

        // Store volume metadata for this layer with the texture index as key
        // This is needed for update_all_layer_uniforms to get the transform
        let metadata = VolumeMetadata {
            dimensions: volume_dims,
            world_to_voxel: world_to_voxel.clone(),
            voxel_to_world: world_to_voxel
                .try_inverse()
                .unwrap_or_else(Matrix4::identity),
            origin: [0.0, 0.0, 0.0],  // Will be updated if available
            spacing: [1.0, 1.0, 1.0], // Will be updated if available
            data_range: (0.0, 1.0),   // Will be updated later
        };
        self.volume_metadata.insert(texture_index, metadata);

        // For world-space rendering, update the layer storage manager immediately
        if self.world_space_enabled {
            if let (Some(ref mut layer_storage), Some(ref _layout)) = (
                &mut self.layer_storage_manager,
                &self.layer_bind_group_layout,
            ) {
                // Update just this layer in the storage
                layer_storage
                    .update_layer(
                        &self.queue,
                        layer_index,
                        &layer_info,
                        volume_dims,
                        &world_to_voxel,
                    )
                    .map_err(|e| RenderLoopError::Internal {
                        code: 1886,
                        details: format!("Failed to update layer storage: {}", e),
                    })?;

                println!(
                    "add_layer_3d: Updated layer storage for layer {} with transform",
                    layer_index
                );
            }
        }

        println!("add_layer_3d: Added layer at index {}", layer_index);
        Ok(layer_index)
    }

    /// Add a layer to be rendered (legacy atlas-based method)
    pub fn add_render_layer(
        &mut self,
        atlas_index: u32,
        opacity: f32,
        texture_coords: (f32, f32, f32, f32),
    ) -> Result<usize, RenderLoopError> {
        use render_state::{BlendMode, LayerInfo, ThresholdMode};

        // Get the actual data range from volume metadata
        // Use the correct atlas_index to look up the volume's intensity range
        println!(
            "add_render_layer: Looking up metadata for atlas_index {}",
            atlas_index
        );
        println!(
            "  Available volume_metadata keys: {:?}",
            self.volume_metadata.keys().collect::<Vec<_>>()
        );

        let intensity_range = self
            .volume_metadata
            .get(&atlas_index)
            .map(|meta| {
                println!(
                    "  Found metadata with data_range: ({}, {})",
                    meta.data_range.0, meta.data_range.1
                );
                meta.data_range
            })
            .unwrap_or_else(|| {
                println!(
                    "  No metadata found for atlas_index {}, using default (0.0, 1.0)",
                    atlas_index
                );
                (0.0, 1.0)
            });

        println!(
            "add_render_layer: Using intensity range: ({}, {})",
            intensity_range.0, intensity_range.1
        );

        let layer = LayerInfo {
            atlas_index,
            opacity,
            blend_mode: BlendMode::Normal,
            colormap_id: 0,
            intensity_range,
            threshold_range: intensity_range, // Use same range for thresholding initially
            threshold_mode: ThresholdMode::Range,
            texture_coords,
            is_mask: false,
        };

        let index =
            self.layer_state_manager
                .add_layer(layer)
                .map_err(|e| RenderLoopError::Internal {
                    code: 8001,
                    details: e.to_string(),
                })?;

        // Update layer uniforms
        // println!("DEBUG: Calling update_all_layer_uniforms after adding layer {}", index);
        self.update_all_layer_uniforms()?;

        Ok(index)
    }

    /// Remove a render layer
    pub fn remove_render_layer(&mut self, index: usize) -> Option<u32> {
        let result = self
            .layer_state_manager
            .remove_layer(index)
            .map(|layer| layer.atlas_index);

        if let Some(atlas_index) = result {
            // Clean up metadata for this layer
            self.volume_metadata.remove(&atlas_index);
            // Update uniforms after layer removal
            let _ = self.update_all_layer_uniforms();
        }

        result
    }

    /// Clear all render layers
    pub fn clear_render_layers(&mut self) {
        self.layer_state_manager.clear_layers();
        // Update uniforms to reflect no active layers
        let _ = self.update_all_layer_uniforms();
    }

    /// Get number of active layers
    pub fn active_layer_count(&self) -> usize {
        self.layer_state_manager.layer_count()
    }

    /// Update layer properties
    pub fn update_layer(
        &mut self,
        index: usize,
        opacity: f32,
        colormap_id: u32,
    ) -> Result<(), RenderLoopError> {
        if let Some(layer) = self.layer_state_manager.get_layer_mut(index) {
            layer.opacity = opacity;
            layer.colormap_id = colormap_id;
            // Update uniforms after property change
            self.update_all_layer_uniforms()?;
            Ok(())
        } else {
            Err(RenderLoopError::Internal {
                code: 8002,
                details: format!("Layer {} not found", index),
            })
        }
    }

    /// Update layer intensity window
    pub fn update_layer_intensity(
        &mut self,
        index: usize,
        min: f32,
        max: f32,
    ) -> Result<(), RenderLoopError> {
        if let Some(layer) = self.layer_state_manager.get_layer_mut(index) {
            layer.intensity_range = (min, max);
            // Update uniforms after property change
            self.update_all_layer_uniforms()?;
            Ok(())
        } else {
            Err(RenderLoopError::Internal {
                code: 8003,
                details: format!("Layer {} not found", index),
            })
        }
    }

    /// Update layer threshold range
    pub fn update_layer_threshold(
        &mut self,
        index: usize,
        low: f32,
        high: f32,
    ) -> Result<(), RenderLoopError> {
        if let Some(layer) = self.layer_state_manager.get_layer_mut(index) {
            layer.threshold_range = (low, high);
            // Update uniforms after property change
            self.update_all_layer_uniforms()?;
            Ok(())
        } else {
            Err(RenderLoopError::Internal {
                code: 8004,
                details: format!("Layer {} not found", index),
            })
        }
    }

    /// Set layer colormap
    pub fn set_layer_colormap(
        &mut self,
        index: usize,
        colormap_id: u32,
    ) -> Result<(), RenderLoopError> {
        if let Some(layer) = self.layer_state_manager.get_layer_mut(index) {
            layer.colormap_id = colormap_id;
            // Update uniforms after property change
            self.update_all_layer_uniforms()?;
            Ok(())
        } else {
            Err(RenderLoopError::Internal {
                code: 8005,
                details: format!("Layer {} not found", index),
            })
        }
    }

    /// Set whether a layer contains binary mask data
    pub fn set_layer_mask(&mut self, index: usize, is_mask: bool) -> Result<(), RenderLoopError> {
        if let Some(layer) = self.layer_state_manager.get_layer_mut(index) {
            layer.is_mask = is_mask;
            // Update uniforms after property change
            self.update_all_layer_uniforms()?;
            Ok(())
        } else {
            Err(RenderLoopError::Internal {
                code: 8006,
                details: format!("Layer {} not found", index),
            })
        }
    }

    /// Update layer uniforms directly with provided data

    /// Update all layer uniforms from current layer state
    fn update_all_layer_uniforms(&mut self) -> Result<(), RenderLoopError> {
        let layers = self.layer_state_manager.layers();

        // Get actual volume metadata for each layer
        let volume_dimensions: Vec<(u32, u32, u32)> = layers
            .iter()
            .map(|layer| {
                let dims = self
                    .volume_metadata
                    .get(&layer.atlas_index)
                    .map(|meta| meta.dimensions)
                    .unwrap_or((256, 256, 128)); // Default if metadata missing
                                                 // println!("  Layer atlas_index {}: dimensions {:?}", layer.atlas_index, dims);
                dims
            })
            .collect();

        let world_to_voxel_transforms: Vec<Matrix4<f32>> = layers
            .iter()
            .enumerate()
            .map(|(_i, layer)| {
                let transform = self
                    .volume_metadata
                    .get(&layer.atlas_index)
                    .map(|meta| meta.world_to_voxel.clone())
                    .unwrap_or_else(Matrix4::identity); // Default if metadata missing
                                                        // println!("  Layer {} (atlas_index {}) world_to_voxel matrix:", i, layer.atlas_index);
                                                        // println!("    {:?}", transform);
                transform
            })
            .collect();

        // println!("DEBUG: update_all_layer_uniforms - {} layers", layers.len());

        // Update based on rendering mode
        if self.world_space_enabled {
            // Update layer storage buffer for world-space rendering
            if let (Some(ref mut layer_storage), Some(ref _layout)) = (
                &mut self.layer_storage_manager,
                &self.layer_bind_group_layout,
            ) {
                // println!("DEBUG: Updating layer storage with {} layers", layers.len());
                // for (i, layer) in layers.iter().enumerate() {
                //     println!("  Layer {}: atlas_index={}, opacity={}, colormap={}",
                //              i, layer.atlas_index, layer.opacity, layer.colormap_id);
                // }
                layer_storage.update_layers(
                    &self.device,
                    &self.queue,
                    _layout,
                    layers,
                    &volume_dimensions,
                    &world_to_voxel_transforms,
                );
            } else {
                println!("WARNING: Layer storage manager not available for world-space rendering!");
            }
        } else {
            // Update the uniform buffer for atlas-based rendering
            self.layer_uniform_manager.update_layers(
                &self.queue,
                layers,
                &volume_dimensions,
                &world_to_voxel_transforms,
            );
        }

        Ok(())
    }

    /// Set render pass configuration
    pub fn configure_render_pass(
        &mut self,
        pass_type: render_state::RenderPassType,
        config: render_state::RenderPassConfig,
    ) {
        self.render_pass_manager.set_config(pass_type, config);
    }

    /// Switch to a different shader pipeline
    pub fn set_shader(&mut self, shader_name: &str) -> Result<(), RenderLoopError> {
        // Ensure the shader is loaded
        if self.shader_manager.get_shader(shader_name).is_none() {
            return Err(RenderLoopError::Internal {
                code: 9010,
                details: format!("Shader '{}' not loaded. Available shaders: slice, slice_debug, slice_debug2, slice_debug3, slice_simple", shader_name),
            });
        }

        // Update the current pipeline
        self.current_pipeline = Some(shader_name.to_string());

        // Ensure the pipeline exists for this shader
        self.ensure_pipeline(shader_name)?;

        Ok(())
    }

    /// Check if texture bind group has been created
    pub fn has_texture_bind_group(&self) -> bool {
        self.texture_bind_group_id.is_some()
    }

    /// Get the current render target dimensions
    /// Note: This method is kept for backward compatibility with legacy API
    pub fn get_render_target_size(&self) -> Option<(u32, u32)> {
        if self.render_target_pool.is_some() && self.offscreen_dimensions != (0, 0) {
            Some(self.offscreen_dimensions)
        } else {
            None
        }
    }

    /// Create an offscreen render target for rendering without a window surface
    /// Uses render target pooling to avoid expensive GPU texture creation/destruction
    pub fn create_offscreen_target(
        &mut self,
        width: u32,
        height: u32,
    ) -> Result<(), RenderLoopError> {
        if width == 0 || height == 0 {
            return Err(RenderLoopError::Internal {
                code: 7001,
                details: "Invalid offscreen dimensions: width and height must be non-zero"
                    .to_string(),
            });
        }

        // Initialize render target pool lazily
        if self.render_target_pool.is_none() {
            const MAX_POOLED_TARGETS: usize = 16; // Cache up to 16 render targets
            self.render_target_pool = Some(RenderTargetPool::new(
                self.device.clone(),
                self.queue.clone(),
                MAX_POOLED_TARGETS,
            ));
            log::info!(
                "Initialized render target pool with max {} entries",
                MAX_POOLED_TARGETS
            );
        }

        // Get or create render target from pool
        let pool = self.render_target_pool.as_mut().unwrap();
        let format = wgpu::TextureFormat::Rgba8Unorm;

        let (key, was_created) =
            pool.ensure_target(width, height, format)
                .map_err(|e| RenderLoopError::Internal {
                    code: 7002,
                    details: format!("Failed to get render target from pool: {}", e),
                })?;

        if was_created {
            log::info!("Created new pooled render target: {}x{}", width, height);
        } else {
            log::debug!("Reused pooled render target: {}x{}", width, height);
        }

        // Store the key for later access
        self.current_render_target_key = Some(key);

        // Update legacy fields for backward compatibility
        self.offscreen_dimensions = (width, height);

        // Set up a surface config for offscreen rendering
        // This is needed for pipeline creation
        if self.surface_config.is_none() {
            self.surface_config = Some(wgpu::SurfaceConfiguration {
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                format,
                width,
                height,
                present_mode: wgpu::PresentMode::Fifo,
                desired_maximum_frame_latency: 2,
                alpha_mode: wgpu::CompositeAlphaMode::Auto,
                view_formats: vec![],
            });
        }

        // Log pool statistics periodically
        let stats = pool.stats();
        if was_created {
            log::info!(
                "Render target pool: {}/{} entries ({:.1}% full)",
                stats.cached_entries,
                stats.max_entries,
                stats.cache_utilization * 100.0
            );
        }

        Ok(())
    }

    /// Unpack GPU buffer data to image format, removing padding and flipping Y axis
    ///
    /// GPU renders with Y=0 at bottom (OpenGL convention), but image convention
    /// expects Y=0 at top. This function handles both padding removal and Y-flip.
    fn unpack_gpu_buffer_to_image(
        data: &[u8],
        width: u32,
        height: u32,
        padded_bytes_per_row: u32,
    ) -> Vec<u8> {
        let bytes_per_row = width * 4; // RGBA8
        let mut output = Vec::with_capacity((width * height * 4) as usize);

        for row in 0..height {
            // Read rows in reverse order to flip Y
            let flipped_row = height - 1 - row;
            let row_start = (flipped_row * padded_bytes_per_row) as usize;
            let row_end = row_start + bytes_per_row as usize;
            output.extend_from_slice(&data[row_start..row_end]);
        }

        output
    }

    /// Render to the offscreen target and return the image data
    pub fn render_to_buffer(&mut self) -> Result<Vec<u8>, RenderLoopError> {
        // Ensure render target pool exists and has current dimensions
        let (width, height) = self.offscreen_dimensions;
        if width == 0 || height == 0 {
            return Err(RenderLoopError::Internal {
                code: 7002,
                details: "Offscreen render target not created. Call create_offscreen_target first."
                    .to_string(),
            });
        }

        // Ensure we have the pooled render target for current dimensions
        if self.render_target_pool.is_none() {
            return Err(RenderLoopError::Internal {
                code: 7003,
                details: "Render target pool not initialized. Call create_offscreen_target first."
                    .to_string(),
            });
        }

        // Begin new frame
        self.render_state.begin_frame();

        println!(
            "render_to_buffer: Starting render with dimensions {}x{}",
            width, height
        );

        // Update layer uniforms before rendering (skip if using world-space rendering)
        if !self.world_space_enabled {
            self.update_all_layer_uniforms()?;

            // Debug: Check layer state
            let active_layers = self.layer_state_manager.layer_count();
            println!("render_to_buffer: Active layers: {}", active_layers);
            if active_layers == 0 {
                println!("WARNING: render_to_buffer: No active layers to render!");
            }
        } else {
            // For world-space rendering, check layer storage manager
            if let Some(layer_storage) = &self.layer_storage_manager {
                let active_count = layer_storage.active_count();
                println!(
                    "render_to_buffer: World-space rendering with {} active layers",
                    active_count
                );

                if active_count == 0 {
                    println!(
                        "WARNING: render_to_buffer: No active layers for world-space rendering!"
                    );
                    println!("  - This usually means GPU resources haven't been allocated yet");
                    println!(
                        "  - Check that request_layer_gpu_resources was called before rendering"
                    );
                    println!("  - Ensure add_layer_3d was called with the layer info");

                    // Return a transparent image instead of continuing
                    let (width, height) = self.offscreen_dimensions;
                    let size = (width * height * 4) as usize;
                    return Ok(vec![0u8; size]);
                }
            } else {
                println!("ERROR: World-space rendering enabled but layer_storage_manager is None!");
                return Err(RenderLoopError::Internal {
                    code: 7010,
                    details: "Layer storage manager not initialized for world-space rendering"
                        .to_string(),
                });
            }
        }

        // Get the current pipeline name based on rendering mode
        let pipeline_name = if self.world_space_enabled {
            // If we have a current pipeline set and it's a world-space shader, use it
            if let Some(ref current) = self.current_pipeline {
                if current.contains("world_space") {
                    current.clone()
                } else {
                    "slice_world_space".to_string()
                }
            } else {
                "slice_world_space".to_string()
            }
        } else {
            self.current_pipeline
                .clone()
                .unwrap_or_else(|| "slice_simplified".to_string())
        };

        println!("render_to_buffer: Using pipeline '{}'", pipeline_name);

        // Ensure pipeline exists
        self.ensure_pipeline(&pipeline_name)?;

        // Get the current render target from pool
        let pool = self.render_target_pool.as_ref().unwrap();
        let key =
            self.current_render_target_key
                .as_ref()
                .ok_or_else(|| RenderLoopError::Internal {
                    code: 7004,
                    details: "No current render target key. Call create_offscreen_target first."
                        .to_string(),
                })?;

        let (offscreen_texture, offscreen_view) =
            pool.get_current_target(key)
                .ok_or_else(|| RenderLoopError::Internal {
                    code: 7005,
                    details: "Current render target not found in pool.".to_string(),
                })?;

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("Offscreen Render Encoder"),
            });

        // Create global bind group
        let global_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Global Bind Group"),
            layout: &self.global_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.frame_ubo_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.crosshair_ubo_buffer.as_entire_binding(),
                },
                // ViewPlaneUbo removed - view plane info is now encoded in frame vectors
            ],
        });

        // Create render pass
        let (load_op, store_op) = self.render_pass_manager.get_pass_operations();
        let pass_label = "Offscreen Render Pass";

        println!(
            "render_to_buffer: Load op: {:?}, Store op: {:?}",
            load_op, store_op
        );

        // Ensure multi-texture bind group exists before creating render pass
        if self.world_space_enabled {
            if let Some(multi_texture) = &mut self.multi_texture_manager {
                // Ensure bind group exists - recreate if needed
                if multi_texture.bind_group().is_none() {
                    if let (Some(texture_layout), Some(colormap_view)) = (
                        self.texture_bind_group_layout.as_ref(),
                        self.texture_manager.colormap_view(),
                    ) {
                        multi_texture
                            .create_bind_group(
                                &self.device,
                                texture_layout,
                                self.texture_manager.linear_sampler(),
                                colormap_view,
                                self.texture_manager.colormap_sampler(),
                            )
                            .ok(); // Ignore error for now
                    }
                }
            }
        }

        // Get the pipeline
        let pipeline = self.get_pipeline(&pipeline_name)?;

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some(pass_label),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: offscreen_view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: load_op,
                        store: store_op,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
            });

            // Set the render pipeline
            render_pass.set_pipeline(pipeline);

            // Set bind groups
            render_pass.set_bind_group(0, &global_bind_group, &[]);

            // Set layer and texture bind groups based on rendering mode
            if self.world_space_enabled {
                // World-space rendering: use storage buffer and multi-texture bind groups
                if let Some(layer_storage) = &self.layer_storage_manager {
                    if let Some(layer_bind_group) = layer_storage.bind_group() {
                        render_pass.set_bind_group(1, layer_bind_group, &[]);
                        println!("render_to_buffer: Layer storage bind group set");
                    } else {
                        println!("render_to_buffer: No layer storage bind group available");
                    }
                } else {
                    println!("render_to_buffer: Layer storage manager not initialized");
                }

                if let Some(multi_texture) = &self.multi_texture_manager {
                    if let Some(texture_bind_group) = multi_texture.bind_group() {
                        render_pass.set_bind_group(2, texture_bind_group, &[]);
                        println!("render_to_buffer: Multi-texture bind group set");
                    } else {
                        println!("render_to_buffer: No multi-texture bind group available");
                    }
                } else {
                    println!("render_to_buffer: Multi-texture manager not initialized");
                }
            } else {
                // Traditional rendering: use UBO and atlas texture bind groups
                if let Some(layer_bind_group) = self.layer_uniform_manager.bind_group() {
                    render_pass.set_bind_group(1, layer_bind_group, &[]);
                    println!("render_to_buffer: Layer bind group set");
                } else {
                    println!("render_to_buffer: No layer bind group available");
                }

                if let Some(bind_group_id) = self.texture_bind_group_id {
                    if let Some(texture_bind_group) =
                        self.texture_manager.get_bind_group(bind_group_id)
                    {
                        render_pass.set_bind_group(2, texture_bind_group, &[]);
                        println!("render_to_buffer: Texture bind group set");
                    } else {
                        println!("render_to_buffer: Texture bind group not found");
                    }
                } else {
                    println!("render_to_buffer: No texture bind group ID");
                }
            }

            // Draw fullscreen quad
            println!("render_to_buffer: Drawing fullscreen quad (6 vertices)");
            render_pass.draw(0..6, 0..1);
        }

        // Create a buffer to copy the render result to
        let bytes_per_row = width * 4; // RGBA8
        let padded_bytes_per_row = (bytes_per_row + 255) & !255; // Align to 256 bytes
        let buffer_size = padded_bytes_per_row * height;

        let output_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Offscreen Output Buffer"),
            size: buffer_size as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        // Copy texture to buffer
        encoder.copy_texture_to_buffer(
            wgpu::ImageCopyTexture {
                texture: offscreen_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyBuffer {
                buffer: &output_buffer,
                layout: wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        self.queue.submit(std::iter::once(encoder.finish()));

        // Map the buffer and read the data
        let buffer_slice = output_buffer.slice(..);
        let (sender, receiver) = futures_intrusive::channel::shared::oneshot_channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });

        self.device.poll(wgpu::Maintain::Wait);

        let result =
            pollster::block_on(receiver.receive()).ok_or_else(|| RenderLoopError::Internal {
                code: 7004,
                details: "Failed to receive buffer mapping result".to_string(),
            })?;

        result.map_err(|_| RenderLoopError::Internal {
            code: 7005,
            details: "Failed to map output buffer".to_string(),
        })?;

        let data = buffer_slice.get_mapped_range();

        // Use helper to unpack buffer with Y-flip
        let output = Self::unpack_gpu_buffer_to_image(&data, width, height, padded_bytes_per_row);

        // Debug: Verify alpha channel values
        #[cfg(debug_assertions)]
        {
            let mut zero_alpha_count = 0;
            let mut low_alpha_count = 0;
            let total_pixels = (width * height) as usize;

            for i in (3..output.len()).step_by(4) {
                if output[i] == 0 {
                    zero_alpha_count += 1;
                } else if output[i] < 128 {
                    low_alpha_count += 1;
                }
            }

            if zero_alpha_count > 0 {
                println!(
                    "WARNING: {} pixels ({:.1}%) have alpha=0 (fully transparent)",
                    zero_alpha_count,
                    (zero_alpha_count as f32 / total_pixels as f32) * 100.0
                );
            }
            if low_alpha_count > 0 {
                println!(
                    "WARNING: {} pixels ({:.1}%) have alpha<128 (semi-transparent)",
                    low_alpha_count,
                    (low_alpha_count as f32 / total_pixels as f32) * 100.0
                );
            }
        }

        // Record draw call
        self.render_state.record_draw();
        let _stats = self.render_state.end_frame();

        Ok(output)
    }

    // === ViewState API Methods ===

    /// Register a volume for use in views
    /// Register a volume by uploading it to GPU and storing metadata
    pub fn register_volume_with_upload<T>(
        &mut self,
        volume_id: String,
        volume: &DenseVolume3<T>,
        format: wgpu::TextureFormat,
    ) -> Result<(), RenderLoopError>
    where
        T: VoxelData
            + num_traits::NumCast
            + serde::Serialize
            + DataRange<T>
            + num_traits::Zero
            + std::ops::Sub<Output = T>
            + std::ops::Div<Output = T>
            + std::ops::Mul<Output = T>,
    {
        // Upload volume to atlas
        let (atlas_index, _world_to_voxel) = self.upload_volume_3d(volume)?;

        // Get volume metadata
        let dims = volume.space.dims();
        let world_to_voxel = volume.space.0.world_to_voxel();
        let voxel_to_world = volume.space.0.voxel_to_world();
        let spacing = volume.space.0.spacing();
        let origin = volume.space.0.origin();

        // DEBUG: Print both transforms to verify
        println!("DEBUG register_volume_with_upload:");
        println!("  world_to_voxel: {:?}", world_to_voxel);
        println!("  voxel_to_world: {:?}", voxel_to_world);
        let data_range = volume
            .range()
            .map(|(min, max)| {
                let min_f32 = num_traits::cast::<T, f32>(min).unwrap_or(0.0);
                let max_f32 = num_traits::cast::<T, f32>(max).unwrap_or(1.0);
                println!("DEBUG: Volume data range: min={}, max={}", min_f32, max_f32);
                (min_f32, max_f32)
            })
            .unwrap_or_else(|| {
                println!("DEBUG: Volume.range() returned None, using default (0.0, 1.0)");
                (0.0, 1.0)
            });

        let metadata = VolumeMetadata {
            dimensions: (dims[0] as u32, dims[1] as u32, dims[2] as u32),
            world_to_voxel,
            voxel_to_world,
            origin: [origin[0], origin[1], origin[2]],
            spacing: [spacing[0], spacing[1], spacing[2]],
            data_range,
        };

        // Store in registry
        self.volumes.insert(
            volume_id,
            VolumeRegistryEntry {
                atlas_index,
                metadata,
                format,
            },
        );

        Ok(())
    }

    /// Create or update a view's render target
    pub fn ensure_view(
        &mut self,
        view_id: ViewId,
        dimensions: [u32; 2],
    ) -> Result<(), RenderLoopError> {
        if let Some(view) = self.views.get(&view_id) {
            if !view.needs_resize(dimensions) {
                return Ok(()); // View exists and is correct size
            }
        }

        // Create new render target texture
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("View {} Render Target", view_id.0)),
            size: wgpu::Extent3d {
                width: dimensions[0],
                height: dimensions[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });

        let render_target = texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Store view context
        self.views.insert(
            view_id.clone(),
            ViewContext {
                id: view_id,
                last_state: None,
                render_texture: texture,
                render_target,
                dimensions,
            },
        );

        Ok(())
    }

    /// Main declarative API: Request a frame for a view with given state
    pub async fn request_frame(
        &mut self,
        view_id: ViewId,
        state: ViewState,
    ) -> Result<FrameResult, RenderLoopError> {
        // Validate state
        state.validate().map_err(|e| RenderLoopError::Internal {
            code: 8001,
            details: format!("Invalid ViewState: {}", e),
        })?;

        // Ensure view exists with correct dimensions
        self.ensure_view(view_id.clone(), state.viewport_size)?;

        // Start frame timing
        let start_time = std::time::Instant::now();
        let mut warnings = Vec::new();
        let mut rendered_layers = Vec::new();

        // Convert camera state to frame UBO
        let (origin, u_vec, v_vec) = state.camera_to_frame_params();
        let frame_ubo = FrameUbo {
            origin_mm: origin,
            u_mm: u_vec,
            v_mm: v_vec,
            atlas_dim: [256, 256, 256], // Use actual atlas dimensions
            _padding_frame: 0,
            target_dim: state.viewport_size,
            _padding_target: [0, 0],
        };

        // Update frame UBO
        self.update_frame_ubo(frame_ubo.origin_mm, frame_ubo.u_mm, frame_ubo.v_mm);

        // Update crosshair
        self.update_crosshair_position(state.crosshair_world, state.show_crosshair);

        // Prepare layer data
        let mut layer_infos = Vec::new();
        let mut layer_dims = Vec::new();
        let mut world_to_voxels = Vec::new();

        for layer_config in &state.layers {
            if !layer_config.visible {
                continue;
            }

            // Look up volume in registry
            let vol_entry = self.volumes.get(&layer_config.volume_id).ok_or_else(|| {
                RenderLoopError::Internal {
                    code: 8002,
                    details: format!("Volume '{}' not registered", layer_config.volume_id),
                }
            })?;

            // Create layer info
            let layer_info = LayerInfo {
                atlas_index: vol_entry.atlas_index,
                opacity: layer_config.opacity,
                blend_mode: layer_config.blend_mode,
                colormap_id: layer_config.colormap_id,
                intensity_range: layer_config.intensity_window,
                threshold_range: layer_config
                    .threshold
                    .as_ref()
                    .map(|t| t.range)
                    .unwrap_or((0.0, 0.0)), // Default to [0,0] for no thresholding
                threshold_mode: layer_config
                    .threshold
                    .as_ref()
                    .map(|t| t.mode)
                    .unwrap_or(ThresholdMode::Range),
                texture_coords: (0.0, 0.0, 1.0, 1.0),
                is_mask: false, // TODO: determine from volume metadata
            };

            layer_infos.push(layer_info);
            layer_dims.push((
                vol_entry.metadata.dimensions.0,
                vol_entry.metadata.dimensions.1,
                vol_entry.metadata.dimensions.2,
            ));
            world_to_voxels.push(vol_entry.metadata.world_to_voxel);
            rendered_layers.push(layer_config.volume_id.clone());
        }

        if layer_infos.is_empty() {
            warnings.push("No visible layers to render".to_string());
        }

        // Store viewport size before moving state
        let viewport_size = state.viewport_size;

        // Ensure pipeline exists
        self.ensure_pipeline("slice_world_space")?;

        // Configure render state for layers
        self.clear_render_layers();

        // Ensure volume_metadata is populated with correct data from volumes registry
        for (_i, layer_config) in state.layers.iter().enumerate() {
            if !layer_config.visible {
                continue;
            }

            if let Some(vol_entry) = self.volumes.get(&layer_config.volume_id) {
                // Copy metadata to volume_metadata map with correct data_range
                println!(
                    "DEBUG: Copying volume metadata for '{}' to atlas_index {}",
                    layer_config.volume_id, vol_entry.atlas_index
                );
                println!(
                    "  data_range: ({}, {})",
                    vol_entry.metadata.data_range.0, vol_entry.metadata.data_range.1
                );
                self.volume_metadata
                    .insert(vol_entry.atlas_index, vol_entry.metadata.clone());
            }
        }

        for (i, layer_info) in layer_infos.iter().enumerate() {
            self.add_render_layer(
                layer_info.atlas_index,
                layer_info.opacity,
                layer_info.texture_coords,
            )?;

            // Update layer settings - use layer index, not atlas index!
            self.set_layer_colormap(i, layer_info.colormap_id)?;
            self.update_layer_intensity(
                i,
                layer_info.intensity_range.0,
                layer_info.intensity_range.1,
            )?;
            self.update_layer_threshold(
                i,
                layer_info.threshold_range.0,
                layer_info.threshold_range.1,
            )?;
        }

        // Update all layer uniforms AFTER layers have been added
        self.update_layer_uniforms_direct(&layer_infos, &layer_dims, &world_to_voxels);

        // Update view's last state
        if let Some(view_context) = self.views.get_mut(&view_id) {
            view_context.last_state = Some(state);
        }

        // Create global bind group before render pass
        let global_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Global Bind Group"),
            layout: &self.global_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.frame_ubo_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.crosshair_ubo_buffer.as_entire_binding(),
                },
            ],
        });

        // Create encoder and render pass
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("ViewState Render Encoder"),
            });

        // Execute rendering in a scope to limit borrows
        {
            let view_context =
                self.views
                    .get(&view_id)
                    .ok_or_else(|| RenderLoopError::Internal {
                        code: 8003,
                        details: format!("View '{}' not found", view_id.0),
                    })?;

            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("ViewState Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view_context.render_target,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.0,
                            g: 0.0,
                            b: 0.0,
                            a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            // Get and set pipeline
            let pipeline = self.get_pipeline("slice_world_space")?;
            render_pass.set_pipeline(pipeline);

            // Set global bind group
            render_pass.set_bind_group(0, &global_bind_group, &[]);

            // Set layer bind group if available
            if let Some(layer_storage) = &self.layer_storage_manager {
                if let Some(layer_bind_group) = layer_storage.bind_group() {
                    render_pass.set_bind_group(1, layer_bind_group, &[]);
                }
            }

            // Set texture bind group
            if let Some(multi_texture_manager) = &self.multi_texture_manager {
                if let Some(texture_bind_group) = multi_texture_manager.bind_group() {
                    render_pass.set_bind_group(2, texture_bind_group, &[]);
                }
            }

            // Draw full screen quad
            render_pass.draw(0..6, 0..1);
        } // render_pass is dropped here

        // Record draw call
        self.render_state.record_draw();

        // Submit commands
        self.queue.submit(Some(encoder.finish()));

        // Read back rendered data
        // Calculate aligned bytes_per_row for GPU requirements
        let bytes_per_pixel = 4u32; // RGBA8 = 4 bytes
        let unpadded_bytes_per_row = viewport_size[0] * bytes_per_pixel;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT; // 256 bytes
        let padded_bytes_per_row = ((unpadded_bytes_per_row + align - 1) / align) * align;
        let buffer_size = (padded_bytes_per_row * viewport_size[1]) as u64;

        let staging_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("ViewState Staging Buffer"),
            size: buffer_size,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Copy texture to staging buffer
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("ViewState Copy Encoder"),
            });

        // Get view context again to access texture
        let view_context = self
            .views
            .get(&view_id)
            .ok_or_else(|| RenderLoopError::Internal {
                code: 8004,
                details: format!("View '{}' not found", view_id.0),
            })?;

        encoder.copy_texture_to_buffer(
            wgpu::ImageCopyTexture {
                texture: &view_context.render_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyBuffer {
                buffer: &staging_buffer,
                layout: wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row),
                    rows_per_image: Some(viewport_size[1]),
                },
            },
            wgpu::Extent3d {
                width: viewport_size[0],
                height: viewport_size[1],
                depth_or_array_layers: 1,
            },
        );

        self.queue.submit(Some(encoder.finish()));

        // Map buffer and read data
        let slice = staging_buffer.slice(..);
        let (sender, receiver) = futures_intrusive::channel::shared::oneshot_channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            sender.send(result).expect("Failed to send map result");
        });

        self.device.poll(wgpu::Maintain::Wait);

        let image_data = if let Some(Ok(())) = pollster::block_on(receiver.receive()) {
            let data = slice.get_mapped_range();

            // Use helper to unpack buffer with Y-flip
            let result = Self::unpack_gpu_buffer_to_image(
                &data,
                viewport_size[0],
                viewport_size[1],
                padded_bytes_per_row,
            );

            drop(data);
            staging_buffer.unmap();
            result
        } else {
            warnings.push("Failed to read back rendered image".to_string());
            vec![128u8; (viewport_size[0] * viewport_size[1] * 4) as usize]
        };

        // Calculate render time
        let render_time_ms = start_time.elapsed().as_secs_f32() * 1000.0;

        Ok(FrameResult {
            image_data,
            dimensions: viewport_size,
            render_time_ms,
            warnings,
            rendered_layers,
            used_cpu_fallback: false,
        })
    }

    /// Render to a specific view target
    #[allow(dead_code)]
    async fn render_to_view_target(
        &mut self,
        _target_view: &wgpu::TextureView,
    ) -> Result<Vec<u8>, RenderLoopError> {
        // TODO: Implement actual rendering to view target
        // For now, return placeholder data to complete Phase 1
        let width = 512;
        let height = 512;
        Ok(vec![128u8; (width * height * 4) as usize])
    }

    /// Enable smart texture management with memory limits
    pub fn enable_smart_texture_management(
        &mut self,
        memory_limit_mb: u32,
    ) -> Result<(), RenderLoopError> {
        // Initialize smart texture manager
        self.smart_texture_manager = Some(smart_texture_manager::SmartTextureManager::new(
            smart_texture_manager::MAX_TEXTURES as u32,
            memory_limit_mb,
        ));

        // Create bind group layout for smart texture management
        if self.texture_bind_group_layout.is_none() {
            self.texture_bind_group_layout = Some(
                smart_texture_manager::SmartTextureManager::create_bind_group_layout(
                    &self.device,
                    smart_texture_manager::MAX_TEXTURES as u32,
                ),
            );
        }

        Ok(())
    }

    /// Upload a volume using smart texture management
    pub fn upload_volume_smart<T>(
        &mut self,
        source_volume: &DenseVolume3<T>,
        format_hint: Option<wgpu::TextureFormat>,
    ) -> Result<(u32, Matrix4<f32>), RenderLoopError>
    where
        T: VoxelData
            + num_traits::NumCast
            + serde::Serialize
            + DataRange<T>
            + num_traits::Zero
            + std::ops::Sub<Output = T>
            + std::ops::Div<Output = T>
            + std::ops::Mul<Output = T>,
    {
        // Ensure smart texture manager is initialized
        if self.smart_texture_manager.is_none() {
            return Err(RenderLoopError::Internal {
                code: 6010,
                details:
                    "Smart texture manager not enabled. Call enable_smart_texture_management first."
                        .to_string(),
            });
        }

        let manager = self.smart_texture_manager.as_mut().unwrap();

        // Upload volume using smart format selection and pooling
        let (texture_index, world_to_voxel) =
            manager.upload_volume(&self.device, &self.queue, source_volume, format_hint)?;

        // Update texture bind group
        if let (Some(texture_layout), Some(colormap_view)) = (
            self.texture_bind_group_layout.as_ref(),
            self.texture_manager.colormap_view(),
        ) {
            manager.create_bind_group(
                &self.device,
                texture_layout,
                self.texture_manager.nearest_sampler(),
                colormap_view,
                self.texture_manager.colormap_sampler(),
            )?;
        }

        Ok((texture_index, world_to_voxel))
    }

    /// Release a texture managed by smart texture manager
    pub fn release_smart_texture(&mut self, texture_index: u32) -> Result<(), RenderLoopError> {
        if let Some(ref mut manager) = self.smart_texture_manager {
            manager.release_texture(texture_index)
        } else {
            Err(RenderLoopError::Internal {
                code: 6011,
                details: "Smart texture manager not enabled".to_string(),
            })
        }
    }

    /// Get smart texture manager statistics
    pub fn smart_texture_stats(&self) -> Option<smart_texture_manager::TextureStats> {
        self.smart_texture_manager
            .as_ref()
            .map(|m| m.stats().clone())
    }

    /// Set view state for slice rendering (for GPU slice adapter)
    pub fn set_view_state(
        &mut self,
        view_state: &view_state::ViewState,
    ) -> Result<(), RenderLoopError> {
        // Clear existing layers
        self.clear_render_layers();

        // Set up offscreen target with the correct dimensions
        let viewport_size = (view_state.viewport_size[0], view_state.viewport_size[1]);
        if self.offscreen_dimensions != viewport_size {
            self.create_offscreen_target(view_state.viewport_size[0], view_state.viewport_size[1])?;
        }

        // Update crosshair position
        self.update_crosshair_position(view_state.crosshair_world, view_state.show_crosshair);

        // Calculate field of view and slice parameters from view state
        let fov_mm = view_state.camera.fov_mm;
        let half_fov = fov_mm / 2.0;

        // Convert the camera center and orientation to slice parameters
        let center = view_state.camera.world_center;

        // Generate slice plane vectors based on orientation
        let (u_mm, v_mm) = match view_state.camera.orientation {
            view_state::SliceOrientation::Axial => {
                // Axial: u=right (X+), v=forward (Y+), normal=up (Z+)
                ([1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0])
            }
            view_state::SliceOrientation::Sagittal => {
                // Sagittal: u=forward (Y+), v=up (Z+), normal=right (X+)
                ([0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0])
            }
            view_state::SliceOrientation::Coronal => {
                // Coronal: u=right (X+), v=up (Z+), normal=forward (Y+)
                ([1.0, 0.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0])
            }
        };

        // Calculate origin as center - half_extent in each direction
        let origin_mm = [
            center[0] - half_fov * u_mm[0] - half_fov * v_mm[0],
            center[1] - half_fov * u_mm[1] - half_fov * v_mm[1],
            center[2] - half_fov * u_mm[2] - half_fov * v_mm[2],
            0.0,
        ];

        // Scale vectors to span the full field of view
        let u_scaled = [
            u_mm[0] * fov_mm,
            u_mm[1] * fov_mm,
            u_mm[2] * fov_mm,
            u_mm[3],
        ];
        let v_scaled = [
            v_mm[0] * fov_mm,
            v_mm[1] * fov_mm,
            v_mm[2] * fov_mm,
            v_mm[3],
        ];

        // Update frame UBO with slice parameters
        self.update_frame_ubo(origin_mm, u_scaled, v_scaled);

        // Add layers from view state
        for layer_config in &view_state.layers {
            if !layer_config.visible {
                continue;
            }

            // Look up volume in registry
            let texture_index = if let Some(vol_entry) = self.volumes.get(&layer_config.volume_id) {
                vol_entry.atlas_index
            } else {
                // Fall back to old format for backward compatibility
                if layer_config.volume_id.starts_with("volume_") {
                    layer_config.volume_id[7..].parse::<u32>().map_err(|_| {
                        RenderLoopError::Internal {
                            code: 9030,
                            details: format!(
                                "Invalid volume ID format: {}",
                                layer_config.volume_id
                            ),
                        }
                    })?
                } else {
                    return Err(RenderLoopError::Internal {
                        code: 8002,
                        details: format!("Volume '{}' not registered", layer_config.volume_id),
                    });
                }
            };

            // Add the layer
            self.add_render_layer(texture_index, layer_config.opacity, (0.0, 0.0, 1.0, 1.0))?;

            // Update layer properties
            if let Some(layer) = self
                .layer_state_manager
                .get_layer_mut(self.active_layer_count() - 1)
            {
                layer.colormap_id = layer_config.colormap_id;
                layer.blend_mode = layer_config.blend_mode.clone();
                layer.intensity_range = layer_config.intensity_window;

                // Set threshold if specified
                if let Some(threshold_config) = &layer_config.threshold {
                    layer.threshold_mode = threshold_config.mode.clone();
                    layer.threshold_range = threshold_config.range;
                }
            }
        }

        // Update layer uniforms to apply all changes
        self.update_all_layer_uniforms()?;

        Ok(())
    }

    /// Composite RGBA image using current view state (implements SliceProvider interface)
    pub fn composite_rgba(
        &mut self,
        request: &neuro_types::CompositeRequest,
    ) -> Result<Vec<u8>, RenderLoopError> {
        // Convert CompositeRequest to ViewState
        let view_state =
            crate::slice_adapter::SliceSpecMapper::to_view_state(request).map_err(|e| {
                RenderLoopError::Internal {
                    code: 9032,
                    details: format!("Failed to convert SliceSpec to ViewState: {}", e),
                }
            })?;

        // Set the view state
        self.set_view_state(&view_state)?;

        // Render to buffer and return RGBA data
        self.render_to_buffer()
    }
}

// ... existing tests module ...
#[cfg(test)]
mod tests {
    use super::*;
    // CrosshairUbo is already imported at module level
    // Maintain is imported above if needed
    use approx::assert_abs_diff_eq;
    use bytemuck;
    use pollster;

    #[tokio::test]
    async fn test_wgpu_initialization() {
        let result = RenderLoopService::new().await;
        assert!(
            result.is_ok(),
            "WGPU initialization failed: {:?}",
            result.err()
        );
        if let Ok(service) = result {
            println!(
                "WGPU Initialized successfully with adapter: {:?}",
                service.adapter.get_info()
            );
        }
    }

    // Test for crosshair UBO write and read-back (existing test adapted slightly)
    #[tokio::test]
    async fn test_crosshair_ubo_update() {
        let service = RenderLoopService::new()
            .await
            .expect("Failed to init service");
        let device = &service.device; // Borrow device Arc
        let queue = &service.queue; // Borrow queue Arc

        let test_coords = [10.0, -20.5, 30.0];
        service.set_crosshair(test_coords);

        // Create staging buffer for read-back
        let staging_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("crosshair-staging"),
            size: std::mem::size_of::<CrosshairUbo>() as u64,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Copy UBO to staging buffer
        let mut encoder =
            device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        encoder.copy_buffer_to_buffer(
            &service.crosshair_ubo_buffer,              // Source
            0,                                          // Source offset
            &staging_buffer,                            // Destination
            0,                                          // Destination offset
            std::mem::size_of::<CrosshairUbo>() as u64, // Size
        );
        queue.submit(Some(encoder.finish()));

        // Map the staging buffer for reading
        let slice = staging_buffer.slice(..);
        let (sender, receiver) = futures_intrusive::channel::shared::oneshot_channel(); // Use for callback
        slice.map_async(wgpu::MapMode::Read, move |result| {
            sender.send(result).expect("Failed to send map result");
        });

        // Poll the device until the mapping is complete
        device.poll(wgpu::Maintain::Wait); // Wait for queue to finish and mapping to potentially complete

        // Wait for the callback to signal completion
        if let Some(result) = pollster::block_on(receiver.receive()) {
            result.expect("Failed to map buffer"); // Panic if mapping failed

            // Buffer is mapped, access the data
            let data = slice.get_mapped_range();
            let ubo_data: &CrosshairUbo = bytemuck::from_bytes(&data); // Cast bytes to struct

            println!("Read back UBO: {:?}", ubo_data);

            // Assert coordinates match (using approx for float comparison)
            assert_abs_diff_eq!(ubo_data.world_position[0], test_coords[0], epsilon = 1e-6);
            assert_abs_diff_eq!(ubo_data.world_position[1], test_coords[1], epsilon = 1e-6);
            assert_abs_diff_eq!(ubo_data.world_position[2], test_coords[2], epsilon = 1e-6);

            // Important: Unmap the buffer
            drop(data); // Drop the mapped range view
            staging_buffer.unmap();
            println!("Crosshair UBO read-back test passed.");
        } else {
            panic!("Buffer map callback never occurred");
        }
    }
}

// Note: render_batch will be implemented in Phase 2 after ViewState API is stabilized
// For now, batch_render_slices in api_bridge will render slices individually

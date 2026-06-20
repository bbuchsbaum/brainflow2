//! Public facade for reusable WGPU slice rendering.
//!
//! `WgpuSliceRenderer` is the stable entry point for consumers that want the
//! renderer without depending on Brainflow app state or public WGPU resources.

use crate::multi_texture_manager;
use crate::{AtlasMetrics, RenderLoopError, RenderLoopService};
use render_contracts::{FrameRequestOptions, FrameResult, ViewId, ViewState};
use serde::Serialize;
use volmath::{DataRange, DenseVolume3, VoxelData};

/// Reusable slice renderer built on the runtime WGSL render path.
pub struct WgpuSliceRenderer {
    service: RenderLoopService,
}

impl WgpuSliceRenderer {
    /// Configure WGPU resources and create a renderer.
    pub async fn configure(config: WgpuSliceRendererConfig) -> Result<Self, RenderLoopError> {
        let load_shaders = config.load_shaders;
        let mut service = RenderLoopService::new_with_config(config).await?;
        if load_shaders {
            service.load_shaders()?;
        }
        Ok(Self { service })
    }

    /// Wrap an existing service for compatibility adapters and tests.
    pub fn from_service(service: RenderLoopService) -> Self {
        Self { service }
    }

    /// Register a volume and upload it to GPU memory.
    pub fn register_volume<T>(
        &mut self,
        volume_id: impl Into<String>,
        volume: &DenseVolume3<T>,
        format: RendererVolumeFormat,
    ) -> Result<RendererVolumeHandle, RenderLoopError>
    where
        T: VoxelData
            + num_traits::NumCast
            + Serialize
            + DataRange<T>
            + num_traits::Zero
            + std::ops::Sub<Output = T>
            + std::ops::Div<Output = T>
            + std::ops::Mul<Output = T>,
    {
        let volume_id = volume_id.into();
        self.service
            .register_volume_with_upload(volume_id.clone(), volume, format.to_wgpu())?;

        let texture_index = self
            .service
            .volumes
            .get(&volume_id)
            .map(|entry| entry.atlas_index)
            .ok_or_else(|| RenderLoopError::Internal {
                code: 1701,
                details: format!("Volume '{}' was uploaded but not registered", volume_id),
            })?;

        Ok(RendererVolumeHandle {
            volume_id,
            texture_index,
        })
    }

    /// Render one frame for a view.
    pub async fn request_frame(
        &mut self,
        view_id: ViewId,
        state: ViewState,
    ) -> Result<FrameResult, RenderLoopError> {
        self.service.request_frame(view_id, state).await
    }

    /// Render one frame with explicit readback options.
    pub async fn request_frame_with_options(
        &mut self,
        view_id: ViewId,
        state: ViewState,
        options: FrameRequestOptions,
    ) -> Result<FrameResult, RenderLoopError> {
        self.service
            .request_frame_with_options(view_id, state, options)
            .await
    }

    /// Render several frame requests sequentially on the same GPU service.
    pub async fn request_frames(
        &mut self,
        requests: impl IntoIterator<Item = RendererFrameRequest>,
    ) -> Result<Vec<FrameResult>, RenderLoopError> {
        let mut results = Vec::new();
        for request in requests {
            results.push(
                self.request_frame_with_options(request.view_id, request.state, request.options)
                    .await?,
            );
        }
        Ok(results)
    }

    /// Release a registered volume and its GPU texture.
    pub fn release_volume(&mut self, handle: &RendererVolumeHandle) -> Result<(), RenderLoopError> {
        self.service.release_volume(handle.texture_index)
    }

    /// Release a registered volume by its external identifier.
    pub fn release_volume_by_id(&mut self, volume_id: &str) -> Result<(), RenderLoopError> {
        let texture_index = self
            .service
            .volumes
            .get(volume_id)
            .map(|entry| entry.atlas_index)
            .ok_or_else(|| RenderLoopError::Internal {
                code: 1702,
                details: format!("Volume '{}' is not registered", volume_id),
            })?;
        self.service.release_volume(texture_index)
    }

    /// Current atlas telemetry.
    pub fn atlas_metrics(&self) -> AtlasMetrics {
        self.service.atlas_metrics()
    }

    /// Brainflow compatibility adapter for code that has not migrated yet.
    #[doc(hidden)]
    pub fn legacy_service(&self) -> &RenderLoopService {
        &self.service
    }

    /// Brainflow compatibility adapter for code that has not migrated yet.
    #[doc(hidden)]
    pub fn legacy_service_mut(&mut self) -> &mut RenderLoopService {
        &mut self.service
    }

    /// Return the underlying compatibility service.
    #[doc(hidden)]
    pub fn into_legacy_service(self) -> RenderLoopService {
        self.service
    }
}

/// One frame request for batched facade rendering.
#[derive(Debug, Clone)]
pub struct RendererFrameRequest {
    pub view_id: ViewId,
    pub state: ViewState,
    pub options: FrameRequestOptions,
}

impl RendererFrameRequest {
    pub fn new(view_id: ViewId, state: ViewState) -> Self {
        Self {
            view_id,
            state,
            options: FrameRequestOptions::default(),
        }
    }

    pub fn with_options(mut self, options: FrameRequestOptions) -> Self {
        self.options = options;
        self
    }
}

/// Opaque handle for a GPU-registered volume.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RendererVolumeHandle {
    volume_id: String,
    texture_index: u32,
}

impl RendererVolumeHandle {
    pub fn volume_id(&self) -> &str {
        &self.volume_id
    }

    pub fn texture_index(&self) -> u32 {
        self.texture_index
    }
}

/// Top-level renderer configuration.
#[derive(Debug, Clone)]
pub struct WgpuSliceRendererConfig {
    pub adapter: RendererAdapterConfig,
    pub device: RendererDeviceConfig,
    pub atlas: RendererAtlasConfig,
    pub load_shaders: bool,
}

impl Default for WgpuSliceRendererConfig {
    fn default() -> Self {
        Self {
            adapter: RendererAdapterConfig::default(),
            device: RendererDeviceConfig::default(),
            atlas: RendererAtlasConfig::default(),
            load_shaders: true,
        }
    }
}

/// Adapter selection without exposing raw WGPU adapter objects.
#[derive(Debug, Clone)]
pub struct RendererAdapterConfig {
    pub backends: RendererBackends,
    pub power_preference: RendererPowerPreference,
    pub force_fallback_adapter: bool,
}

impl Default for RendererAdapterConfig {
    fn default() -> Self {
        Self {
            backends: RendererBackends::Primary,
            power_preference: RendererPowerPreference::HighPerformance,
            force_fallback_adapter: false,
        }
    }
}

/// Device request configuration without exposing raw WGPU device objects.
#[derive(Debug, Clone)]
pub struct RendererDeviceConfig {
    pub label: Option<String>,
    pub float32_filterable: RendererFeaturePolicy,
    pub limits: RendererLimits,
}

impl Default for RendererDeviceConfig {
    fn default() -> Self {
        Self {
            label: Some("WGPU Slice Renderer Device".to_string()),
            float32_filterable: RendererFeaturePolicy::RequestIfAvailable,
            limits: RendererLimits::default(),
        }
    }
}

/// Texture atlas and layer-storage sizing.
#[derive(Debug, Clone)]
pub struct RendererAtlasConfig {
    pub dimensions: [u32; 3],
    pub format: RendererVolumeFormat,
    pub label: Option<String>,
    pub max_textures: u32,
    pub initial_layer_capacity: usize,
}

impl Default for RendererAtlasConfig {
    fn default() -> Self {
        Self {
            dimensions: [256, 256, 256],
            format: RendererVolumeFormat::R16Float,
            label: Some("Volume 3D Texture Atlas".to_string()),
            max_textures: multi_texture_manager::MAX_TEXTURES as u32,
            initial_layer_capacity: 32,
        }
    }
}

impl RendererAtlasConfig {
    pub(crate) fn runtime_max_textures(&self) -> u32 {
        self.max_textures
            .max(multi_texture_manager::MAX_TEXTURES as u32)
    }

    pub(crate) fn extent3d(&self) -> wgpu::Extent3d {
        wgpu::Extent3d {
            width: self.dimensions[0],
            height: self.dimensions[1],
            depth_or_array_layers: self.dimensions[2],
        }
    }

    pub(crate) fn required_sampled_textures(&self) -> u32 {
        self.runtime_max_textures()
            .saturating_mul(2)
            .saturating_add(1)
    }
}

/// Backend family selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RendererBackends {
    Primary,
    All,
    Vulkan,
    Metal,
    Dx12,
    Gl,
    BrowserWebGpu,
}

impl RendererBackends {
    pub(crate) fn to_wgpu(self) -> wgpu::Backends {
        match self {
            Self::Primary => wgpu::Backends::PRIMARY,
            Self::All => wgpu::Backends::all(),
            Self::Vulkan => wgpu::Backends::VULKAN,
            Self::Metal => wgpu::Backends::METAL,
            Self::Dx12 => wgpu::Backends::DX12,
            Self::Gl => wgpu::Backends::GL,
            Self::BrowserWebGpu => wgpu::Backends::BROWSER_WEBGPU,
        }
    }
}

/// Adapter power preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RendererPowerPreference {
    LowPower,
    HighPerformance,
    None,
}

impl RendererPowerPreference {
    pub(crate) fn to_wgpu(self) -> wgpu::PowerPreference {
        match self {
            Self::LowPower => wgpu::PowerPreference::LowPower,
            Self::HighPerformance => wgpu::PowerPreference::HighPerformance,
            Self::None => wgpu::PowerPreference::None,
        }
    }
}

/// Optional feature policy for adapter-dependent capabilities.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RendererFeaturePolicy {
    RequestIfAvailable,
    Require,
    Disable,
}

/// Device limits override. Missing fields inherit adapter-resolved defaults.
#[derive(Debug, Clone, Default)]
pub struct RendererLimits {
    pub max_texture_dimension_3d: Option<u32>,
    pub max_sampled_textures_per_shader_stage: Option<u32>,
    pub max_storage_buffers_per_shader_stage: Option<u32>,
    pub max_uniform_buffers_per_shader_stage: Option<u32>,
}

impl RendererLimits {
    pub(crate) fn to_wgpu_limits(
        &self,
        adapter_limits: &wgpu::Limits,
        min_sampled_textures: u32,
    ) -> wgpu::Limits {
        let mut limits = wgpu::Limits::downlevel_defaults()
            .using_resolution(adapter_limits.clone())
            .using_alignment(adapter_limits.clone());

        limits.max_texture_dimension_3d = limits
            .max_texture_dimension_3d
            .max(self.max_texture_dimension_3d.unwrap_or(0));
        limits.max_sampled_textures_per_shader_stage = limits
            .max_sampled_textures_per_shader_stage
            .max(min_sampled_textures)
            .max(self.max_sampled_textures_per_shader_stage.unwrap_or(0));
        limits.max_storage_buffers_per_shader_stage = limits
            .max_storage_buffers_per_shader_stage
            .max(self.max_storage_buffers_per_shader_stage.unwrap_or(0));
        limits.max_uniform_buffers_per_shader_stage = limits
            .max_uniform_buffers_per_shader_stage
            .max(self.max_uniform_buffers_per_shader_stage.unwrap_or(0));

        limits
    }
}

/// Texture format hints accepted by the reusable facade.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RendererVolumeFormat {
    R8Unorm,
    R16Float,
    R32Float,
    R16Uint,
}

impl RendererVolumeFormat {
    pub(crate) fn to_wgpu(self) -> wgpu::TextureFormat {
        match self {
            Self::R8Unorm => wgpu::TextureFormat::R8Unorm,
            Self::R16Float => wgpu::TextureFormat::R16Float,
            Self::R32Float => wgpu::TextureFormat::R32Float,
            Self::R16Uint => wgpu::TextureFormat::R16Uint,
        }
    }
}

//! GPU-backed SliceProvider fixtures for differential testing.

use crate::volume_fixtures::standard_dense_volumes;
use anyhow::{Context, Result};
use neuro_types::SliceProvider;
use render_loop::{GpuSliceAdapter, RenderLoopService};

/// Build a GPU-backed provider loaded with the standard synthetic test volumes.
pub fn create_standard_gpu_provider() -> Result<Box<dyn SliceProvider>> {
    let runtime = tokio::runtime::Runtime::new().context("Failed to create tokio runtime")?;
    let mut render_service = runtime
        .block_on(RenderLoopService::new())
        .context("Failed to initialize RenderLoopService")?;

    render_service
        .load_shaders()
        .context("Failed to load render shaders")?;
    render_service
        .enable_world_space_rendering()
        .context("Failed to enable world-space rendering")?;

    for (volume_id, volume) in standard_dense_volumes()? {
        render_service
            .register_volume_with_upload(volume_id, &volume, wgpu::TextureFormat::R32Float)
            .context("Failed to register GPU test volume")?;
    }

    render_service
        .initialize_colormap()
        .context("Failed to initialize colormap LUT")?;
    render_service
        .create_world_space_bind_groups()
        .context("Failed to create world-space bind groups")?;

    Ok(Box::new(GpuSliceAdapter::new(render_service)))
}

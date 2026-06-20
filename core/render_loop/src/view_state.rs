//! Compatibility re-exports for render view contracts plus renderer-owned view resources.
//!
//! Serializable request/result types live in `render_contracts`. The WGPU-backed
//! `ViewContext` remains here because it owns renderer resources.

pub use render_contracts::view_state::*;

/// Context for a specific view - owns render resources.
pub struct ViewContext {
    pub id: ViewId,
    pub last_state: Option<ViewState>,
    pub render_texture: wgpu::Texture,
    pub render_target: wgpu::TextureView,
    pub dimensions: [u32; 2],
}

impl ViewContext {
    /// Check if render target needs resizing.
    pub fn needs_resize(&self, new_size: [u32; 2]) -> bool {
        self.dimensions != new_size
    }
}

// Shader variant abstraction for safe swapping between different slice shaders
// This allows us to maintain multiple shader implementations without breaking existing code

use bytemuck::Pod;
use std::marker::PhantomData;

/// Trait defining the interface for different slice shader variants
/// Each variant specifies its own WGSL source and associated data types
pub trait SliceVariant: 'static {
    /// The WGSL shader source code
    const WGSL: &'static str;
    
    /// Label for the shader module (used in debugging)
    const LABEL: &'static str;
    
    /// Frame uniform buffer type (must match WGSL struct exactly)
    type FrameUbo: Pod + Send + Sync;
    
    /// Layer data storage buffer type (must match WGSL struct exactly)
    type LayerData: Pod + Send + Sync;
    
    /// Layer metadata uniform buffer type (must match WGSL struct exactly)
    type LayerMetadata: Pod + Send + Sync;
    
    /// Get the size of the frame UBO in bytes
    fn frame_ubo_size() -> wgpu::BufferAddress {
        std::mem::size_of::<Self::FrameUbo>() as wgpu::BufferAddress
    }
    
    /// Get the size of a single layer data entry in bytes
    fn layer_data_size() -> wgpu::BufferAddress {
        std::mem::size_of::<Self::LayerData>() as wgpu::BufferAddress
    }
    
    /// Get the size of the layer metadata in bytes
    fn layer_metadata_size() -> wgpu::BufferAddress {
        std::mem::size_of::<Self::LayerMetadata>() as wgpu::BufferAddress
    }
}

/// Standard slice shader variant - the current working implementation
/// This wraps the existing shader and types without any changes
pub struct StandardSlice;

impl SliceVariant for StandardSlice {
    const WGSL: &'static str = include_str!("../shaders/slice_world_space.wgsl");
    const LABEL: &'static str = "Standard Slice Shader";
    
    // These point to the EXISTING types - no changes needed
    type FrameUbo = crate::ubo::FrameUbo;
    type LayerData = crate::ubo::LayerUboStd140;
    type LayerMetadata = crate::layer_storage::LayerMetadata;
}

/// Precomputed slice shader variant - the optimized implementation
/// This uses precomputed values for better performance
#[cfg(feature = "precomputed-shader")]
pub struct PrecomputedSlice;

#[cfg(feature = "precomputed-shader")]
mod precomputed_types {
    use bytemuck::{Pod, Zeroable};
    
    /// Frame UBO for the optimized shader (smaller, no atlas_dim)
    #[repr(C)]
    #[derive(Debug, Copy, Clone, Pod, Zeroable)]
    pub struct FrameUbo {
        pub origin_mm: [f32; 4],
        pub u_mm: [f32; 4],
        pub v_mm: [f32; 4],
        pub target_dim: [u32; 2],
        pub _padding: [u32; 2],
    }
    
    /// Layer metadata for the optimized shader (smaller)
    #[repr(C)]
    #[derive(Debug, Copy, Clone, Pod, Zeroable)]
    pub struct LayerMetadata {
        pub active_count: u32,
        pub _padding: [u32; 3],
    }
    
    /// Layer data for the optimized shader (with precomputed fields)
    #[repr(C)]
    #[derive(Debug, Copy, Clone, Pod, Zeroable)]
    pub struct LayerData {
        pub world_to_voxel: [[f32; 4]; 4],
        pub dim: [u32; 3],
        pub texture_index: u32,
        pub colormap_id: u32,
        pub blend_mode: u32,
        pub threshold_mode: u32,
        pub is_mask: u32,  // Note: WGSL uses isMask
        pub opacity: f32,
        pub intensity_min: f32,
        pub intensity_max: f32,
        pub thresh_low: f32,
        pub thresh_high: f32,
        pub inv_intensity_delta: f32,  // Precomputed: 1.0 / (max - min)
        pub voxel_size_estimate: f32,  // For LOD calculation
        pub _padding: f32,
    }
}

#[cfg(feature = "precomputed-shader")]
impl SliceVariant for PrecomputedSlice {
    const WGSL: &'static str = include_str!("../shaders/slice_world_space_optimized.wgsl");
    const LABEL: &'static str = "Precomputed Slice Shader";
    
    type FrameUbo = precomputed_types::FrameUbo;
    type LayerData = precomputed_types::LayerData;
    type LayerMetadata = precomputed_types::LayerMetadata;
}

/// Generic slice renderer that works with any variant
pub struct SliceRenderer<V: SliceVariant> {
    pipeline: wgpu::RenderPipeline,
    _phantom: PhantomData<V>,
}

impl<V: SliceVariant> SliceRenderer<V> {
    /// Create a new renderer for the specified variant
    pub fn new(
        device: &wgpu::Device,
        pipeline_layout: &wgpu::PipelineLayout,
        surface_format: wgpu::TextureFormat,
    ) -> Result<Self, crate::RenderLoopError> {
        // Create shader module
        let shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(V::LABEL),
            source: wgpu::ShaderSource::Wgsl(V::WGSL.into()),
        });
        
        // Create pipeline - same configuration as existing code
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(V::LABEL),
            layout: Some(pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader_module,
                entry_point: "vs_main",
                buffers: &[],  // No vertex buffers - generates full-screen quad
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader_module,
                entry_point: "fs_main",
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_format,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::One,
                            dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                            operation: wgpu::BlendOperation::Add,
                        },
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
                unclipped_depth: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
        });
        
        Ok(Self {
            pipeline,
            _phantom: PhantomData,
        })
    }
    
    /// Get the render pipeline
    pub fn pipeline(&self) -> &wgpu::RenderPipeline {
        &self.pipeline
    }
}

/// Runtime shader selection - allows switching between variants
pub enum SelectedSliceRenderer {
    Standard(SliceRenderer<StandardSlice>),
    #[cfg(feature = "precomputed-shader")]
    Precomputed(SliceRenderer<PrecomputedSlice>),
}

impl SelectedSliceRenderer {
    /// Create the appropriate renderer based on configuration
    pub fn new(
        device: &wgpu::Device,
        pipeline_layout: &wgpu::PipelineLayout,
        surface_format: wgpu::TextureFormat,
        use_precomputed: bool,
    ) -> Result<Self, crate::RenderLoopError> {
        #[cfg(feature = "precomputed-shader")]
        {
            if use_precomputed {
                return Ok(Self::Precomputed(
                    SliceRenderer::<PrecomputedSlice>::new(device, pipeline_layout, surface_format)?
                ));
            }
        }
        
        Ok(Self::Standard(
            SliceRenderer::<StandardSlice>::new(device, pipeline_layout, surface_format)?
        ))
    }
    
    /// Get the render pipeline
    pub fn pipeline(&self) -> &wgpu::RenderPipeline {
        match self {
            Self::Standard(renderer) => renderer.pipeline(),
            #[cfg(feature = "precomputed-shader")]
            Self::Precomputed(renderer) => renderer.pipeline(),
        }
    }
}
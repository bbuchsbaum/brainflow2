// Pipeline management module for render loop

use crate::RenderLoopError;
use std::collections::HashMap;
use std::sync::Arc;
use wgpu::{BindGroupLayout, Device, PipelineLayout, RenderPipeline, ShaderModule};

/// Identifies a specific pipeline configuration
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct PipelineKey {
    /// Name of the shader (e.g., "slice", "volume", "overlay")
    pub shader_name: String,
    /// Surface format for the render target
    pub surface_format: wgpu::TextureFormat,
    /// Optional variant identifier for different pipeline configurations
    pub variant: Option<String>,
}

impl PipelineKey {
    pub fn new(shader_name: impl Into<String>, surface_format: wgpu::TextureFormat) -> Self {
        Self {
            shader_name: shader_name.into(),
            surface_format,
            variant: None,
        }
    }

    pub fn with_variant(mut self, variant: impl Into<String>) -> Self {
        self.variant = Some(variant.into());
        self
    }
}

/// Pipeline configuration for creating render pipelines
#[derive(Debug, Clone)]
pub struct PipelineConfig {
    /// Vertex shader entry point
    pub vertex_entry: String,
    /// Fragment shader entry point
    pub fragment_entry: String,
    /// Primitive topology
    pub topology: wgpu::PrimitiveTopology,
    /// Culling mode
    pub cull_mode: Option<wgpu::Face>,
    /// Blend state
    pub blend_state: Option<wgpu::BlendState>,
    /// Depth testing configuration
    pub depth_stencil: Option<wgpu::DepthStencilState>,
    /// Multisample configuration
    pub multisample_count: u32,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        Self {
            vertex_entry: "vs_main".to_string(),
            fragment_entry: "fs_main".to_string(),
            topology: wgpu::PrimitiveTopology::TriangleList,
            cull_mode: None, // No culling for 2D
            blend_state: Some(wgpu::BlendState::ALPHA_BLENDING),
            depth_stencil: None, // No depth testing for 2D
            multisample_count: 1,
        }
    }
}

/// Manages render pipelines with caching and configuration
pub struct PipelineManager {
    /// Cached pipelines by configuration
    pipelines: HashMap<PipelineKey, RenderPipeline>,
    /// Pipeline layouts by shader name
    layouts: HashMap<String, Arc<PipelineLayout>>,
    /// Default configurations for different shader types
    default_configs: HashMap<String, PipelineConfig>,
}

impl PipelineManager {
    pub fn new() -> Self {
        let mut default_configs = HashMap::new();

        // Default configuration for slice rendering
        default_configs.insert("slice".to_string(), PipelineConfig::default());

        // Configuration for volume rendering (future)
        default_configs.insert(
            "volume".to_string(),
            PipelineConfig {
                vertex_entry: "vs_main".to_string(),
                fragment_entry: "fs_main".to_string(),
                topology: wgpu::PrimitiveTopology::TriangleList,
                cull_mode: Some(wgpu::Face::Back),
                blend_state: Some(wgpu::BlendState::ALPHA_BLENDING),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth32Float,
                    depth_write_enabled: true,
                    depth_compare: wgpu::CompareFunction::Less,
                    stencil: wgpu::StencilState::default(),
                    bias: wgpu::DepthBiasState::default(),
                }),
                multisample_count: 1,
            },
        );

        Self {
            pipelines: HashMap::new(),
            layouts: HashMap::new(),
            default_configs,
        }
    }

    /// Create or retrieve a pipeline layout for a shader
    pub fn get_or_create_layout(
        &mut self,
        device: &Device,
        shader_name: &str,
        bind_group_layouts: &[&BindGroupLayout],
    ) -> Arc<PipelineLayout> {
        self.layouts
            .entry(shader_name.to_string())
            .or_insert_with(|| {
                Arc::new(
                    device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                        label: Some(&format!("{} Pipeline Layout", shader_name)),
                        bind_group_layouts,
                        push_constant_ranges: &[],
                    }),
                )
            })
            .clone()
    }

    /// Get or create a render pipeline
    pub fn get_or_create_pipeline(
        &mut self,
        device: &Device,
        key: PipelineKey,
        shader: &ShaderModule,
        layout: &PipelineLayout,
        config: Option<PipelineConfig>,
    ) -> Result<(), RenderLoopError> {
        if self.pipelines.contains_key(&key) {
            return Ok(());
        }

        // Use provided config or default for this shader type
        let config = config.unwrap_or_else(|| {
            self.default_configs
                .get(&key.shader_name)
                .cloned()
                .unwrap_or_default()
        });

        // Create the pipeline
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(&format!("{} Render Pipeline", key.shader_name)),
            layout: Some(layout),
            vertex: wgpu::VertexState {
                module: shader,
                entry_point: &config.vertex_entry,
                buffers: &[], // No vertex buffers for fullscreen shaders
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: shader,
                entry_point: &config.fragment_entry,
                targets: &[Some(wgpu::ColorTargetState {
                    format: key.surface_format,
                    blend: config.blend_state,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: config.topology,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: config.cull_mode,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: config.depth_stencil,
            multisample: wgpu::MultisampleState {
                count: config.multisample_count,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
        });

        self.pipelines.insert(key, pipeline);
        Ok(())
    }

    /// Clear all cached pipelines (useful when surface format changes)
    pub fn clear_pipelines(&mut self) {
        self.pipelines.clear();
    }

    /// Clear pipelines for a specific shader
    pub fn clear_shader_pipelines(&mut self, shader_name: &str) {
        self.pipelines
            .retain(|key, _| key.shader_name != shader_name);
    }

    /// Get an existing pipeline if cached
    pub fn get_pipeline(&self, key: &PipelineKey) -> Option<&RenderPipeline> {
        self.pipelines.get(key)
    }

    /// Update default configuration for a shader type
    pub fn set_default_config(&mut self, shader_name: impl Into<String>, config: PipelineConfig) {
        self.default_configs.insert(shader_name.into(), config);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipeline_key() {
        let key1 = PipelineKey::new("slice", wgpu::TextureFormat::Bgra8UnormSrgb);
        let key2 = PipelineKey::new("slice", wgpu::TextureFormat::Bgra8UnormSrgb)
            .with_variant("wireframe");

        assert_eq!(key1.shader_name, "slice");
        assert_eq!(key1.variant, None);
        assert_eq!(key2.variant, Some("wireframe".to_string()));
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_pipeline_config_default() {
        let config = PipelineConfig::default();
        assert_eq!(config.vertex_entry, "vs_main");
        assert_eq!(config.fragment_entry, "fs_main");
        assert_eq!(config.topology, wgpu::PrimitiveTopology::TriangleList);
        assert!(config.blend_state.is_some());
        assert!(config.depth_stencil.is_none());
    }
}

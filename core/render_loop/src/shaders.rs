// Runtime shader loading module for wgpu 0.20
// This replaces the build-time wgsl_to_wgpu approach for compatibility

use std::collections::HashMap;
use wgpu::{
    BindGroupLayout, BlendState, ColorTargetState, ColorWrites, Device, ShaderModule,
    ShaderModuleDescriptor, ShaderSource,
};

#[cfg(feature = "typed-shaders")]
pub mod typed {
    include!(concat!(env!("OUT_DIR"), "/typed_shaders.rs"));
}

/// Shader loading errors
#[derive(Debug, thiserror::Error)]
pub enum ShaderError {
    #[error("Shader not found: {0}")]
    NotFound(String),
    #[error("Shader compilation failed: {0}")]
    CompilationFailed(String),
    #[error("Shader validation error: {0}")]
    ValidationError(String),
}

/// Result of shader validation
#[derive(Debug, Clone)]
pub struct ShaderValidation {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Manages runtime loading and caching of WGSL shaders
pub struct ShaderManager {
    shaders: HashMap<String, ShaderModule>,
}

impl ShaderManager {
    pub fn new() -> Self {
        Self {
            shaders: HashMap::new(),
        }
    }

    /// Register a shader module that was created externally (e.g. via wgsl_to_wgpu).
    pub fn insert_shader(&mut self, name: &str, module: ShaderModule) {
        self.shaders.insert(name.to_string(), module);
    }

    /// Load a shader from embedded WGSL source
    pub fn load_shader(
        &mut self,
        device: &Device,
        name: &str,
        source: &str,
    ) -> Result<&ShaderModule, ShaderError> {
        if !self.shaders.contains_key(name) {
            let module = device.create_shader_module(ShaderModuleDescriptor {
                label: Some(name),
                source: ShaderSource::Wgsl(source.into()),
            });
            self.shaders.insert(name.to_string(), module);
        }

        self.shaders
            .get(name)
            .ok_or_else(|| ShaderError::NotFound(name.to_string()))
    }

    /// Get a previously loaded shader
    pub fn get_shader(&self, name: &str) -> Option<&ShaderModule> {
        self.shaders.get(name)
    }

    /// Validate WGSL shader source before loading
    pub fn validate_shader(source: &str, name: &str) -> ShaderValidation {
        let mut validation = ShaderValidation {
            valid: true,
            errors: Vec::new(),
            warnings: Vec::new(),
        };

        // Basic syntax validation
        if source.trim().is_empty() {
            validation.valid = false;
            validation.errors.push("Shader source is empty".to_string());
            return validation;
        }

        // Check for required entry points - need to ensure they're actual decorators
        // Use regex or check for whitespace/newline before the @ symbol
        let has_vertex = source.split_whitespace().any(|word| word == "@vertex")
            || source.contains("[[stage(vertex)]]");
        let has_fragment = source.split_whitespace().any(|word| word == "@fragment")
            || source.contains("[[stage(fragment)]]");
        let has_compute = source.split_whitespace().any(|word| word == "@compute")
            || source.contains("[[stage(compute)]]");

        // Check if there are any functions at all (match "fn " with space after)
        let has_functions = source.contains("fn ");

        if !has_vertex && !has_fragment && !has_compute {
            if has_functions {
                validation.warnings.push(
                    "No entry points found (expected @vertex, @fragment, or @compute)".to_string(),
                );
            } else {
                validation
                    .errors
                    .push("No functions found in shader".to_string());
                validation.valid = false;
            }
        }

        // Check for common WGSL errors
        if source.contains("array<") && source.contains("[") {
            // Check for dynamic array indexing with non-constant
            let lines: Vec<&str> = source.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                if line.contains("array<") && i + 1 < lines.len() {
                    // Simple heuristic: warn about potential dynamic indexing
                    if line.contains("[") && !line.contains("const") {
                        validation.warnings.push(format!(
                            "Line {}: Potential dynamic array indexing - consider using const or if/else",
                            i + 1
                        ));
                    }
                }
            }
        }

        // Check for switch statement syntax
        if source.contains("switch") && !source.contains("switch (") {
            validation.errors.push(
                "Invalid switch syntax: switch requires parentheses around the expression"
                    .to_string(),
            );
            validation.valid = false;
        }

        // Validate uniform buffer alignment
        if source.contains("struct") && (source.contains("@group") || source.contains("[[group")) {
            // Look for potential alignment issues
            if source.contains("vec3<") && !source.contains("_pad") {
                validation.warnings.push(
                    "vec3 types in uniform buffers may need padding for std140 alignment"
                        .to_string(),
                );
            }
        }

        // Check for matching entry point names
        if name.starts_with("slice") {
            if !has_vertex || !source.contains("vs_main") {
                validation
                    .errors
                    .push("Slice shader missing required vs_main vertex entry point".to_string());
                validation.valid = false;
            }
            if !has_fragment || !source.contains("fs_main") {
                validation
                    .errors
                    .push("Slice shader missing required fs_main fragment entry point".to_string());
                validation.valid = false;
            }
        }

        validation
    }

    /// Load a shader with validation
    pub fn load_shader_validated(
        &mut self,
        device: &Device,
        name: &str,
        source: &str,
    ) -> Result<(&ShaderModule, ShaderValidation), ShaderError> {
        // Validate first
        let validation = Self::validate_shader(source, name);

        if !validation.valid {
            return Err(ShaderError::ValidationError(validation.errors.join("; ")));
        }

        // Load the shader
        let module = self.load_shader(device, name, source)?;

        Ok((module, validation))
    }
}

/// Helper descriptors for slice shader pipeline creation.
pub struct SliceShaderDescriptors {
    fragment_targets: [Option<ColorTargetState>; 1],
    #[cfg(feature = "typed-shaders")]
    typed_vertex_entry: typed::slice_world_space_optimized::VertexEntry<0>,
    #[cfg(feature = "typed-shaders")]
    typed_fragment_entry: typed::slice_world_space_optimized::FragmentEntry<1>,
}

impl SliceShaderDescriptors {
    pub fn new(target_format: wgpu::TextureFormat) -> Self {
        let color_target = ColorTargetState {
            format: target_format,
            blend: Some(BlendState::ALPHA_BLENDING),
            write_mask: ColorWrites::ALL,
        };
        let fragment_targets = [Some(color_target.clone())];

        #[cfg(feature = "typed-shaders")]
        {
            let typed_vertex_entry = typed::slice_world_space_optimized::vs_main_entry();
            let typed_fragment_entry =
                typed::slice_world_space_optimized::fs_main_entry(fragment_targets.clone());
            Self {
                fragment_targets,
                typed_vertex_entry,
                typed_fragment_entry,
            }
        }

        #[cfg(not(feature = "typed-shaders"))]
        Self { fragment_targets }
    }

    pub fn vertex_entry(&self) -> &'static str {
        "vs_main"
    }

    pub fn fragment_entry(&self) -> &'static str {
        "fs_main"
    }

    pub fn vertex_state<'a>(&'a self, module: &'a ShaderModule) -> wgpu::VertexState<'a> {
        #[cfg(feature = "typed-shaders")]
        {
            typed::slice_world_space_optimized::vertex_state(module, &self.typed_vertex_entry)
        }
        #[cfg(not(feature = "typed-shaders"))]
        {
            wgpu::VertexState {
                module,
                entry_point: self.vertex_entry(),
                buffers: &[],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }
        }
    }

    pub fn fragment_state<'a>(&'a self, module: &'a ShaderModule) -> wgpu::FragmentState<'a> {
        #[cfg(feature = "typed-shaders")]
        {
            typed::slice_world_space_optimized::fragment_state(
                module,
                &self.typed_fragment_entry,
            )
        }
        #[cfg(not(feature = "typed-shaders"))]
        {
            wgpu::FragmentState {
                module,
                entry_point: self.fragment_entry(),
                targets: &self.fragment_targets,
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }
        }
    }

    pub fn color_targets(&self) -> &[Option<ColorTargetState>; 1] {
        &self.fragment_targets
    }
}

pub fn create_slice_pipeline_layout(
    device: &Device,
    global: &BindGroupLayout,
    layer: &BindGroupLayout,
    texture: &BindGroupLayout,
) -> wgpu::PipelineLayout {
    device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("slice_world_space Pipeline Layout"),
        bind_group_layouts: &[global, layer, texture],
        push_constant_ranges: &[],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slice_descriptors_provide_default_entries() {
        let descriptors = SliceShaderDescriptors::new(wgpu::TextureFormat::Rgba8Unorm);
        assert_eq!(descriptors.vertex_entry(), "vs_main");
        assert_eq!(descriptors.fragment_entry(), "fs_main");
        let targets = descriptors.color_targets();
        assert!(targets[0].is_some());
    }
}

// Embedded shader sources
pub mod sources {
    /// World-space slice shader with multi-texture support
    pub const SLICE_WORLD_SPACE: &str = include_str!("../shaders/slice_world_space.wgsl");

    /// Optimized world-space slice shader with performance improvements
    pub const SLICE_WORLD_SPACE_OPTIMIZED: &str =
        include_str!("../shaders/slice_world_space_optimized.wgsl");

    // Debug shaders - kept for potential future debugging but not loaded by default
    #[allow(dead_code)]
    pub const BASIC: &str = include_str!("../shaders/basic.wgsl");
    #[allow(dead_code)]
    pub const TEST: &str = include_str!("../shaders/test.wgsl");
    #[allow(dead_code)]
    pub const SLICE_DEBUG: &str = include_str!("../shaders/slice_debug.wgsl");
    #[allow(dead_code)]
    pub const SLICE_DEBUG2: &str = include_str!("../shaders/slice_debug2.wgsl");
    #[allow(dead_code)]
    pub const SLICE_DEBUG3: &str = include_str!("../shaders/slice_debug3.wgsl");
    #[allow(dead_code)]
    pub const SLICE_SIMPLE: &str = include_str!("../shaders/slice_simple.wgsl");
    #[allow(dead_code)]
    pub const SLICE_DEBUG_SAMPLING: &str = include_str!("../shaders/slice_debug_sampling.wgsl");
    #[allow(dead_code)]
    pub const SLICE_DEBUG_TEXTURE: &str = include_str!("../shaders/slice_debug_texture.wgsl");
    #[allow(dead_code)]
    pub const SLICE_SIMPLIFIED: &str = include_str!("../shaders/slice_simplified.wgsl");
    #[allow(dead_code)]
    pub const SLICE_STORAGE: &str = include_str!("../shaders/slice_storage.wgsl");
}

// Shader binding layouts and types (manually defined for wgpu 0.20)
pub mod layouts {
    use wgpu::{
        BindGroupLayout, BindGroupLayoutDescriptor, BindGroupLayoutEntry, BindingType,
        BufferBindingType, Device, SamplerBindingType, ShaderStages, TextureSampleType,
        TextureViewDimension,
    };

    /// Create bind group layout for per-frame globals (Group 0)
    pub fn create_frame_layout(device: &Device) -> BindGroupLayout {
        #[cfg(feature = "typed-shaders")]
        {
            return crate::shaders::typed::slice_world_space_optimized::bind_groups::BindGroup0::get_bind_group_layout(device);
        }

        #[cfg(not(feature = "typed-shaders"))]
        device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Frame Bind Group Layout"),
            entries: &[
                // Frame UBO
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::VERTEX | ShaderStages::FRAGMENT,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None, // Let wgpu validate
                    },
                    count: None,
                },
                // Crosshair UBO (with show_crosshair flag)
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // ViewPlane UBO removed - view plane info is now encoded in frame vectors
            ],
        })
    }

    /// Create bind group layout for layer data (Group 1)
    pub fn create_layer_layout(device: &Device) -> BindGroupLayout {
        device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Layer Bind Group Layout"),
            entries: &[
                // Layer UBOs array
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Active layer count
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        })
    }

    /// Create bind group layout for layer data using storage buffers (Group 1)
    pub fn create_layer_storage_layout(device: &Device) -> BindGroupLayout {
        device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Layer Storage Bind Group Layout"),
            entries: &[
                // Layer data storage buffer
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::VERTEX_FRAGMENT,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Layer metadata uniform buffer
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::VERTEX_FRAGMENT,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        })
    }

    /// Create bind group layout for textures (Group 2)
    pub fn create_texture_layout(device: &Device) -> BindGroupLayout {
        device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Texture Bind Group Layout"),
            entries: &[
                // Volume atlas texture
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        multisampled: false,
                        view_dimension: TextureViewDimension::D2Array,
                        sample_type: TextureSampleType::Float { filterable: true },
                    },
                    count: None,
                },
                // Linear sampler
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
                // Colormap LUT texture
                BindGroupLayoutEntry {
                    binding: 2,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        multisampled: false,
                        view_dimension: TextureViewDimension::D2Array,
                        sample_type: TextureSampleType::Float { filterable: true },
                    },
                    count: None,
                },
                // Colormap sampler
                BindGroupLayoutEntry {
                    binding: 3,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        })
    }

    /// Create bind group layout for textures (Group 2) - 3D version
    pub fn create_texture_layout_3d(device: &Device) -> BindGroupLayout {
        device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Texture Bind Group Layout (3D)"),
            entries: &[
                // Volume atlas texture - 3D
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        multisampled: false,
                        view_dimension: TextureViewDimension::D3,
                        sample_type: TextureSampleType::Float { filterable: true },
                    },
                    count: None,
                },
                // Linear sampler
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
                // Colormap LUT texture
                BindGroupLayoutEntry {
                    binding: 2,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        multisampled: false,
                        view_dimension: TextureViewDimension::D2Array,
                        sample_type: TextureSampleType::Float { filterable: true },
                    },
                    count: None,
                },
                // Colormap sampler
                BindGroupLayoutEntry {
                    binding: 3,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        })
    }
}

// Uniform buffer structures (matching WGSL definitions)
pub mod uniforms {
    use bytemuck::{Pod, Zeroable};

    /// Active layer count uniform
    #[repr(C)]
    #[derive(Debug, Clone, Copy, Pod, Zeroable)]
    pub struct ActiveLayerCount {
        pub count: u32,
        pub _pad: [u32; 3], // Padding to 16 bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shader_sources() {
        // Verify shader sources are included
        assert!(!sources::BASIC.is_empty());
        assert!(sources::BASIC.contains("vs_main"));
        assert!(sources::BASIC.contains("fs_main"));

        assert!(!sources::SLICE_SIMPLIFIED.is_empty());
        assert!(sources::SLICE_SIMPLIFIED.contains("FrameUbo"));
        assert!(sources::SLICE_SIMPLIFIED.contains("LayerUBO"));
    }

    #[test]
    fn test_uniform_sizes() {
        use std::mem;

        // Verify uniform buffer sizes match WGSL expectations
        assert_eq!(mem::size_of::<uniforms::ActiveLayerCount>(), 16); // u32 + pad

        // Test sizes of UBOs from ubo module
        assert_eq!(mem::size_of::<crate::FrameUbo>(), 80); // 3 * vec4 + atlas_dim + target_dim + padding
        assert_eq!(mem::size_of::<crate::CrosshairUbo>(), 16); // vec3 + pad
        assert_eq!(mem::size_of::<crate::ubo::ViewPlaneUbo>(), 16); // u32 + pad
        assert_eq!(mem::size_of::<crate::LayerUboStd140>(), 144); // std140 layout
    }
}

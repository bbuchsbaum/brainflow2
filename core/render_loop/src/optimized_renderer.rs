// Optimized renderer implementation for multi-resolution performance

use wgpu::{Device, Queue, RenderPipeline, BindGroupLayout, util::DeviceExt};
use crate::{RenderLoopError, FrameUbo, CrosshairUboUpdated};
use crate::layer_uniforms_optimized::LayerStorageManagerOptimized;
use crate::multi_texture_manager::MultiTextureManager;
use crate::pipeline::PipelineManager;
use crate::render_state::LayerInfo;
use nalgebra::Matrix4;

/// Optimized renderer with performance enhancements for multi-resolution sampling
pub struct OptimizedRenderer {
    /// Pipeline manager for optimized shaders
    pipeline_manager: PipelineManager,
    /// Optimized layer storage manager
    layer_manager: LayerStorageManagerOptimized,
    /// Frame uniform buffer
    frame_buffer: wgpu::Buffer,
    /// Crosshair uniform buffer
    crosshair_buffer: wgpu::Buffer,
    /// Bind group layouts
    frame_bind_group_layout: BindGroupLayout,
    layer_bind_group_layout: BindGroupLayout,
    texture_bind_group_layout: BindGroupLayout,
    /// Current frame UBO data
    frame_data: FrameUbo,
    /// Current crosshair data
    crosshair_data: CrosshairUboUpdated,
}

impl OptimizedRenderer {
    /// Create a new optimized renderer
    pub fn new(device: &Device) -> Result<Self, RenderLoopError> {
        // Create bind group layouts
        let frame_bind_group_layout = Self::create_frame_bind_group_layout(device);
        let layer_bind_group_layout = LayerStorageManagerOptimized::create_bind_group_layout(device);
        let texture_bind_group_layout = MultiTextureManager::create_bind_group_layout(device, 16);
        
        // Create pipeline manager
        let pipeline_manager = PipelineManager::new();
        
        // Create layer manager with initial capacity
        let layer_manager = LayerStorageManagerOptimized::new(device, 16);
        
        // Create frame uniform buffer
        let frame_data = FrameUbo::default();
        let frame_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Optimized Frame UBO"),
            contents: bytemuck::bytes_of(&frame_data),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        
        // Create crosshair uniform buffer
        let crosshair_data = CrosshairUboUpdated::default();
        let crosshair_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Optimized Crosshair UBO"),
            contents: bytemuck::bytes_of(&crosshair_data),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        
        Ok(Self {
            pipeline_manager,
            layer_manager,
            frame_buffer,
            crosshair_buffer,
            frame_bind_group_layout,
            layer_bind_group_layout,
            texture_bind_group_layout,
            frame_data,
            crosshair_data,
        })
    }
    
    /// Create frame bind group layout
    fn create_frame_bind_group_layout(device: &Device) -> BindGroupLayout {
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Optimized Frame Bind Group Layout"),
            entries: &[
                // Frame UBO
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Crosshair UBO
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        })
    }
    
    /// Load and compile the optimized shader
    pub fn load_optimized_shader(&mut self, device: &Device) -> Result<(), RenderLoopError> {
        // Load the optimized shader source
        let shader_source = include_str!("../shaders/slice_world_space_optimized.wgsl");
        
        // Create shader module
        let shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Optimized Slice Shader"),
            source: wgpu::ShaderSource::Wgsl(shader_source.into()),
        });
        
        // Create pipeline layout
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Optimized Pipeline Layout"),
            bind_group_layouts: &[
                &self.frame_bind_group_layout,
                &self.layer_bind_group_layout,
                &self.texture_bind_group_layout,
            ],
            push_constant_ranges: &[],
        });
        
        // Create render pipeline
        let _pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Optimized Render Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader_module,
                entry_point: "vs_main",
                buffers: &[], // No vertex buffers, generating vertices in shader
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader_module,
                entry_point: "fs_main",
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Bgra8UnormSrgb,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
        });
        
        // Store the pipeline (simplified for example)
        // In real implementation, use PipelineManager to cache pipelines
        
        Ok(())
    }
    
    /// Update frame parameters
    pub fn update_frame_params(
        &mut self,
        queue: &Queue,
        origin_mm: [f32; 4],
        u_mm: [f32; 4],
        v_mm: [f32; 4],
        target_dim: [u32; 2],
    ) {
        self.frame_data.origin_mm = origin_mm;
        self.frame_data.u_mm = u_mm;
        self.frame_data.v_mm = v_mm;
        self.frame_data.target_dim = target_dim;
        self.frame_data._padding_target = [0, 0];
        
        queue.write_buffer(&self.frame_buffer, 0, bytemuck::bytes_of(&self.frame_data));
    }
    
    /// Update crosshair position
    pub fn update_crosshair(
        &mut self,
        queue: &Queue,
        world_position: [f32; 3],
        show_crosshair: bool,
    ) {
        self.crosshair_data.world_position = world_position;
        self.crosshair_data.show_crosshair = if show_crosshair { 1 } else { 0 };
        
        queue.write_buffer(&self.crosshair_buffer, 0, bytemuck::bytes_of(&self.crosshair_data));
    }
    
    /// Update layers with optimized data
    pub fn update_layers(
        &mut self,
        device: &Device,
        queue: &Queue,
        layers: &[LayerInfo],
        volume_dimensions: &[(u32, u32, u32)],
        world_to_voxel_transforms: &[Matrix4<f32>],
    ) {
        self.layer_manager.update_layers(
            device,
            queue,
            &self.layer_bind_group_layout,
            layers,
            volume_dimensions,
            world_to_voxel_transforms,
        );
    }
    
    /// Create frame bind group
    pub fn create_frame_bind_group(&self, device: &Device) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Optimized Frame Bind Group"),
            layout: &self.frame_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.frame_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.crosshair_buffer.as_entire_binding(),
                },
            ],
        })
    }
    
    /// Render with optimized pipeline
    pub fn render(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        target_view: &wgpu::TextureView,
        frame_bind_group: &wgpu::BindGroup,
        texture_bind_group: &wgpu::BindGroup,
        pipeline: &RenderPipeline,
    ) {
        let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Optimized Render Pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        
        // Set pipeline
        render_pass.set_pipeline(pipeline);
        
        // Set bind groups
        render_pass.set_bind_group(0, frame_bind_group, &[]);
        if let Some(layer_bind_group) = self.layer_manager.bind_group() {
            render_pass.set_bind_group(1, layer_bind_group, &[]);
        }
        render_pass.set_bind_group(2, texture_bind_group, &[]);
        
        // Draw full-screen quad (6 vertices)
        render_pass.draw(0..6, 0..1);
    }
}

/// Performance monitoring for the optimized renderer
pub struct PerformanceMonitor {
    frame_times: Vec<f32>,
    sample_count: usize,
    current_index: usize,
}

impl PerformanceMonitor {
    pub fn new(sample_count: usize) -> Self {
        Self {
            frame_times: vec![0.0; sample_count],
            sample_count,
            current_index: 0,
        }
    }
    
    pub fn record_frame_time(&mut self, time_ms: f32) {
        self.frame_times[self.current_index] = time_ms;
        self.current_index = (self.current_index + 1) % self.sample_count;
    }
    
    pub fn average_frame_time(&self) -> f32 {
        self.frame_times.iter().sum::<f32>() / self.sample_count as f32
    }
    
    pub fn fps(&self) -> f32 {
        let avg_ms = self.average_frame_time();
        if avg_ms > 0.0 {
            1000.0 / avg_ms
        } else {
            0.0
        }
    }
}
// Optimized layer uniform buffer management with precomputed values

use crate::render_state::LayerInfo;
use bytemuck::{Pod, Zeroable};
use nalgebra::Matrix4;
use wgpu::{util::DeviceExt, BindGroup, BindGroupLayout, Buffer, Device, Queue};

/// Optimized layer data structure with precomputed values for performance
#[repr(C)]
#[derive(Debug, Copy, Clone, Pod, Zeroable)]
pub struct LayerDataOptimized {
    // --- 16-byte aligned types first ---
    pub world_to_voxel: [[f32; 4]; 4], // 64 bytes, offset 0

    // --- Volume info ---
    pub dim: [u32; 3],      // 12 bytes, offset 64
    pub texture_index: u32, // 4 bytes, offset 76

    // --- Rendering parameters ---
    pub colormap_id: u32,    // 4 bytes, offset 80
    pub blend_mode: u32,     // 4 bytes, offset 84
    pub threshold_mode: u32, // 4 bytes, offset 88
    pub is_mask: u32,        // 4 bytes, offset 92

    pub opacity: f32,       // 4 bytes, offset 96
    pub intensity_min: f32, // 4 bytes, offset 100
    pub intensity_max: f32, // 4 bytes, offset 104
    pub thresh_low: f32,    // 4 bytes, offset 108

    pub thresh_high: f32,         // 4 bytes, offset 112
    pub has_alpha_mask: u32,      // 4 bytes, offset 116
    pub inv_intensity_delta: f32, // 4 bytes, offset 120
    pub voxel_size_estimate: f32, // 4 bytes, offset 124
    pub _padding: f32,            // 4 bytes, offset 128
                                  // Total size: 132 bytes
}

impl Default for LayerDataOptimized {
    fn default() -> Self {
        Self {
            world_to_voxel: crate::matrix_to_cols_array(&Matrix4::identity()),
            dim: [1; 3],
            texture_index: 0,
            colormap_id: 0,
            blend_mode: 0,
            threshold_mode: 0,
            is_mask: 0,
            opacity: 1.0,
            intensity_min: 0.0,
            intensity_max: 1.0,
            thresh_low: -f32::INFINITY,
            thresh_high: f32::INFINITY,
            has_alpha_mask: 0,
            inv_intensity_delta: 1.0,
            voxel_size_estimate: 1.0,
            _padding: 0.0,
        }
    }
}

/// Layer metadata for shader
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct LayerMetadata {
    pub active_count: u32,
    pub _padding: [u32; 3],
}

/// Optimized layer storage manager with performance enhancements
pub struct LayerStorageManagerOptimized {
    /// Storage buffer containing layer data
    layer_buffer: Buffer,
    /// Uniform buffer containing metadata
    metadata_buffer: Buffer,
    /// Bind group for layer data
    bind_group: Option<BindGroup>,
    /// Current layer data
    layer_data: Vec<LayerDataOptimized>,
    /// Active layer count
    active_count: u32,
    /// Maximum capacity of the current buffer
    capacity: usize,
}

impl LayerStorageManagerOptimized {
    /// Create a new optimized layer storage manager
    pub fn new(device: &Device, initial_capacity: usize) -> Self {
        let capacity = initial_capacity.max(8);

        // Create storage buffer for layers
        let layer_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Optimized Layer Storage Buffer"),
            size: (std::mem::size_of::<LayerDataOptimized>() * capacity) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create metadata uniform buffer
        let metadata = LayerMetadata {
            active_count: 0,
            _padding: [0; 3],
        };
        let metadata_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Layer Metadata Buffer"),
            contents: bytemuck::bytes_of(&metadata),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        Self {
            layer_buffer,
            metadata_buffer,
            bind_group: None,
            layer_data: Vec::with_capacity(capacity),
            active_count: 0,
            capacity,
        }
    }

    /// Create bind group layout for optimized storage buffers
    pub fn create_bind_group_layout(device: &Device) -> BindGroupLayout {
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Optimized Layer Storage Bind Group Layout"),
            entries: &[
                // Layer data storage buffer
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Metadata uniform buffer
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

    /// Create bind group for layer data
    pub fn create_bind_group(&mut self, device: &Device, layout: &BindGroupLayout) {
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Optimized Layer Storage Bind Group"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.layer_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.metadata_buffer.as_entire_binding(),
                },
            ],
        });

        self.bind_group = Some(bind_group);
    }

    /// Compute voxel size estimate from transform matrix
    fn compute_voxel_size(transform: &Matrix4<f32>) -> f32 {
        // Extract scale factors from the transform matrix
        let scale_x =
            (transform[(0, 0)].powi(2) + transform[(1, 0)].powi(2) + transform[(2, 0)].powi(2))
                .sqrt();
        let scale_y =
            (transform[(0, 1)].powi(2) + transform[(1, 1)].powi(2) + transform[(2, 1)].powi(2))
                .sqrt();
        let scale_z =
            (transform[(0, 2)].powi(2) + transform[(1, 2)].powi(2) + transform[(2, 2)].powi(2))
                .sqrt();

        // Return average voxel size
        (scale_x + scale_y + scale_z) / 3.0
    }

    /// Update layer data with optimized precomputed values
    pub fn update_layers(
        &mut self,
        device: &Device,
        queue: &Queue,
        layout: &BindGroupLayout,
        layers: &[LayerInfo],
        volume_dimensions: &[(u32, u32, u32)],
        world_to_voxel_transforms: &[Matrix4<f32>],
    ) {
        let layer_count = layers.len();

        // Ensure capacity
        if layer_count > self.capacity {
            self.resize_buffer(device, layout, layer_count);
        }

        // Clear and update layer data
        self.layer_data.clear();
        self.active_count = layer_count as u32;

        let identity = Matrix4::identity();
        let default_dims = (1, 1, 1);

        for i in 0..layer_count {
            let layer = &layers[i];
            let dims = volume_dimensions.get(i).unwrap_or(&default_dims);
            let transform = world_to_voxel_transforms.get(i).unwrap_or(&identity);

            // Precompute optimization values
            let intensity_delta = layer.intensity_range.1 - layer.intensity_range.0;
            let inv_intensity_delta = if intensity_delta > 1e-9 {
                1.0 / intensity_delta
            } else {
                1.0
            };

            let voxel_size_estimate = Self::compute_voxel_size(transform);

            // Use the mask fields from LayerInfo
            let is_mask = if layer.is_mask { 1 } else { 0 };
            let has_mask = if layer.has_alpha_mask { 1 } else { 0 };

            let layer_data = LayerDataOptimized {
                // Convert matrix to column-major format for GPU
                world_to_voxel: crate::matrix_to_cols_array(transform),
                dim: [dims.0, dims.1, dims.2],
                texture_index: layer.atlas_index,
                colormap_id: layer.colormap_id,
                blend_mode: layer.blend_mode as u32,
                threshold_mode: layer.threshold_mode as u32,
                is_mask,
                opacity: layer.opacity,
                intensity_min: layer.intensity_range.0,
                intensity_max: layer.intensity_range.1,
                thresh_low: layer.threshold_range.0,
                thresh_high: layer.threshold_range.1,
                has_alpha_mask: has_mask,
                inv_intensity_delta,
                voxel_size_estimate,
                _padding: 0.0,
            };

            self.layer_data.push(layer_data);
        }

        // Update GPU buffers
        if !self.layer_data.is_empty() {
            queue.write_buffer(
                &self.layer_buffer,
                0,
                bytemuck::cast_slice(&self.layer_data),
            );
        }

        // Update metadata
        let metadata = LayerMetadata {
            active_count: self.active_count,
            _padding: [0; 3],
        };
        queue.write_buffer(&self.metadata_buffer, 0, bytemuck::bytes_of(&metadata));
    }

    /// Resize the storage buffer if needed
    fn resize_buffer(&mut self, device: &Device, layout: &BindGroupLayout, required: usize) {
        // Calculate new capacity (grow by 50% or to required size)
        let new_capacity = required.max(self.capacity + self.capacity / 2);

        // Create new buffer
        self.layer_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Optimized Layer Storage Buffer (Resized)"),
            size: (std::mem::size_of::<LayerDataOptimized>() * new_capacity) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        self.capacity = new_capacity;
        self.layer_data
            .reserve(new_capacity - self.layer_data.len());

        // Recreate bind group with new buffer
        self.create_bind_group(device, layout);
    }

    /// Get the current bind group
    pub fn bind_group(&self) -> Option<&BindGroup> {
        self.bind_group.as_ref()
    }

    /// Get active layer count
    pub fn active_count(&self) -> u32 {
        self.active_count
    }
}

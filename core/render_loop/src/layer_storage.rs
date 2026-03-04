// Storage buffer version of layer management for dynamic layer support

use crate::render_state::LayerInfo;
use crate::LayerUboStd140;
use bytemuck;
use log::debug;
use nalgebra::Matrix4;
use wgpu::{util::DeviceExt, BindGroupLayout, Buffer, Device, Queue};

#[cfg(feature = "typed-shaders")]
use crate::shaders::typed::slice_world_space_optimized;
#[cfg(feature = "typed-shaders")]
use wgpu::BufferBinding;

#[cfg(not(feature = "typed-shaders"))]
use wgpu::BindGroup;

#[cfg(feature = "typed-shaders")]
type LayerBindGroup = slice_world_space_optimized::bind_groups::BindGroup1;
#[cfg(not(feature = "typed-shaders"))]
type LayerBindGroup = BindGroup;

/// Layer metadata for shader
#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct LayerMetadata {
    pub active_count: u32,
    pub _padding: [u32; 7], // Pad to 32 bytes for shader validation
}

/// Manages layer data using storage buffers for dynamic sizing
pub struct LayerStorageManager {
    /// Storage buffer containing layer data
    layer_buffer: Buffer,
    /// Uniform buffer containing metadata
    metadata_buffer: Buffer,
    /// Bind group for layer data
    bind_group: Option<LayerBindGroup>,
    /// Current layer data
    layer_data: Vec<LayerUboStd140>,
    /// Active layer count
    active_count: u32,
    /// Maximum capacity of the current buffer
    capacity: usize,
}

impl LayerStorageManager {
    /// Create a new layer storage manager with initial capacity
    pub fn new(device: &Device, initial_capacity: usize) -> Self {
        let capacity = initial_capacity.max(8); // Minimum 8 layers

        // Create storage buffer for layers
        let layer_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Layer Storage Buffer"),
            size: (std::mem::size_of::<LayerUboStd140>() * capacity) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // Create metadata uniform buffer
        let metadata = LayerMetadata {
            active_count: 0,
            _padding: [0; 7],
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

    /// Create bind group layout for storage buffers
    pub fn create_bind_group_layout(device: &Device) -> BindGroupLayout {
        #[cfg(feature = "typed-shaders")]
        {
            return slice_world_space_optimized::bind_groups::BindGroup1::get_bind_group_layout(
                device,
            );
        }

        #[cfg(not(feature = "typed-shaders"))]
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Layer Storage Bind Group Layout"),
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
    #[cfg(feature = "typed-shaders")]
    pub fn create_bind_group(&mut self, device: &Device, _layout: &BindGroupLayout) {
        let bind_group = slice_world_space_optimized::bind_groups::BindGroup1::from_bindings(
            device,
            slice_world_space_optimized::bind_groups::BindGroupLayout1 {
                layer_data: BufferBinding {
                    buffer: &self.layer_buffer,
                    offset: 0,
                    size: None,
                },
                layer_metadata: BufferBinding {
                    buffer: &self.metadata_buffer,
                    offset: 0,
                    size: None,
                },
            },
        );

        self.bind_group = Some(bind_group);
    }

    /// Create bind group for layer data
    #[cfg(not(feature = "typed-shaders"))]
    pub fn create_bind_group(&mut self, device: &Device, layout: &BindGroupLayout) {
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Layer Storage Bind Group"),
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

    /// Resize the storage buffer if needed
    fn ensure_capacity(&mut self, device: &Device, layout: &BindGroupLayout, required: usize) {
        if required > self.capacity {
            // Calculate new capacity (grow by 50% or to required size, whichever is larger)
            let new_capacity = required.max(self.capacity + self.capacity / 2);

            // Create new buffer
            self.layer_buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("Layer Storage Buffer (Resized)"),
                size: (std::mem::size_of::<LayerUboStd140>() * new_capacity) as u64,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });

            self.capacity = new_capacity;
            self.layer_data
                .reserve(new_capacity - self.layer_data.len());

            // Recreate bind group with new buffer
            self.create_bind_group(device, layout);
        }
    }

    /// Update layer data from layer info
    pub fn update_layers(
        &mut self,
        device: &Device,
        queue: &Queue,
        layout: &BindGroupLayout,
        layers: &[LayerInfo],
        volume_dimensions: &[(u32, u32, u32)],
        world_to_voxel_transforms: &[Matrix4<f32>],
    ) {
        self.update_layers_with_display(
            device,
            queue,
            layout,
            layers,
            volume_dimensions,
            world_to_voxel_transforms,
            None,
        );
    }

    /// Update layer data with optional display overrides: (atlas_index, enabled, thickness_px)
    pub fn update_layers_with_display(
        &mut self,
        device: &Device,
        queue: &Queue,
        layout: &BindGroupLayout,
        layers: &[LayerInfo],
        volume_dimensions: &[(u32, u32, u32)],
        world_to_voxel_transforms: &[Matrix4<f32>],
        display_overrides: Option<&[(u32, bool, f32)]>,
    ) {
        let layer_count = layers.len();

        // Ensure we have capacity
        self.ensure_capacity(device, layout, layer_count);

        self.active_count = layer_count as u32;
        self.layer_data.clear();

        let display_map: std::collections::HashMap<u32, (bool, f32)> = match display_overrides {
            Some(entries) => entries
                .iter()
                .copied()
                .map(|(idx, en, th)| (idx, (en, th)))
                .collect(),
            None => Default::default(),
        };

        // Build layer data
        let identity = Matrix4::identity();
        let default_dims = (1, 1, 1);

        for i in 0..layer_count {
            let layer = &layers[i];
            let dims = volume_dimensions.get(i).unwrap_or(&default_dims);
            let transform = world_to_voxel_transforms.get(i).unwrap_or(&identity);

            // Debug: Log the transform being used (commented out to reduce log noise)
            // println!("LayerStorageManager: Layer {} world_to_voxel transform:", i);
            // println!("  Input matrix (Debug format shows rows): {:?}", transform);
            // println!("  Matrix element (0,3) = {}", transform[(0, 3)]);
            // println!("  Matrix element (3,0) = {}", transform[(3, 0)]);
            let _converted: [[f32; 4]; 4] = (*transform).into();
            // println!("  Converted array: {:?}", converted);

            // Test transformation of a few key points (commented out to reduce log noise)
            // let test_points = [
            //     [0.0, 0.0, 0.0, 1.0],     // origin
            //     [96.5, 114.5, 96.5, 1.0], // crosshair
            //     [-96.0, -132.0, -78.0, 1.0], // min corner
            //     [96.0, 132.0, 114.0, 1.0],   // max corner
            // ];
            // println!("  Testing world->voxel transformation:");
            // for (idx, point) in test_points.iter().enumerate() {
            //     let world_vec = nalgebra::Vector4::new(point[0], point[1], point[2], point[3]);
            //     let voxel_vec = transform * world_vec;
            //     println!("    Point {}: world=[{:.1}, {:.1}, {:.1}] -> voxel=[{:.1}, {:.1}, {:.1}]",
            //         idx, point[0], point[1], point[2],
            //         voxel_vec[0], voxel_vec[1], voxel_vec[2]);
            // }

            // Only treat as mask if explicitly marked or has binary-like threshold
            let _is_mask = false; // TODO: Add explicit mask flag to LayerInfo

            let (border_enabled, border_thickness) = display_map
                .get(&layer.atlas_index)
                .copied()
                .unwrap_or((false, 1.0_f32));

            debug!(
                "LayerStorageManager::update_layers_with_display - layer {}: atlas_index={}, dims=({},{},{}), blend_mode={:?}, opacity={}, colormap_id={}, threshold=({:.3},{:.3}), threshold_mode={:?}",
                i,
                layer.atlas_index,
                dims.0,
                dims.1,
                dims.2,
                layer.blend_mode,
                layer.opacity,
                layer.colormap_id,
                layer.threshold_range.0,
                layer.threshold_range.1,
                layer.threshold_mode
            );

            debug!(
                "  world_to_voxel (row-major): [{:.3} {:.3} {:.3} {:.3}; {:.3} {:.3} {:.3} {:.3}; {:.3} {:.3} {:.3} {:.3}; {:.3} {:.3} {:.3} {:.3}]",
                transform[(0, 0)], transform[(0, 1)], transform[(0, 2)], transform[(0, 3)],
                transform[(1, 0)], transform[(1, 1)], transform[(1, 2)], transform[(1, 3)],
                transform[(2, 0)], transform[(2, 1)], transform[(2, 2)], transform[(2, 3)],
                transform[(3, 0)], transform[(3, 1)], transform[(3, 2)], transform[(3, 3)],
            );

            let layer_data = LayerUboStd140 {
                // Convert matrix to column-major format for GPU
                world_to_voxel: crate::matrix_to_cols_array(transform),
                texture_coords: [
                    layer.texture_coords.0,
                    layer.texture_coords.1,
                    layer.texture_coords.2,
                    layer.texture_coords.3,
                ],
                dim: [dims.0, dims.1, dims.2],
                pad_slices: 0,
                colormap_id: layer.colormap_id,
                blend_mode: layer.blend_mode as u32,
                texture_index: layer.atlas_index,
                threshold_mode: layer.threshold_mode as u32,
                opacity: layer.opacity,
                intensity_min: layer.intensity_range.0,
                intensity_max: layer.intensity_range.1,
                thresh_low: layer.threshold_range.0,
                thresh_high: layer.threshold_range.1,
                is_mask: if layer.is_mask { 1 } else { 0 },
                has_alpha_mask: if layer.has_alpha_mask { 1 } else { 0 },
                interpolation_mode: layer.interpolation_mode,
                draw_slice_border: if border_enabled { 1 } else { 0 },
                border_thickness_px: border_thickness.max(0.5_f32),
                _pad: [0; 2],
            };

            self.layer_data.push(layer_data);
        }

        // Upload layer data to GPU
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
            _padding: [0; 7],
        };

        queue.write_buffer(&self.metadata_buffer, 0, bytemuck::bytes_of(&metadata));

        // Create bind group if it doesn't exist yet
        if self.bind_group.is_none() {
            self.create_bind_group(device, layout);
        }
    }

    /// Update a single layer's properties
    pub fn update_layer(
        &mut self,
        queue: &Queue,
        index: usize,
        layer: &LayerInfo,
        volume_dims: (u32, u32, u32),
        world_to_voxel: &Matrix4<f32>,
    ) -> Result<(), &'static str> {
        // Update active_count if we're adding a new layer at the end
        if index == self.active_count as usize && index < self.capacity {
            self.active_count = (index + 1) as u32;
        } else if index >= self.capacity {
            return Err("Layer index exceeds capacity");
        } else if index > self.active_count as usize {
            return Err("Layer index exceeds active count");
        }

        // Use the is_mask field from LayerInfo

        // Update the specific layer data
        // TODO: Add display_overrides parameter to update_layer when implementing per-layer border settings
        let (border_enabled, border_thickness): (bool, f32) = (false, 1.0_f32);

        let layer_data = LayerUboStd140 {
            // Convert matrix to column-major format for GPU
            world_to_voxel: crate::matrix_to_cols_array(world_to_voxel),
            texture_coords: [
                layer.texture_coords.0,
                layer.texture_coords.1,
                layer.texture_coords.2,
                layer.texture_coords.3,
            ],
            dim: [volume_dims.0, volume_dims.1, volume_dims.2],
            pad_slices: 0,
            colormap_id: layer.colormap_id,
            blend_mode: layer.blend_mode as u32,
            texture_index: layer.atlas_index,
            threshold_mode: layer.threshold_mode as u32,
            opacity: layer.opacity,
            intensity_min: layer.intensity_range.0,
            intensity_max: layer.intensity_range.1,
            thresh_low: layer.threshold_range.0,
            thresh_high: layer.threshold_range.1,
            is_mask: if layer.is_mask { 1 } else { 0 },
            has_alpha_mask: if layer.has_alpha_mask { 1 } else { 0 },
            interpolation_mode: layer.interpolation_mode,
            draw_slice_border: if border_enabled { 1 } else { 0 },
            border_thickness_px: border_thickness.max(0.5_f32),
            _pad: [0; 2],
        };

        if index < self.layer_data.len() {
            self.layer_data[index] = layer_data;
        }

        // Upload just the updated layer
        let offset = (index * std::mem::size_of::<LayerUboStd140>()) as u64;
        queue.write_buffer(&self.layer_buffer, offset, bytemuck::bytes_of(&layer_data));

        Ok(())
    }

    /// Clear all layers
    pub fn clear(&mut self, queue: &Queue) {
        self.active_count = 0;
        self.layer_data.clear();

        // Update metadata
        let metadata = LayerMetadata {
            active_count: 0,
            _padding: [0; 7],
        };

        queue.write_buffer(&self.metadata_buffer, 0, bytemuck::bytes_of(&metadata));
    }

    /// Get the bind group for rendering
    pub fn bind_group(&self) -> Option<&LayerBindGroup> {
        self.bind_group.as_ref()
    }

    /// Get active layer count
    pub fn active_count(&self) -> u32 {
        self.active_count
    }

    /// Get current capacity
    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render_state::{BlendMode, ThresholdMode};
    use pollster;

    async fn create_test_device() -> (Device, Queue) {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .unwrap();
        adapter
            .request_device(&wgpu::DeviceDescriptor::default(), None)
            .await
            .unwrap()
    }

    #[test]
    fn test_storage_manager_creation() {
        let (device, _queue) = pollster::block_on(create_test_device());

        let manager = LayerStorageManager::new(&device, 16);
        assert_eq!(manager.active_count(), 0);
        assert_eq!(manager.capacity(), 16);
    }

    #[test]
    fn test_dynamic_resize() {
        let (device, queue) = pollster::block_on(create_test_device());

        let mut manager = LayerStorageManager::new(&device, 2);
        let layout = LayerStorageManager::create_bind_group_layout(&device);
        manager.create_bind_group(&device, &layout);

        // Create more layers than initial capacity
        let layers: Vec<LayerInfo> = (0..5)
            .map(|i| LayerInfo {
                atlas_index: i as u32,
                opacity: 1.0,
                blend_mode: BlendMode::Normal,
                colormap_id: 0,
                intensity_range: (0.0, 1.0),
                threshold_range: (0.0, 1.0),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
                is_mask: false,
                has_alpha_mask: false,
                interpolation_mode: 1,
            })
            .collect();

        let dims = vec![(256, 256, 128); 5];
        let transforms = vec![Matrix4::identity(); 5];

        manager.update_layers(&device, &queue, &layout, &layers, &dims, &transforms);

        assert_eq!(manager.active_count(), 5);
        assert!(manager.capacity() >= 5);
    }
}

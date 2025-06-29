// Storage buffer version of layer management for dynamic layer support

use wgpu::{Device, Queue, Buffer, BindGroup, BindGroupLayout, util::DeviceExt};
use crate::LayerUboStd140;
use crate::render_state::LayerInfo;
use nalgebra::Matrix4;
use bytemuck;

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
    bind_group: Option<BindGroup>,
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
            self.layer_data.reserve(new_capacity - self.layer_data.len());
            
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
        let layer_count = layers.len();
        
        // Ensure we have capacity
        self.ensure_capacity(device, layout, layer_count);
        
        self.active_count = layer_count as u32;
        self.layer_data.clear();
        
        // Build layer data
        let identity = Matrix4::identity();
        let default_dims = (1, 1, 1);
        
        for i in 0..layer_count {
            let layer = &layers[i];
            let dims = volume_dimensions.get(i).unwrap_or(&default_dims);
            let transform = world_to_voxel_transforms.get(i).unwrap_or(&identity);
            
            // Only treat as mask if explicitly marked or has binary-like threshold
            let _is_mask = false; // TODO: Add explicit mask flag to LayerInfo
            
            let layer_data = LayerUboStd140 {
                // nalgebra already stores matrices in column-major format
                // which is exactly what WGSL expects, so no transpose needed
                world_to_voxel: (*transform).into(),
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
                _pad: [0.0; 2],
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
        
        queue.write_buffer(
            &self.metadata_buffer,
            0,
            bytemuck::bytes_of(&metadata),
        );
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
        if index >= self.active_count as usize {
            return Err("Layer index exceeds active count");
        }
        
        // Use the is_mask field from LayerInfo
        
        // Update the specific layer data
        let layer_data = LayerUboStd140 {
            // nalgebra already stores matrices in column-major format
            // which is exactly what WGSL expects, so no transpose needed
            world_to_voxel: (*world_to_voxel).into(),
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
            _pad: [0.0; 2],
        };
        
        if index < self.layer_data.len() {
            self.layer_data[index] = layer_data;
        }
        
        // Upload just the updated layer
        let offset = (index * std::mem::size_of::<LayerUboStd140>()) as u64;
        queue.write_buffer(
            &self.layer_buffer,
            offset,
            bytemuck::bytes_of(&layer_data),
        );
        
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
        
        queue.write_buffer(
            &self.metadata_buffer,
            0,
            bytemuck::bytes_of(&metadata),
        );
    }
    
    /// Get the bind group for rendering
    pub fn bind_group(&self) -> Option<&BindGroup> {
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
    use pollster;
    use crate::render_state::{BlendMode, ThresholdMode};
    
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
        let layers: Vec<LayerInfo> = (0..5).map(|i| LayerInfo {
            atlas_index: i as u32,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            colormap_id: 0,
            intensity_range: (0.0, 1.0),
            threshold_range: (0.0, 1.0),
            threshold_mode: ThresholdMode::Range,
            texture_coords: (0.0, 0.0, 1.0, 1.0),
            is_mask: false,
        }).collect();
        
        let dims = vec![(256, 256, 128); 5];
        let transforms = vec![Matrix4::identity(); 5];
        
        manager.update_layers(&device, &queue, &layout, &layers, &dims, &transforms);
        
        assert_eq!(manager.active_count(), 5);
        assert!(manager.capacity() >= 5);
    }
}
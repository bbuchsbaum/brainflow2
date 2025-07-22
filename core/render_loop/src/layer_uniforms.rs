// Layer uniform buffer management

use wgpu::{Device, Queue, Buffer, BindGroup, BindGroupLayout, util::DeviceExt};
use crate::{LayerUboStd140, shaders::uniforms::ActiveLayerCount};
use crate::render_state::LayerInfo;
use nalgebra::Matrix4;
use bytemuck;

/// Maximum number of layers supported
pub const MAX_LAYERS: usize = 8;

/// Manages layer uniform buffers and bind groups
pub struct LayerUniformManager {
    /// Buffer containing all layer uniforms
    layer_buffer: Buffer,
    /// Buffer containing active layer count
    count_buffer: Buffer,
    /// Bind group for layer data
    bind_group: Option<BindGroup>,
    /// Current layer data
    layer_data: Vec<LayerUboStd140>,
    /// Active layer count
    active_count: u32,
}

impl LayerUniformManager {
    /// Create a new layer uniform manager
    pub fn new(device: &Device) -> Self {
        // Create layer uniform buffer with space for MAX_LAYERS
        let layer_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Layer Uniform Buffer"),
            size: (std::mem::size_of::<LayerUboStd140>() * MAX_LAYERS) as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        
        // Create active layer count buffer
        let count_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Active Layer Count Buffer"),
            contents: bytemuck::cast_slice(&[ActiveLayerCount { count: 0, _pad: [0; 3] }]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        
        Self {
            layer_buffer,
            count_buffer,
            bind_group: None,
            layer_data: vec![LayerUboStd140::default(); MAX_LAYERS],
            active_count: 0,
        }
    }
    
    /// Create bind group for layer uniforms
    pub fn create_bind_group(&mut self, device: &Device, layout: &BindGroupLayout) {
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Layer Bind Group"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.layer_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: self.count_buffer.as_entire_binding(),
                },
            ],
        });
        
        self.bind_group = Some(bind_group);
    }
    
    /// Update layer uniforms from layer info
    pub fn update_layers(
        &mut self,
        queue: &Queue,
        layers: &[LayerInfo],
        volume_dimensions: &[(u32, u32, u32)], // Dimensions for each layer's volume
        world_to_voxel_transforms: &[Matrix4<f32>], // Transform for each layer
    ) {
        // Ensure we don't exceed max layers
        let layer_count = layers.len().min(MAX_LAYERS);
        self.active_count = layer_count as u32;
        
        // Update layer uniform data
        let identity = Matrix4::identity();
        let default_dims = (1, 1, 1);
        for i in 0..layer_count {
            let layer = &layers[i];
            let dims = volume_dimensions.get(i).unwrap_or(&default_dims);
            let transform = world_to_voxel_transforms.get(i)
                .unwrap_or(&identity);
            
            // Debug: Log layer configuration
            println!("LayerUniformManager: Configuring layer {} with:", i);
            println!("  Intensity range: ({}, {})", layer.intensity_range.0, layer.intensity_range.1);
            println!("  Threshold range: ({}, {})", layer.threshold_range.0, layer.threshold_range.1);
            println!("  Threshold mode: {:?}", layer.threshold_mode);
            println!("  Colormap ID: {}", layer.colormap_id);
            println!("  Opacity: {}", layer.opacity);
            
            // Use the is_mask field from LayerInfo
            println!("  Is mask: {}", layer.is_mask);
            
            // DEBUG: Print the transform being used
            println!("LayerUniformManager: Setting world_to_voxel for layer {}:", i);
            println!("  Input transform: {:?}", transform);
            let world_to_voxel_array: [[f32; 4]; 4] = crate::matrix_to_cols_array(transform);
            println!("  Converted to column-major array: {:?}", world_to_voxel_array);
            
            self.layer_data[i] = LayerUboStd140 {
                // Use column-major array for GPU
                world_to_voxel: world_to_voxel_array,
                texture_coords: [
                    layer.texture_coords.0,
                    layer.texture_coords.1,
                    layer.texture_coords.2,
                    layer.texture_coords.3,
                ],
                dim: [dims.0, dims.1, dims.2],
                pad_slices: 0, // TODO: Calculate padding slices if needed
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
        }
        
        // Clear remaining slots
        for i in layer_count..MAX_LAYERS {
            self.layer_data[i] = LayerUboStd140::default();
        }
        
        // Upload layer data to GPU
        queue.write_buffer(
            &self.layer_buffer,
            0,
            bytemuck::cast_slice(&self.layer_data),
        );
        
        // Update active layer count
        let count_data = ActiveLayerCount {
            count: self.active_count,
            _pad: [0; 3],
        };
        
        // Debug: Log the active layer count
        println!("LayerUniformManager: Writing active layer count = {}", self.active_count);
        
        queue.write_buffer(
            &self.count_buffer,
            0,
            bytemuck::bytes_of(&count_data),
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
        if index >= MAX_LAYERS {
            return Err("Layer index exceeds maximum");
        }
        
        if index >= self.active_count as usize {
            return Err("Layer index exceeds active count");
        }
        
        // Use the is_mask field from LayerInfo
        
        // Update the specific layer data
        self.layer_data[index] = LayerUboStd140 {
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
            _pad: [0.0; 2],
        };
        
        // Upload just the updated layer
        let offset = (index * std::mem::size_of::<LayerUboStd140>()) as u64;
        queue.write_buffer(
            &self.layer_buffer,
            offset,
            bytemuck::bytes_of(&self.layer_data[index]),
        );
        
        Ok(())
    }
    
    /// Get the bind group for rendering
    pub fn bind_group(&self) -> Option<&BindGroup> {
        self.bind_group.as_ref()
    }
    
    /// Get active layer count
    pub fn active_count(&self) -> u32 {
        self.active_count
    }
    
    /// Set active layer count (without updating layer data)
    pub fn set_active_count(&mut self, queue: &Queue, count: u32) {
        self.active_count = count.min(MAX_LAYERS as u32);
        
        let count_data = ActiveLayerCount {
            count: self.active_count,
            _pad: [0; 3],
        };
        queue.write_buffer(
            &self.count_buffer,
            0,
            bytemuck::bytes_of(&count_data),
        );
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
    fn test_layer_uniform_creation() {
        let (device, _queue) = pollster::block_on(create_test_device());
        
        let manager = LayerUniformManager::new(&device);
        assert_eq!(manager.active_count(), 0);
        assert_eq!(manager.layer_data.len(), MAX_LAYERS);
    }
    
    #[test]
    fn test_layer_update() {
        let (device, queue) = pollster::block_on(create_test_device());
        
        let mut manager = LayerUniformManager::new(&device);
        
        let layers = vec![
            LayerInfo {
                atlas_index: 5,
                opacity: 0.8,
                blend_mode: BlendMode::Normal,
                colormap_id: 1,
                intensity_range: (0.0, 1.0),
                threshold_range: (0.1, 0.9),
                threshold_mode: ThresholdMode::Range,
                texture_coords: (0.0, 0.0, 1.0, 1.0),
                is_mask: false,
            },
        ];
        
        let dims = vec![(256, 256, 128)];
        let transforms = vec![Matrix4::identity()];
        
        manager.update_layers(&queue, &layers, &dims, &transforms);
        
        assert_eq!(manager.active_count(), 1);
        assert_eq!(manager.layer_data[0].texture_index, 5);
        assert_eq!(manager.layer_data[0].opacity, 0.8);
        assert_eq!(manager.layer_data[0].colormap_id, 1);
    }
}
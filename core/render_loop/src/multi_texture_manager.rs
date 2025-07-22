// Multi-texture management for world-space rendering

use wgpu::{Device, Queue, Texture, TextureView, BindGroup, BindGroupLayout};
use std::collections::HashMap;
use crate::RenderLoopError;
use volmath::{DenseVolume3, VoxelData, DataRange, NeuroSpaceExt};
use nalgebra::Matrix4;
use serde::Serialize;

/// Maximum number of textures supported (GPU limit - 1 for colormap)
pub const MAX_TEXTURES: usize = 15;

/// Manages multiple 3D textures for multi-resolution rendering
pub struct MultiTextureManager {
    /// Map from texture index to texture and view
    textures: HashMap<u32, TextureEntry>,
    /// Next available texture index
    next_index: u32,
    /// Maximum number of textures supported
    max_textures: u32,
    /// Texture bind group
    bind_group: Option<BindGroup>,
    /// Dummy texture for unused slots
    dummy_texture: Option<Texture>,
    /// Dummy texture view
    dummy_view: Option<TextureView>,
    /// Freed texture indices available for reuse
    free_indices: Vec<u32>,
}

struct TextureEntry {
    texture: Texture,
    view: TextureView,
    format: wgpu::TextureFormat,
    dimensions: [u32; 3],
    world_to_voxel: Matrix4<f32>,
}

impl MultiTextureManager {
    /// Create a new multi-texture manager
    pub fn new(max_textures: u32) -> Self {
        Self {
            textures: HashMap::new(),
            next_index: 0,
            max_textures,
            bind_group: None,
            dummy_texture: None,
            dummy_view: None,
            free_indices: Vec::new(),
        }
    }
    
    /// Create dummy texture for unused slots
    fn create_dummy_texture(&mut self, device: &Device) {
        let dummy_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Dummy Volume Texture"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D3,
            format: wgpu::TextureFormat::R16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        
        let dummy_view = dummy_texture.create_view(&wgpu::TextureViewDescriptor::default());
        
        self.dummy_texture = Some(dummy_texture);
        self.dummy_view = Some(dummy_view);
    }
    
    /// Upload a volume to a dedicated texture
    pub fn upload_volume<T>(
        &mut self,
        device: &Device,
        queue: &Queue,
        volume: &DenseVolume3<T>,
        format: wgpu::TextureFormat,
    ) -> Result<(u32, Matrix4<f32>), RenderLoopError>
    where
        T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize + num_traits::Zero + std::ops::Sub<Output = T> + std::ops::Div<Output = T> + std::ops::Mul<Output = T>,
    {
        // Get next available index - prefer reusing freed indices
        let index = if let Some(freed_index) = self.free_indices.pop() {
            freed_index
        } else {
            if self.next_index >= self.max_textures {
                return Err(RenderLoopError::Internal {
                    code: 6001,
                    details: format!("Maximum texture limit {} reached", self.max_textures),
                });
            }
            let idx = self.next_index;
            self.next_index += 1;
            idx
        };
        
        // Get dimensions from the volume's space
        let space = volume.space();
        let dims = space.dims();
        let size = wgpu::Extent3d {
            width: dims[0] as u32,
            height: dims[1] as u32,
            depth_or_array_layers: dims[2] as u32,
        };
        
        // Create 3D texture
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("Volume Texture {}", self.next_index)),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D3,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        
        // Create texture view
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        
        // Convert volume data to appropriate format
        let mut texture_data = match format {
            wgpu::TextureFormat::R8Unorm => {
                convert_to_r8unorm(volume)?
            },
            wgpu::TextureFormat::R16Float => {
                convert_to_r16float(volume)?
            },
            wgpu::TextureFormat::R32Float => {
                convert_to_r32float(volume)?
            },
            _ => return Err(RenderLoopError::UnsupportedVolumeFormat(
                volume.voxel_type()
            )),
        };
        
        // Calculate bytes per pixel based on format
        let bytes_per_pixel = match format {
            wgpu::TextureFormat::R8Unorm => 1,
            wgpu::TextureFormat::R16Float => 2,
            wgpu::TextureFormat::R32Float => 4,
            _ => return Err(RenderLoopError::Internal {
                code: 6002,
                details: format!("Unsupported texture format: {:?}", format),
            }),
        };
        
        // Calculate row alignment
        let unpadded_bytes_per_row = size.width * bytes_per_pixel;
        let aligned_bytes_per_row = wgpu::util::align_to(unpadded_bytes_per_row, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let padding_per_row = aligned_bytes_per_row - unpadded_bytes_per_row;
        
        // If we need padding, restructure the data
        if padding_per_row > 0 && (size.height > 1 || size.depth_or_array_layers > 1) {
            let mut padded_data = Vec::new();
            let row_size = unpadded_bytes_per_row as usize;
            let padding = vec![0u8; padding_per_row as usize];
            
            for z in 0..size.depth_or_array_layers {
                for y in 0..size.height {
                    let start = ((z * size.height + y) * size.width * bytes_per_pixel) as usize;
                    let end = start + row_size;
                    padded_data.extend_from_slice(&texture_data[start..end]);
                    padded_data.extend_from_slice(&padding);
                }
            }
            
            texture_data = padded_data;
        }
        
        // Upload data to texture
        let bytes_per_row = if size.height == 1 && size.depth_or_array_layers == 1 {
            None
        } else {
            Some(aligned_bytes_per_row)
        };
        
        queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &texture_data,
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row,
                rows_per_image: if size.depth_or_array_layers > 1 {
                    Some(size.height)
                } else {
                    None
                },
            },
            size,
        );
        
        // Get world-to-voxel transform from the space
        // Access the inner NeuroSpaceImpl to get world_to_voxel()
        let world_to_voxel = space.world_to_voxel();
        
        // Store texture entry
        self.textures.insert(index, TextureEntry {
            texture,
            view,
            format,
            dimensions: [size.width, size.height, size.depth_or_array_layers],
            world_to_voxel,
        });
        
        Ok((index, world_to_voxel))
    }
    
    /// Create bind group layout for multi-texture rendering
    pub fn create_bind_group_layout(device: &Device, max_textures: u32) -> BindGroupLayout {
        use wgpu::*;
        
        let mut entries = Vec::new();
        
        // Individual texture bindings (0-14)
        // Use filterable: true for linear sampling support
        for i in 0..max_textures {
            entries.push(BindGroupLayoutEntry {
                binding: i,
                visibility: ShaderStages::FRAGMENT,
                ty: BindingType::Texture {
                    multisampled: false,
                    view_dimension: TextureViewDimension::D3,
                    sample_type: TextureSampleType::Float { filterable: true },
                },
                count: None,
            });
        }
        
        // Linear sampler at binding 15 (samplerLinear in shader)
        // Using Filtering for linear interpolation
        entries.push(BindGroupLayoutEntry {
            binding: 15,
            visibility: ShaderStages::FRAGMENT,
            ty: BindingType::Sampler(SamplerBindingType::Filtering),
            count: None,
        });
        
        // Colormap LUT texture at binding 16
        entries.push(BindGroupLayoutEntry {
            binding: 16,
            visibility: ShaderStages::FRAGMENT,
            ty: BindingType::Texture {
                multisampled: false,
                view_dimension: TextureViewDimension::D2Array,
                sample_type: TextureSampleType::Float { filterable: true },
            },
            count: None,
        });
        
        // Colormap sampler at binding 17 (cmSampler in shader)
        entries.push(BindGroupLayoutEntry {
            binding: 17,
            visibility: ShaderStages::FRAGMENT,
            ty: BindingType::Sampler(SamplerBindingType::Filtering),
            count: None,
        });
        
        device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Multi-Texture Bind Group Layout"),
            entries: &entries,
        })
    }
    
    /// Create bind group with current textures
    pub fn create_bind_group(
        &mut self,
        device: &Device,
        layout: &BindGroupLayout,
        linear_sampler: &wgpu::Sampler,
        colormap_texture: &TextureView,
        colormap_sampler: &wgpu::Sampler,
    ) -> Result<(), RenderLoopError> {
        // Create dummy texture if not already created
        if self.dummy_view.is_none() {
            self.create_dummy_texture(device);
        }
        
        let dummy_view = self.dummy_view.as_ref().unwrap();
        
        // Build bind group entries for individual texture bindings
        let mut entries = Vec::new();
        
        // Add individual texture bindings (0-14)
        for i in 0..self.max_textures {
            let view = if let Some(entry) = self.textures.get(&i) {
                &entry.view
            } else {
                dummy_view
            };
            
            entries.push(wgpu::BindGroupEntry {
                binding: i,
                resource: wgpu::BindingResource::TextureView(view),
            });
        }
        
        // Linear sampler at binding 15 (samplerLinear in shader)
        entries.push(wgpu::BindGroupEntry {
            binding: 15,
            resource: wgpu::BindingResource::Sampler(linear_sampler),
        });
        
        // Colormap texture at binding 16
        entries.push(wgpu::BindGroupEntry {
            binding: 16,
            resource: wgpu::BindingResource::TextureView(colormap_texture),
        });
        
        // Colormap sampler at binding 17 (cmSampler in shader)
        entries.push(wgpu::BindGroupEntry {
            binding: 17,
            resource: wgpu::BindingResource::Sampler(colormap_sampler),
        });
        
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Multi-Texture Bind Group"),
            layout,
            entries: &entries,
        });
        
        self.bind_group = Some(bind_group);
        Ok(())
    }
    
    /// Get bind group for rendering
    pub fn bind_group(&self) -> Option<&BindGroup> {
        self.bind_group.as_ref()
    }
    
    /// Get texture info by index
    pub fn get_texture_info(&self, index: u32) -> Option<TextureInfo> {
        self.textures.get(&index).map(|entry| TextureInfo {
            dimensions: entry.dimensions,
            format: entry.format,
            world_to_voxel: entry.world_to_voxel,
        })
    }
    
    /// Release a specific volume texture and free its resources
    pub fn release_volume(&mut self, texture_index: u32) -> Result<(), RenderLoopError> {
        if let Some(_entry) = self.textures.remove(&texture_index) {
            // The texture will be destroyed when entry is dropped
            // This happens automatically due to wgpu's Drop implementation
            
            // Add index to free list for reuse
            self.free_indices.push(texture_index);
            
            // Invalidate the bind group since texture bindings have changed
            self.bind_group = None;
            
            Ok(())
        } else {
            Err(RenderLoopError::Internal {
                code: 6004,
                details: format!("Texture index {} not found", texture_index),
            })
        }
    }
    
    /// Clear all textures
    pub fn clear(&mut self) {
        self.textures.clear();
        self.next_index = 0;
        self.free_indices.clear();
        self.bind_group = None;
        // Keep dummy texture, no need to recreate
    }
}

/// Information about a texture
#[derive(Debug, Clone)]
pub struct TextureInfo {
    pub dimensions: [u32; 3],
    pub format: wgpu::TextureFormat,
    pub world_to_voxel: Matrix4<f32>,
}

// Helper functions for data conversion

fn convert_to_r8unorm<T>(volume: &DenseVolume3<T>) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize + num_traits::Zero + std::ops::Sub<Output = T> + std::ops::Div<Output = T> + std::ops::Mul<Output = T>,
{
    let (min_val, max_val) = volume.range().ok_or(RenderLoopError::Internal {
        code: 6003,
        details: "Empty volume has no range".to_string(),
    })?;
    let range = max_val - min_val;
    
    let data: Vec<u8> = volume
        .values()
        .iter()
        .map(|&val| {
            let normalized = if range > T::zero() {
                (val - min_val) / range
            } else {
                T::zero()
            };
            
            let byte_val = num_traits::cast::<T, f32>(normalized * num_traits::cast::<u8, T>(255).unwrap())
                .unwrap_or(0.0)
                .round() as u8;
            byte_val
        })
        .collect();
    
    Ok(data)
}

fn convert_to_r16float<T>(volume: &DenseVolume3<T>) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    // Convert to f16 (half precision float)
    let data: Vec<half::f16> = volume
        .values()
        .iter()
        .map(|&val| {
            let f32_val = num_traits::cast::<T, f32>(val).unwrap_or(0.0);
            half::f16::from_f32(f32_val)
        })
        .collect();
    
    // Convert to bytes
    let bytes: Vec<u8> = data.iter()
        .flat_map(|&val| val.to_ne_bytes())
        .collect();
    
    Ok(bytes)
}

fn convert_to_r32float<T>(volume: &DenseVolume3<T>) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    let data: Vec<f32> = volume
        .values()
        .iter()
        .map(|&val| {
            num_traits::cast::<T, f32>(val).unwrap_or(0.0)
        })
        .collect();
    
    // Convert to bytes
    let bytes: Vec<u8> = data.iter()
        .flat_map(|&val| val.to_ne_bytes())
        .collect();
    
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures::create_test_pattern_volume;
    
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
    fn test_multi_texture_upload() {
        pollster::block_on(async {
            let (device, queue) = create_test_device().await;
            let mut manager = MultiTextureManager::new(MAX_TEXTURES as u32);
            
            let volume = create_test_pattern_volume();
            
            let (index, transform) = manager.upload_volume(
                &device,
                &queue,
                &volume,
                wgpu::TextureFormat::R8Unorm,
            ).expect("Failed to upload volume");
            
            assert_eq!(index, 0);
            
            let info = manager.get_texture_info(0).expect("Should have texture 0");
            assert_eq!(info.dimensions, [64, 64, 25]);
            assert_eq!(info.format, wgpu::TextureFormat::R8Unorm);
        });
    }
}
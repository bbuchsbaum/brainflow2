// Smart texture manager with pooling, recycling, and memory optimization

use wgpu::{Device, Queue, Texture, TextureView, BindGroup, BindGroupLayout};
use std::collections::{HashMap, BinaryHeap, HashSet};
use std::cmp::Ordering;
use crate::RenderLoopError;
use volmath::{DenseVolume3, VoxelData, DataRange, NumericType};
use volmath::traits::Volume;
use volmath::space::GridSpace;
use nalgebra::Matrix4;
use serde::Serialize;

/// Maximum number of textures supported (GPU limit - 1 for colormap)
pub const MAX_TEXTURES: usize = 15;

/// Texture pool entry for recycling
#[derive(Debug)]
struct PooledTexture {
    texture: Texture,
    view: TextureView,
    format: wgpu::TextureFormat,
    dimensions: [u32; 3],
    memory_size: u64,
}

/// Texture allocation info
#[derive(Debug)]
pub struct TextureAllocation {
    pub index: u32,
    pub dimensions: [u32; 3],
    pub format: wgpu::TextureFormat,
    pub world_to_voxel: Matrix4<f32>,
    pub memory_size: u64,
    pub texture: Texture,
    pub view: TextureView,
}

/// Free texture slot for recycling
#[derive(Debug, Eq, PartialEq)]
struct FreeSlot {
    index: u32,
    dimensions: [u32; 3],
    format: wgpu::TextureFormat,
}

impl Ord for FreeSlot {
    fn cmp(&self, other: &Self) -> Ordering {
        // Prefer smaller indices for better cache locality
        other.index.cmp(&self.index)
    }
}

impl PartialOrd for FreeSlot {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Smart texture manager with pooling and memory management
pub struct SmartTextureManager {
    /// Active textures mapped by index
    active_textures: HashMap<u32, TextureAllocation>,
    /// Pool of free textures for recycling
    texture_pool: Vec<PooledTexture>,
    /// Available indices for recycling
    free_indices: BinaryHeap<FreeSlot>,
    /// Currently allocated indices
    allocated_indices: HashSet<u32>,
    /// Next index to allocate if no free slots
    next_index: u32,
    /// Maximum number of textures
    max_textures: u32,
    /// Total GPU memory used (bytes)
    total_memory_usage: u64,
    /// Memory limit (bytes)
    memory_limit: u64,
    /// Texture bind group
    bind_group: Option<BindGroup>,
    /// Dummy texture for unused slots
    dummy_texture: Option<Texture>,
    /// Dummy texture view
    dummy_view: Option<TextureView>,
    /// Statistics
    stats: TextureStats,
}

/// Texture manager statistics
#[derive(Debug, Default, Clone)]
pub struct TextureStats {
    pub total_allocations: u64,
    pub total_deallocations: u64,
    pub pool_hits: u64,
    pub pool_misses: u64,
    pub peak_memory_usage: u64,
    pub current_texture_count: u32,
}

impl SmartTextureManager {
    /// Create a new smart texture manager with memory limit
    pub fn new(max_textures: u32, memory_limit_mb: u32) -> Self {
        Self {
            active_textures: HashMap::new(),
            texture_pool: Vec::new(),
            free_indices: BinaryHeap::new(),
            allocated_indices: HashSet::new(),
            next_index: 0,
            max_textures,
            total_memory_usage: 0,
            memory_limit: (memory_limit_mb as u64) * 1024 * 1024,
            bind_group: None,
            dummy_texture: None,
            dummy_view: None,
            stats: TextureStats::default(),
        }
    }
    
    /// Calculate memory size for a texture
    fn calculate_memory_size(dimensions: [u32; 3], format: wgpu::TextureFormat) -> u64 {
        let bytes_per_pixel = match format {
            wgpu::TextureFormat::R8Unorm => 1,
            wgpu::TextureFormat::R16Float => 2,
            wgpu::TextureFormat::R32Float => 4,
            _ => 2, // Default
        };
        
        (dimensions[0] as u64) * (dimensions[1] as u64) * (dimensions[2] as u64) * bytes_per_pixel
    }
    
    /// Choose optimal texture format based on data type and range
    pub fn choose_optimal_format<T>(volume: &DenseVolume3<T>) -> wgpu::TextureFormat
    where
        T: VoxelData + DataRange<T> + Serialize,
    {
        match volume.voxel_type() {
            NumericType::U8 => wgpu::TextureFormat::R8Unorm,
            NumericType::I8 => wgpu::TextureFormat::R8Unorm,
            NumericType::U16 | NumericType::I16 => {
                // Check if data range fits in R8
                if let Some((min, max)) = volume.range() {
                    if let (Some(min_f32), Some(max_f32)) = 
                        (num_traits::cast::<T, f32>(min), num_traits::cast::<T, f32>(max)) {
                        if min_f32 >= 0.0 && max_f32 <= 255.0 {
                            return wgpu::TextureFormat::R8Unorm;
                        }
                    }
                }
                wgpu::TextureFormat::R16Float
            },
            NumericType::F32 | NumericType::F64 => {
                // Check if data range allows for R16F without significant precision loss
                if let Some((min, max)) = volume.range() {
                    if let (Some(min_f32), Some(max_f32)) = 
                        (num_traits::cast::<T, f32>(min), num_traits::cast::<T, f32>(max)) {
                        let range = max_f32 - min_f32;
                        // R16F has ~3 decimal digits of precision
                        if range < 1000.0 && min_f32.abs() < 65504.0 && max_f32.abs() < 65504.0 {
                            return wgpu::TextureFormat::R16Float;
                        }
                    }
                }
                wgpu::TextureFormat::R32Float
            },
            _ => wgpu::TextureFormat::R16Float,
        }
    }
    
    /// Try to find a pooled texture that matches requirements
    fn find_pooled_texture(&mut self, dimensions: [u32; 3], format: wgpu::TextureFormat) 
        -> Option<(u32, PooledTexture)> 
    {
        // Look for exact match in pool
        let position = self.texture_pool.iter().position(|pooled| {
            pooled.dimensions == dimensions && pooled.format == format
        });
        
        if let Some(pos) = position {
            self.stats.pool_hits += 1;
            let pooled = self.texture_pool.swap_remove(pos);
            
            // Find a free index to use
            if let Some(free_slot) = self.free_indices.pop() {
                return Some((free_slot.index, pooled));
            }
        }
        
        self.stats.pool_misses += 1;
        None
    }
    
    /// Allocate a texture index
    fn allocate_index(&mut self) -> Result<u32, RenderLoopError> {
        // Try to reuse a free index first
        if let Some(free_slot) = self.free_indices.pop() {
            self.allocated_indices.insert(free_slot.index);
            return Ok(free_slot.index);
        }
        
        // Allocate new index
        if self.next_index >= self.max_textures {
            return Err(RenderLoopError::Internal {
                code: 6001,
                details: format!("Maximum texture limit {} reached", self.max_textures),
            });
        }
        
        let index = self.next_index;
        self.next_index += 1;
        self.allocated_indices.insert(index);
        Ok(index)
    }
    
    /// Release a texture and optionally pool it
    pub fn release_texture(&mut self, index: u32) -> Result<(), RenderLoopError> {
        if let Some(allocation) = self.active_textures.remove(&index) {
            self.allocated_indices.remove(&index);
            self.total_memory_usage -= allocation.memory_size;
            self.stats.total_deallocations += 1;
            self.stats.current_texture_count -= 1;
            
            // Add index back to free list
            self.free_indices.push(FreeSlot {
                index,
                dimensions: allocation.dimensions,
                format: allocation.format,
            });
            
            // Pool the texture for reuse
            self.texture_pool.push(PooledTexture {
                texture: allocation.texture,
                view: allocation.view,
                format: allocation.format,
                dimensions: allocation.dimensions,
                memory_size: allocation.memory_size,
            });
            
            Ok(())
        } else {
            Err(RenderLoopError::Internal {
                code: 6004,
                details: format!("Texture index {} not found", index),
            })
        }
    }
    
    /// Upload a volume with smart format selection and pooling
    pub fn upload_volume<T>(
        &mut self,
        device: &Device,
        queue: &Queue,
        volume: &DenseVolume3<T>,
        format_hint: Option<wgpu::TextureFormat>,
    ) -> Result<(u32, Matrix4<f32>), RenderLoopError>
    where
        T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize 
            + num_traits::Zero + std::ops::Sub<Output = T> + std::ops::Div<Output = T> 
            + std::ops::Mul<Output = T>,
    {
        // Choose optimal format
        let format = format_hint.unwrap_or_else(|| Self::choose_optimal_format(volume));
        
        // Get dimensions
        let space = volume.space();
        let dims = space.dims();
        let dimensions = [dims[0] as u32, dims[1] as u32, dims[2] as u32];
        
        // Calculate memory requirement
        let memory_size = Self::calculate_memory_size(dimensions, format);
        
        // Check memory limit
        if self.total_memory_usage + memory_size > self.memory_limit {
            return Err(RenderLoopError::Internal {
                code: 6005,
                details: format!("Memory limit exceeded. Required: {} MB, Available: {} MB",
                    memory_size / 1_048_576,
                    (self.memory_limit - self.total_memory_usage) / 1_048_576),
            });
        }
        
        // Try to find pooled texture first
        let (index, texture, view) = if let Some((idx, pooled)) = self.find_pooled_texture(dimensions, format) {
            (idx, pooled.texture, pooled.view)
        } else {
            // Allocate new texture
            let index = self.allocate_index()?;
            
            let size = wgpu::Extent3d {
                width: dimensions[0],
                height: dimensions[1],
                depth_or_array_layers: dimensions[2],
            };
            
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: Some(&format!("Volume Texture {}", index)),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D3,
                format,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            
            (index, texture, view)
        };
        
        // Convert volume data
        let mut texture_data = match format {
            wgpu::TextureFormat::R8Unorm => convert_to_r8unorm(volume)?,
            wgpu::TextureFormat::R16Float => convert_to_r16float(volume)?,
            wgpu::TextureFormat::R32Float => convert_to_r32float(volume)?,
            _ => return Err(RenderLoopError::UnsupportedVolumeFormat(volume.voxel_type())),
        };
        
        // Calculate bytes per pixel
        let bytes_per_pixel = match format {
            wgpu::TextureFormat::R8Unorm => 1,
            wgpu::TextureFormat::R16Float => 2,
            wgpu::TextureFormat::R32Float => 4,
            _ => return Err(RenderLoopError::Internal {
                code: 6002,
                details: format!("Unsupported texture format: {:?}", format),
            }),
        };
        
        // Handle row alignment padding
        let size = wgpu::Extent3d {
            width: dimensions[0],
            height: dimensions[1],
            depth_or_array_layers: dimensions[2],
        };
        
        let unpadded_bytes_per_row = size.width * bytes_per_pixel;
        let aligned_bytes_per_row = wgpu::util::align_to(unpadded_bytes_per_row, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let padding_per_row = aligned_bytes_per_row - unpadded_bytes_per_row;
        
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
        
        // Get world-to-voxel transform
        let world_to_voxel = space.0.world_to_voxel();
        
        // Track allocation
        let allocation = TextureAllocation {
            index,
            dimensions,
            format,
            world_to_voxel,
            memory_size,
            texture,
            view,
        };
        
        self.active_textures.insert(index, allocation);
        self.total_memory_usage += memory_size;
        self.stats.total_allocations += 1;
        self.stats.current_texture_count += 1;
        
        if self.total_memory_usage > self.stats.peak_memory_usage {
            self.stats.peak_memory_usage = self.total_memory_usage;
        }
        
        Ok((index, world_to_voxel))
    }
    
    /// Get current memory usage in MB
    pub fn memory_usage_mb(&self) -> f32 {
        (self.total_memory_usage as f32) / 1_048_576.0
    }
    
    /// Get texture statistics
    pub fn stats(&self) -> &TextureStats {
        &self.stats
    }
    
    /// Clear all textures and reset statistics
    pub fn clear(&mut self) {
        self.active_textures.clear();
        self.texture_pool.clear();
        self.free_indices.clear();
        self.allocated_indices.clear();
        self.next_index = 0;
        self.total_memory_usage = 0;
        self.bind_group = None;
        self.stats = TextureStats::default();
    }
    
    /// Create bind group layout for smart texture rendering
    pub fn create_bind_group_layout(device: &Device, max_textures: u32) -> BindGroupLayout {
        use wgpu::*;
        
        let mut entries = Vec::new();
        
        // Individual texture bindings (0-14)
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
        
        // Linear sampler at binding 15
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
        
        // Colormap sampler at binding 17
        entries.push(BindGroupLayoutEntry {
            binding: 17,
            visibility: ShaderStages::FRAGMENT,
            ty: BindingType::Sampler(SamplerBindingType::Filtering),
            count: None,
        });
        
        device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Smart Texture Bind Group Layout"),
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
            let view = if let Some(allocation) = self.active_textures.get(&i) {
                &allocation.view
            } else {
                dummy_view
            };
            
            entries.push(wgpu::BindGroupEntry {
                binding: i,
                resource: wgpu::BindingResource::TextureView(view),
            });
        }
        
        // Linear sampler at binding 15
        entries.push(wgpu::BindGroupEntry {
            binding: 15,
            resource: wgpu::BindingResource::Sampler(linear_sampler),
        });
        
        // Colormap texture at binding 16
        entries.push(wgpu::BindGroupEntry {
            binding: 16,
            resource: wgpu::BindingResource::TextureView(colormap_texture),
        });
        
        // Colormap sampler at binding 17
        entries.push(wgpu::BindGroupEntry {
            binding: 17,
            resource: wgpu::BindingResource::Sampler(colormap_sampler),
        });
        
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Smart Texture Bind Group"),
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
        self.active_textures.get(&index).map(|allocation| TextureInfo {
            dimensions: allocation.dimensions,
            format: allocation.format,
            world_to_voxel: allocation.world_to_voxel,
        })
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
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize + num_traits::Zero 
        + std::ops::Sub<Output = T> + std::ops::Div<Output = T> + std::ops::Mul<Output = T>,
{
    let (min_val, max_val) = volume.range().ok_or(RenderLoopError::Internal {
        code: 6003,
        details: "Empty volume has no range".to_string(),
    })?;
    let range = max_val - min_val;
    
    let data: Vec<u8> = volume
        .data_slice()
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
    let data: Vec<half::f16> = volume
        .data_slice()
        .iter()
        .map(|&val| {
            let f32_val = num_traits::cast::<T, f32>(val).unwrap_or(0.0);
            half::f16::from_f32(f32_val)
        })
        .collect();
    
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
        .data_slice()
        .iter()
        .map(|&val| {
            num_traits::cast::<T, f32>(val).unwrap_or(0.0)
        })
        .collect();
    
    let bytes: Vec<u8> = data.iter()
        .flat_map(|&val| val.to_ne_bytes())
        .collect();
    
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use volmath::DenseVolume3;
    
    #[test]
    fn test_optimal_format_selection() {
        use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
        use nalgebra::Matrix4;
        
        // Test U8 volume
        let dims = [10, 10, 10];
        let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, Matrix4::identity());
        let space = NeuroSpace3(space_impl);
        let u8_data = vec![0u8; 10 * 10 * 10];
        let u8_volume = DenseVolume3::from_data(space, u8_data);
        
        assert_eq!(
            SmartTextureManager::choose_optimal_format(&u8_volume),
            wgpu::TextureFormat::R8Unorm
        );
        
        // Test F32 volume with small range
        let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, Matrix4::identity());
        let space = NeuroSpace3(space_impl);
        let mut f32_data = vec![0.0f32; 10 * 10 * 10];
        // Fill with small range values
        for i in 0..1000 {
            f32_data[i] = (i as f32) * 0.1;
        }
        let f32_volume = DenseVolume3::from_data(space, f32_data);
        
        assert_eq!(
            SmartTextureManager::choose_optimal_format(&f32_volume),
            wgpu::TextureFormat::R16Float
        );
    }
    
    #[test]
    fn test_memory_calculation() {
        assert_eq!(
            SmartTextureManager::calculate_memory_size([256, 256, 256], wgpu::TextureFormat::R8Unorm),
            16_777_216 // 16 MB
        );
        
        assert_eq!(
            SmartTextureManager::calculate_memory_size([256, 256, 256], wgpu::TextureFormat::R16Float),
            33_554_432 // 32 MB
        );
        
        assert_eq!(
            SmartTextureManager::calculate_memory_size([256, 256, 256], wgpu::TextureFormat::R32Float),
            67_108_864 // 64 MB
        );
    }
    
    #[test]
    fn test_texture_pooling() {
        use wgpu::Instance;
        use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
        use nalgebra::Matrix4;
        
        pollster::block_on(async {
            let instance = Instance::new(wgpu::InstanceDescriptor::default());
            let adapter = instance
                .request_adapter(&wgpu::RequestAdapterOptions::default())
                .await
                .unwrap();
            let (device, queue) = adapter
                .request_device(&wgpu::DeviceDescriptor::default(), None)
                .await
                .unwrap();
            
            let mut manager = SmartTextureManager::new(15, 256); // 256 MB limit
            
            // Create a test volume
            let dims = [64, 64, 64];
            let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, Matrix4::identity());
            let space = NeuroSpace3(space_impl);
            let data = vec![0u8; 64 * 64 * 64];
            let volume = DenseVolume3::from_data(space, data);
            
            // Upload the volume
            let (index1, _) = manager.upload_volume(
                &device,
                &queue,
                &volume,
                None,
            ).expect("Failed to upload volume");
            
            assert_eq!(manager.stats.total_allocations, 1);
            assert_eq!(manager.stats.pool_misses, 1);
            assert_eq!(manager.stats.current_texture_count, 1);
            
            // Release the texture
            manager.release_texture(index1).expect("Failed to release texture");
            
            assert_eq!(manager.stats.total_deallocations, 1);
            assert_eq!(manager.stats.current_texture_count, 0);
            assert_eq!(manager.texture_pool.len(), 1);
            
            // Upload same size volume again - should use pooled texture
            let (index2, _) = manager.upload_volume(
                &device,
                &queue,
                &volume,
                None,
            ).expect("Failed to upload volume again");
            
            assert_eq!(manager.stats.total_allocations, 2);
            assert_eq!(manager.stats.pool_hits, 1);
            assert_eq!(manager.stats.pool_misses, 1);
            assert_eq!(manager.texture_pool.len(), 0);
            
            // Index should be reused
            assert_eq!(index2, index1);
        });
    }
    
    #[test]
    fn test_memory_limit() {
        use wgpu::Instance;
        use volmath::space::{NeuroSpace3, NeuroSpaceImpl};
        use nalgebra::Matrix4;
        
        pollster::block_on(async {
            let instance = Instance::new(wgpu::InstanceDescriptor::default());
            let adapter = instance
                .request_adapter(&wgpu::RequestAdapterOptions::default())
                .await
                .unwrap();
            let (device, queue) = adapter
                .request_device(&wgpu::DeviceDescriptor::default(), None)
                .await
                .unwrap();
            
            // Create manager with small memory limit (2 MB)
            let mut manager = SmartTextureManager::new(15, 2);
            
            // Create a 1MB volume (128x128x64 at R8)
            let dims = [128, 128, 64];
            let space_impl = NeuroSpaceImpl::from_affine_matrix4(dims, Matrix4::identity());
            let space = NeuroSpace3(space_impl);
            let data = vec![0u8; 128 * 128 * 64];
            let volume = DenseVolume3::from_data(space, data);
            
            // First upload should succeed
            let (index1, _) = manager.upload_volume(
                &device,
                &queue,
                &volume,
                None,
            ).expect("First upload should succeed");
            
            assert!(manager.memory_usage_mb() <= 2.0);
            
            // Second upload should also succeed (still under 2MB)
            let (index2, _) = manager.upload_volume(
                &device,
                &queue,
                &volume,
                None,
            ).expect("Second upload should succeed");
            
            assert!(manager.memory_usage_mb() <= 2.0);
            
            // Third upload should fail (would exceed 2MB limit)
            let result = manager.upload_volume(
                &device,
                &queue,
                &volume,
                None,
            );
            
            assert!(result.is_err());
            if let Err(e) = result {
                match e {
                    crate::RenderLoopError::Internal { code, .. } => assert_eq!(code, 6005),
                    _ => panic!("Expected Internal error with code 6005"),
                }
            }
        });
    }
}
// Multi-texture management for world-space rendering

use crate::RenderLoopError;
use log::{debug, warn};
use nalgebra::Matrix4;
use serde::Serialize;
use std::collections::HashMap;
use volmath::{DataRange, DenseVolume3, NeuroSpaceExt, VoxelData};
use wgpu::{BindGroupLayout, Device, Queue, Texture, TextureView};

#[cfg(feature = "typed-shaders")]
use crate::shaders::typed::slice_world_space_optimized;
#[cfg(feature = "typed-shaders")]
use std::convert::TryInto;
#[cfg(not(feature = "typed-shaders"))]
use wgpu::BindGroup;

#[cfg(feature = "typed-shaders")]
type TextureBindGroup = wgpu::BindGroup;
#[cfg(not(feature = "typed-shaders"))]
type TextureBindGroup = BindGroup;

/// Maximum number of textures supported (GPU limit - 1 for colormap)
/// Metal adapters only allow 30 sampled textures per stage, so we keep
/// room for the mask array plus samplers/LUT bindings.
pub const MAX_TEXTURES: usize = 13;

/// Manages multiple 3D textures for multi-resolution rendering
pub struct MultiTextureManager {
    /// Map from texture index to texture and view
    textures: HashMap<u32, TextureEntry>,
    /// Optional mask textures per index
    mask_textures: HashMap<u32, MaskTextureEntry>,
    /// Next available texture index
    next_index: u32,
    /// Maximum number of textures supported
    max_textures: u32,
    /// Texture bind group
    bind_group: Option<TextureBindGroup>,
    /// Dummy texture for unused slots
    dummy_texture: Option<Texture>,
    /// Dummy texture view
    dummy_view: Option<TextureView>,
    /// Default white mask texture for unmasked layers
    default_mask_texture: Option<Texture>,
    default_mask_view: Option<TextureView>,
    /// Freed texture indices available for reuse
    free_indices: Vec<u32>,
}

struct TextureEntry {
    #[allow(dead_code)]
    texture: Texture,
    view: TextureView,
    format: wgpu::TextureFormat,
    dimensions: [u32; 3],
    world_to_voxel: Matrix4<f32>,
    policy: UploadFormat,
    require_filterable: bool,
}

struct MaskTextureEntry {
    #[allow(dead_code)]
    texture: Texture,
    view: TextureView,
}

/// Storage selection for a volume upload.
#[derive(Clone, Copy)]
pub(crate) enum UploadFormat {
    Automatic { preserve_labels: bool },
    Explicit(wgpu::TextureFormat),
}

impl MultiTextureManager {
    /// Create a new multi-texture manager
    pub fn new(device: &Device, queue: &Queue, max_textures: u32) -> Self {
        let mut manager = Self {
            textures: HashMap::new(),
            mask_textures: HashMap::new(),
            next_index: 0,
            max_textures,
            bind_group: None,
            dummy_texture: None,
            dummy_view: None,
            default_mask_texture: None,
            default_mask_view: None,
            free_indices: Vec::new(),
        };
        manager.create_dummy_texture(device);
        manager.create_default_mask_texture(device, queue);
        manager
    }

    /// Create dummy texture for unused slots
    fn create_dummy_texture(&mut self, device: &Device) {
        if self.dummy_texture.is_some() {
            return;
        }
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

    fn create_default_mask_texture(&mut self, device: &Device, queue: &Queue) {
        if self.default_mask_texture.is_some() {
            return;
        }
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Default Mask Texture"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D3,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        let data = [0xFFu8];
        queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &data,
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: None,
                rows_per_image: None,
            },
            wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 1,
            },
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.default_mask_view = Some(view);
        self.default_mask_texture = Some(texture);
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
        T: VoxelData
            + num_traits::NumCast
            + DataRange<T>
            + Serialize
            + num_traits::Zero
            + std::ops::Sub<Output = T>
            + std::ops::Div<Output = T>
            + std::ops::Mul<Output = T>,
    {
        // Raw texture storage can be consumed by an unfilterable layout.
        self.upload_volume_with_policy(device, queue, volume, UploadFormat::Explicit(format), false)
    }

    pub(crate) fn upload_volume_with_policy<T>(
        &mut self,
        device: &Device,
        queue: &Queue,
        volume: &DenseVolume3<T>,
        policy: UploadFormat,
        require_filterable: bool,
    ) -> Result<(u32, Matrix4<f32>), RenderLoopError>
    where
        T: VoxelData
            + num_traits::NumCast
            + DataRange<T>
            + Serialize
            + num_traits::Zero
            + std::ops::Sub<Output = T>
            + std::ops::Div<Output = T>
            + std::ops::Mul<Output = T>,
    {
        // Choose a slot without consuming it. Validation/conversion can fail;
        // only commit the reservation once the texture is ready to publish.
        let index = if let Some(&freed_index) = self.free_indices.last() {
            freed_index
        } else {
            if self.next_index >= self.max_textures {
                return Err(RenderLoopError::Internal {
                    code: 6001,
                    details: format!("Maximum texture limit {} reached", self.max_textures),
                });
            }
            self.next_index
        };

        // Get dimensions from the volume's space
        let space = volume.space();
        let dims = space.dims();
        let size = wgpu::Extent3d {
            width: dims[0] as u32,
            height: dims[1] as u32,
            depth_or_array_layers: dims[2] as u32,
        };
        let max_3d_dim = device.limits().max_texture_dimension_3d;
        if size.width == 0 || size.height == 0 || size.depth_or_array_layers == 0 {
            return Err(conversion_error("Volume dimensions must be nonzero"));
        }
        if size.width > max_3d_dim
            || size.height > max_3d_dim
            || size.depth_or_array_layers > max_3d_dim
        {
            return Err(RenderLoopError::Internal {
                code: 6006,
                details: format!(
                    "Volume dimensions {}x{}x{} exceed device 3D texture limit {}",
                    size.width, size.height, size.depth_or_array_layers, max_3d_dim
                ),
            });
        }

        let (format, texture_data) = encode_with_policy(volume, policy)?;
        let (format, texture_data) = fit_filterable_format(
            volume,
            policy,
            format,
            texture_data,
            require_filterable
                && !device
                    .features()
                    .contains(wgpu::Features::FLOAT32_FILTERABLE),
        )?;

        // Create 3D texture
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

        // Create texture view
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

        write_volume_texture(queue, &texture, size, &texture_data);

        // Get world-to-voxel transform from the space
        // Access the inner NeuroSpaceImpl to get world_to_voxel()
        let world_to_voxel = space.world_to_voxel();

        // Store texture entry
        if self.free_indices.pop().is_none() {
            self.next_index += 1;
        }
        self.textures.insert(
            index,
            TextureEntry {
                texture,
                view,
                format,
                dimensions: [size.width, size.height, size.depth_or_array_layers],
                world_to_voxel,
                policy,
                require_filterable,
            },
        );

        Ok((index, world_to_voxel))
    }

    /// Upload an alpha mask texture for an existing texture index.
    pub fn upload_mask_texture(
        &mut self,
        device: &Device,
        queue: &Queue,
        index: u32,
        dims: [u32; 3],
        mask_data: &[u8],
    ) -> Result<(), RenderLoopError> {
        if index >= self.max_textures {
            return Err(RenderLoopError::Internal {
                code: 8014,
                details: format!(
                    "Mask index {} exceeds maximum supported textures ({})",
                    index, self.max_textures
                ),
            });
        }

        let size = wgpu::Extent3d {
            width: dims[0],
            height: dims[1],
            depth_or_array_layers: dims[2],
        };

        let expected_len = (size.width as usize)
            .saturating_mul(size.height as usize)
            .saturating_mul(size.depth_or_array_layers as usize);
        if mask_data.len() != expected_len {
            return Err(RenderLoopError::Internal {
                code: 8015,
                details: format!(
                    "Mask byte count {} does not match dimensions {:?}",
                    mask_data.len(),
                    dims
                ),
            });
        }

        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(&format!("Mask Texture {}", index)),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D3,
            format: wgpu::TextureFormat::R8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

        let unpadded_bytes_per_row = size.width;
        let aligned_bytes_per_row =
            wgpu::util::align_to(unpadded_bytes_per_row, wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let padding_per_row = aligned_bytes_per_row - unpadded_bytes_per_row;

        let upload_data =
            if padding_per_row > 0 && (size.height > 1 || size.depth_or_array_layers > 1) {
                let mut padded = Vec::with_capacity(
                    (aligned_bytes_per_row * size.height * size.depth_or_array_layers) as usize,
                );
                let row_size = unpadded_bytes_per_row as usize;
                let padding = vec![0u8; padding_per_row as usize];
                for z in 0..size.depth_or_array_layers {
                    for y in 0..size.height {
                        let start = ((z * size.height + y) * size.width) as usize;
                        let end = start + row_size;
                        padded.extend_from_slice(&mask_data[start..end]);
                        padded.extend_from_slice(&padding);
                    }
                }
                padded
            } else {
                mask_data.to_vec()
            };

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
            &upload_data,
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

        self.mask_textures
            .insert(index, MaskTextureEntry { texture, view });
        Ok(())
    }

    pub fn clear_mask_texture(&mut self, index: u32) {
        self.mask_textures.remove(&index);
    }

    /// Create bind group layout for multi-texture rendering
    pub fn create_bind_group_layout(device: &Device, max_textures: u32) -> BindGroupLayout {
        use crate::shader_contract::texture;
        use wgpu::*;

        // Binding indices for group 2 come from the shared shader contract so the
        // layout, the bind group, and the WGSL declarations cannot drift apart.
        let bindings = texture::bindings(max_textures);
        let mut entries = Vec::new();

        // Volume textures (filterable for linear sampling).
        for i in 0..max_textures {
            entries.push(BindGroupLayoutEntry {
                binding: bindings.volume_base + i,
                visibility: ShaderStages::FRAGMENT,
                ty: BindingType::Texture {
                    multisampled: false,
                    view_dimension: TextureViewDimension::D3,
                    sample_type: TextureSampleType::Float { filterable: true },
                },
                count: None,
            });
        }

        // Mask textures (non-filterable).
        for i in 0..max_textures {
            entries.push(BindGroupLayoutEntry {
                binding: bindings.mask_base + i,
                visibility: ShaderStages::FRAGMENT,
                ty: BindingType::Texture {
                    multisampled: false,
                    view_dimension: TextureViewDimension::D3,
                    sample_type: TextureSampleType::Float { filterable: false },
                },
                count: None,
            });
        }

        // Linear sampler binding (samplerLinear in shader)
        entries.push(BindGroupLayoutEntry {
            binding: bindings.sampler_linear,
            visibility: ShaderStages::FRAGMENT,
            ty: BindingType::Sampler(SamplerBindingType::Filtering),
            count: None,
        });

        // Colormap LUT texture (array of 2D LUTs)
        entries.push(BindGroupLayoutEntry {
            binding: bindings.colormap_lut,
            visibility: ShaderStages::FRAGMENT,
            ty: BindingType::Texture {
                multisampled: false,
                view_dimension: TextureViewDimension::D2Array,
                sample_type: TextureSampleType::Float { filterable: true },
            },
            count: None,
        });

        // Nearest sampler (samplerNearest in shader)
        entries.push(BindGroupLayoutEntry {
            binding: bindings.sampler_nearest,
            visibility: ShaderStages::FRAGMENT,
            ty: BindingType::Sampler(SamplerBindingType::NonFiltering),
            count: None,
        });

        device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("Multi-Texture Bind Group Layout"),
            entries: &entries,
        })
    }

    /// Create bind group with current textures
    #[cfg(feature = "typed-shaders")]
    pub fn create_bind_group(
        &mut self,
        device: &Device,
        layout: &BindGroupLayout,
        linear_sampler: &wgpu::Sampler,
        nearest_sampler: &wgpu::Sampler,
        colormap_texture: &TextureView,
        _colormap_sampler: &wgpu::Sampler,
    ) -> Result<(), RenderLoopError> {
        // Reuse the manual path to ensure correct D2Array for colormap LUT
        if self.dummy_view.is_none() {
            self.create_dummy_texture(device);
        }

        let dummy_view = self.dummy_view.as_ref().unwrap();

        // Debug: log which texture indices are populated before creating bind group
        debug!(
            "MultiTextureManager::create_bind_group - textures present at indices: {:?}",
            self.textures.keys().collect::<Vec<_>>()
        );

        // Build bind group entries for individual texture bindings
        let mut entries = Vec::new();

        // Binding indices come from the shared shader contract (group 2).
        let bindings = crate::shader_contract::texture::bindings(self.max_textures);

        // Volume textures.
        for i in 0..self.max_textures {
            let view = if let Some(entry) = self.textures.get(&i) {
                debug!(
                    "  Binding texture index {} with real texture (dims = {:?})",
                    i, entry.dimensions
                );
                &entry.view
            } else {
                debug!("  Binding texture index {} with DUMMY texture", i);
                dummy_view
            };

            entries.push(wgpu::BindGroupEntry {
                binding: bindings.volume_base + i,
                resource: wgpu::BindingResource::TextureView(view),
            });
        }

        // Mask textures.
        let default_mask_view = self
            .default_mask_view
            .as_ref()
            .expect("default mask view not initialized");
        for i in 0..self.max_textures {
            let view = self
                .mask_textures
                .get(&i)
                .map(|entry| &entry.view)
                .unwrap_or(default_mask_view);

            entries.push(wgpu::BindGroupEntry {
                binding: bindings.mask_base + i,
                resource: wgpu::BindingResource::TextureView(view),
            });
        }

        // Linear sampler binding (samplerLinear in shader)
        entries.push(wgpu::BindGroupEntry {
            binding: bindings.sampler_linear,
            resource: wgpu::BindingResource::Sampler(linear_sampler),
        });

        // Colormap texture (2D array view)
        entries.push(wgpu::BindGroupEntry {
            binding: bindings.colormap_lut,
            resource: wgpu::BindingResource::TextureView(colormap_texture),
        });

        // Nearest sampler (samplerNearest in shader)
        entries.push(wgpu::BindGroupEntry {
            binding: bindings.sampler_nearest,
            resource: wgpu::BindingResource::Sampler(nearest_sampler),
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Multi-Texture Bind Group (typed, manual)"),
            layout,
            entries: &entries,
        });

        self.bind_group = Some(bind_group);
        Ok(())
    }

    #[cfg(not(feature = "typed-shaders"))]
    pub fn create_bind_group(
        &mut self,
        device: &Device,
        layout: &BindGroupLayout,
        linear_sampler: &wgpu::Sampler,
        nearest_sampler: &wgpu::Sampler,
        colormap_texture: &TextureView,
        _colormap_sampler: &wgpu::Sampler,
    ) -> Result<(), RenderLoopError> {
        // Create dummy texture if not already created
        if self.dummy_view.is_none() {
            self.create_dummy_texture(device);
        }

        let dummy_view = self.dummy_view.as_ref().unwrap();

        // Debug: log which texture indices are populated before creating bind group
        debug!(
            "MultiTextureManager::create_bind_group - textures present at indices: {:?}",
            self.textures.keys().collect::<Vec<_>>()
        );

        // Build bind group entries for individual texture bindings
        let mut entries = Vec::new();

        // Binding indices come from the shared shader contract (group 2).
        let bindings = crate::shader_contract::texture::bindings(self.max_textures);

        // Volume textures.
        for i in 0..self.max_textures {
            let view = if let Some(entry) = self.textures.get(&i) {
                debug!(
                    "  Binding texture index {} with real texture (dims = {:?})",
                    i, entry.dimensions
                );
                &entry.view
            } else {
                debug!("  Binding texture index {} with DUMMY texture", i);
                dummy_view
            };

            entries.push(wgpu::BindGroupEntry {
                binding: bindings.volume_base + i,
                resource: wgpu::BindingResource::TextureView(view),
            });
        }

        // Mask textures.
        let default_mask_view = self
            .default_mask_view
            .as_ref()
            .expect("default mask view not initialized");
        for i in 0..self.max_textures {
            let view = self
                .mask_textures
                .get(&i)
                .map(|entry| &entry.view)
                .unwrap_or(default_mask_view);

            entries.push(wgpu::BindGroupEntry {
                binding: bindings.mask_base + i,
                resource: wgpu::BindingResource::TextureView(view),
            });
        }

        // Linear sampler binding (samplerLinear in shader)
        entries.push(wgpu::BindGroupEntry {
            binding: bindings.sampler_linear,
            resource: wgpu::BindingResource::Sampler(linear_sampler),
        });

        // Colormap texture binding
        entries.push(wgpu::BindGroupEntry {
            binding: bindings.colormap_lut,
            resource: wgpu::BindingResource::TextureView(colormap_texture),
        });

        // Nearest sampler (samplerNearest in shader)
        entries.push(wgpu::BindGroupEntry {
            binding: bindings.sampler_nearest,
            resource: wgpu::BindingResource::Sampler(nearest_sampler),
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
    pub fn bind_group(&self) -> Option<&TextureBindGroup> {
        self.bind_group.as_ref()
    }

    /// Overwrite an existing texture slot with new volume data (dimensions must match).
    pub fn update_volume<T>(
        &mut self,
        device: &Device,
        queue: &Queue,
        index: u32,
        volume: &DenseVolume3<T>,
    ) -> Result<Matrix4<f32>, RenderLoopError>
    where
        T: VoxelData
            + num_traits::NumCast
            + DataRange<T>
            + Serialize
            + num_traits::Zero
            + std::ops::Sub<Output = T>
            + std::ops::Div<Output = T>
            + std::ops::Mul<Output = T>,
    {
        let entry = self
            .textures
            .get_mut(&index)
            .ok_or(RenderLoopError::Internal {
                code: 6003,
                details: format!("No texture found for index {}", index),
            })?;

        let dims = volume.space().dims();
        if dims[0] as u32 != entry.dimensions[0]
            || dims[1] as u32 != entry.dimensions[1]
            || dims[2] as u32 != entry.dimensions[2]
        {
            return Err(RenderLoopError::Internal {
                code: 6004,
                details: format!(
                    "Dimension mismatch on update: existing {:?}, new {:?}",
                    entry.dimensions,
                    [dims[0], dims[1], dims[2]]
                ),
            });
        }

        let (format, texture_data) = match entry.policy {
            UploadFormat::Automatic { preserve_labels }
                if entry.format == wgpu::TextureFormat::R32Float =>
            {
                (entry.format, encode_automatic_r32(volume, preserve_labels)?)
            }
            policy => encode_with_policy(volume, policy)?,
        };
        let (format, texture_data) = fit_filterable_format(
            volume,
            entry.policy,
            format,
            texture_data,
            entry.require_filterable
                && !device
                    .features()
                    .contains(wgpu::Features::FLOAT32_FILTERABLE),
        )?;
        let size = wgpu::Extent3d {
            width: entry.dimensions[0],
            height: entry.dimensions[1],
            depth_or_array_layers: entry.dimensions[2],
        };
        if format != entry.format {
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
            write_volume_texture(queue, &texture, size, &texture_data);
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            entry.texture = texture;
            entry.view = view;
            entry.format = format;
            self.bind_group = None;
        } else {
            write_volume_texture(queue, &entry.texture, size, &texture_data);
        }

        entry.world_to_voxel = volume.space().world_to_voxel();
        Ok(entry.world_to_voxel)
    }

    /// Get texture info by index
    pub fn get_texture_info(&self, index: u32) -> Option<TextureInfo> {
        self.textures.get(&index).map(|entry| TextureInfo {
            dimensions: entry.dimensions,
            format: entry.format,
            world_to_voxel: entry.world_to_voxel,
        })
    }

    /// Logical GPU byte footprint of one resident volume slot (`0` if empty).
    ///
    /// Counts unpadded `dims x bytes-per-voxel`; row/staging padding is an upload
    /// detail and is intentionally excluded so this reflects a stable VRAM budget
    /// number rather than a per-upload transient.
    pub fn slot_bytes(&self, index: u32) -> u64 {
        self.textures.get(&index).map(entry_bytes).unwrap_or(0)
    }

    /// Total logical GPU byte footprint of all resident volume textures.
    ///
    /// Excludes mask textures, the dummy slot, and the colormap LUT; this is the
    /// number a resident-set VRAM budget is measured against.
    pub fn resident_bytes(&self) -> u64 {
        self.textures.values().map(entry_bytes).sum()
    }

    /// Number of volume slots currently holding data.
    pub fn resident_slot_count(&self) -> usize {
        self.textures.len()
    }

    /// Number of volume slots that can still be allocated without evicting a
    /// resident texture (freed slots plus not-yet-grown capacity).
    pub fn free_slot_count(&self) -> usize {
        self.free_indices.len() + (self.max_textures.saturating_sub(self.next_index)) as usize
    }

    /// Maximum number of volume slots this manager supports.
    pub fn max_textures(&self) -> u32 {
        self.max_textures
    }

    /// Indices of all slots currently holding volume data (unordered).
    pub fn resident_indices(&self) -> Vec<u32> {
        self.textures.keys().copied().collect()
    }

    /// Release a specific volume texture and free its resources
    pub fn release_volume(&mut self, texture_index: u32) -> Result<(), RenderLoopError> {
        if let Some(_entry) = self.textures.remove(&texture_index) {
            // A reused slot must not inherit the previous volume's alpha mask.
            self.mask_textures.remove(&texture_index);
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
        self.mask_textures.clear();
        self.next_index = 0;
        self.free_indices.clear();
        self.bind_group = None;
        // Keep dummy texture, no need to recreate
    }
}

/// Bytes-per-voxel for the three texture formats this manager stores.
///
/// Returns `0` for any other format; only `R8Unorm`/`R16Float`/`R32Float` are
/// ever inserted (see [`MultiTextureManager::upload_volume`]), so this only
/// affects byte accounting, never an actual upload.
pub fn format_bytes_per_pixel(format: wgpu::TextureFormat) -> u64 {
    match format {
        wgpu::TextureFormat::R8Unorm => 1,
        wgpu::TextureFormat::R16Float => 2,
        wgpu::TextureFormat::R32Float => 4,
        _ => 0,
    }
}

/// Logical byte footprint of a single resident texture slot.
fn entry_bytes(entry: &TextureEntry) -> u64 {
    let [w, h, d] = entry.dimensions;
    (w as u64) * (h as u64) * (d as u64) * format_bytes_per_pixel(entry.format)
}

/// Information about a texture
#[derive(Debug, Clone)]
pub struct TextureInfo {
    pub dimensions: [u32; 3],
    pub format: wgpu::TextureFormat,
    pub world_to_voxel: Matrix4<f32>,
}

// Queue::write_texture accepts tightly packed rows. Only encoder buffer copies
// (including readback) require COPY_BYTES_PER_ROW_ALIGNMENT.
fn write_volume_texture(queue: &Queue, texture: &Texture, size: wgpu::Extent3d, data: &[u8]) {
    queue.write_texture(
        wgpu::ImageCopyTexture {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        data,
        wgpu::ImageDataLayout {
            offset: 0,
            bytes_per_row: Some(size.width * format_bytes_per_pixel(texture.format()) as u32),
            rows_per_image: Some(size.height),
        },
        size,
    );
}

fn conversion_error(details: &str) -> RenderLoopError {
    RenderLoopError::Internal {
        code: 6007,
        details: details.into(),
    }
}

pub(crate) fn encode_volume<T>(
    volume: &DenseVolume3<T>,
    format: wgpu::TextureFormat,
) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    match format {
        wgpu::TextureFormat::R8Unorm => convert_to_r8unorm(volume),
        wgpu::TextureFormat::R16Float => convert_to_r16float(volume),
        wgpu::TextureFormat::R32Float => convert_to_r32float(volume),
        _ => Err(RenderLoopError::UnsupportedVolumeFormat(
            volume.voxel_type(),
        )),
    }
}

// The common half-precision case validates and encodes each voxel once. A
// rare precision fallback retries the whole volume, validating every label.
pub(crate) fn encode_with_policy<T>(
    volume: &DenseVolume3<T>,
    policy: UploadFormat,
) -> Result<(wgpu::TextureFormat, Vec<u8>), RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    let preserve_labels = match policy {
        UploadFormat::Explicit(format) => return Ok((format, encode_volume(volume, format)?)),
        UploadFormat::Automatic { preserve_labels } => preserve_labels,
    };
    let values = volume.values_contiguous();
    let mut bytes = Vec::with_capacity(values.len() * 2);
    for &original in values.iter() {
        let value = checked_automatic_value(original, preserve_labels)?;
        let half = half::f16::from_f32(value);
        let rounded = half.to_f32();
        if value.is_finite()
            && (!rounded.is_finite()
                || (value != 0.0 && rounded == 0.0)
                || (preserve_labels && rounded != value))
        {
            // Do not retain the abandoned half buffer alongside the full one.
            drop(bytes);
            return Ok((
                wgpu::TextureFormat::R32Float,
                encode_automatic_r32(volume, preserve_labels)?,
            ));
        }
        bytes.extend_from_slice(&half.to_ne_bytes());
    }
    Ok((wgpu::TextureFormat::R16Float, bytes))
}

fn checked_automatic_value<T: num_traits::NumCast + Copy + PartialEq>(
    original: T,
    preserve_labels: bool,
) -> Result<f32, RenderLoopError> {
    let value = voxel_as_f32(original)?;
    if preserve_labels && value.is_finite() && num_traits::cast::<f32, T>(value) != Some(original) {
        return Err(conversion_error(
            "Label cannot be represented exactly by R32Float",
        ));
    }
    Ok(value)
}

/// R32Float needs FLOAT32_FILTERABLE in the filterable slice layout. When
/// the adapter lacks it (`r32_unfilterable`), an *automatic* scalar upload
/// that was promoted to R32Float falls back to R16Float: magnitudes above the
/// f16 range clamp to ±65504 and values below its smallest subnormal flush
/// to zero, with a warning. Label-preserving and explicitly requested R32Float
/// uploads keep the error, because f16 cannot hold them exactly.
pub(crate) fn fit_filterable_format<T>(
    volume: &DenseVolume3<T>,
    policy: UploadFormat,
    format: wgpu::TextureFormat,
    data: Vec<u8>,
    r32_unfilterable: bool,
) -> Result<(wgpu::TextureFormat, Vec<u8>), RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    if !(r32_unfilterable && format == wgpu::TextureFormat::R32Float) {
        return Ok((format, data));
    }
    if !matches!(
        policy,
        UploadFormat::Automatic {
            preserve_labels: false
        }
    ) {
        return Err(conversion_error(
            "R32Float requires FLOAT32_FILTERABLE for the active slice texture layout",
        ));
    }
    drop(data);
    let (bytes, clamped, flushed) = encode_r16_lossy(volume)?;
    warn!(
        "Adapter lacks FLOAT32_FILTERABLE: volume uploaded as R16Float instead of R32Float \
         ({clamped} voxels clamped to ±65504, {flushed} flushed to zero)"
    );
    Ok((wgpu::TextureFormat::R16Float, bytes))
}

/// Lossy R16Float encoding: clamp finite magnitudes to ±65504; values too
/// small for f16 flush to zero. Returns (bytes, clamped, flushed).
fn encode_r16_lossy<T>(volume: &DenseVolume3<T>) -> Result<(Vec<u8>, usize, usize), RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    let values = volume.values_contiguous();
    let mut bytes = Vec::with_capacity(values.len() * 2);
    let (mut clamped, mut flushed) = (0usize, 0usize);
    let max = half::f16::MAX.to_f32();
    for &original in values.iter() {
        let mut value = voxel_as_f32(original)?;
        if value.is_finite() && value.abs() > max {
            value = value.clamp(-max, max);
            clamped += 1;
        }
        let half = half::f16::from_f32(value);
        if value != 0.0 && value.is_finite() && half.to_f32() == 0.0 {
            flushed += 1;
        }
        bytes.extend_from_slice(&half.to_ne_bytes());
    }
    Ok((bytes, clamped, flushed))
}

fn encode_automatic_r32<T>(
    volume: &DenseVolume3<T>,
    preserve_labels: bool,
) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    let values = volume.values_contiguous();
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for &original in values.iter() {
        bytes.extend_from_slice(&checked_automatic_value(original, preserve_labels)?.to_ne_bytes());
    }
    Ok(bytes)
}

fn voxel_as_f32<T: num_traits::NumCast + Copy>(value: T) -> Result<f32, RenderLoopError> {
    let original = num_traits::cast::<T, f64>(value)
        .ok_or_else(|| conversion_error("Cannot convert voxel to f64"))?;
    let value = num_traits::cast::<T, f32>(value)
        .ok_or_else(|| conversion_error("Cannot convert voxel to f32"))?;
    if original.is_finite() && (!value.is_finite() || (original != 0.0 && value == 0.0)) {
        return Err(conversion_error(
            "Voxel exceeds the finite nonzero range supported by R32Float",
        ));
    }
    Ok(value)
}

// Helper functions for data conversion

fn convert_to_r8unorm<T>(volume: &DenseVolume3<T>) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    // R8Unorm is an explicitly requested, range-normalized display format.
    // Cast BEFORE arithmetic: integer division otherwise collapses the contrast.
    let values = volume.values_contiguous();
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for &value in values.iter() {
        let value = num_traits::cast::<T, f64>(value)
            .ok_or_else(|| conversion_error("Cannot convert voxel to f64"))?;
        if !value.is_finite() {
            return Err(conversion_error(
                "R8Unorm cannot preserve non-finite voxels; use a float format",
            ));
        }
        min = min.min(value);
        max = max.max(value);
    }
    if values.is_empty() {
        return Err(conversion_error("Cannot upload an empty volume"));
    }
    let range = max - min;
    if !range.is_finite() {
        return Err(conversion_error(
            "R8Unorm normalization range is not finite",
        ));
    }
    Ok(values
        .iter()
        .map(|&value| {
            let value = num_traits::cast::<T, f64>(value).unwrap();
            if range > 0.0 {
                (((value - min) / range) * 255.0).round() as u8
            } else {
                0
            }
        })
        .collect())
}

fn convert_to_r16float<T>(volume: &DenseVolume3<T>) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    // Single pass: cast each voxel f32 -> f16 and append its 2 bytes directly,
    // into a pre-sized buffer. Avoids the intermediate Vec<f16> allocation and
    // the per-element flat_map of the old two-step version. Byte-for-byte
    // identical output (see test convert_to_r16float_matches_reference).
    // values_contiguous() borrows the backing buffer (no rebuild) for the
    // Fortran-laid-out volumes that reach the GPU.
    let values = volume.values_contiguous();
    let mut bytes = Vec::with_capacity(values.len() * 2);
    for &val in values.iter() {
        let f32_val = voxel_as_f32(val)?;
        let half = half::f16::from_f32(f32_val);
        if f32_val.is_finite() && (!half.is_finite() || (f32_val != 0.0 && half.to_f32() == 0.0)) {
            return Err(conversion_error(
                "R16Float would overflow or erase a finite nonzero voxel; use R32Float",
            ));
        }
        bytes.extend_from_slice(&half.to_ne_bytes());
    }
    Ok(bytes)
}

fn convert_to_r32float<T>(volume: &DenseVolume3<T>) -> Result<Vec<u8>, RenderLoopError>
where
    T: VoxelData + num_traits::NumCast + DataRange<T> + Serialize,
{
    // Single pass into a pre-sized buffer (see convert_to_r16float).
    let values = volume.values_contiguous();
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for &val in values.iter() {
        let f32_val = voxel_as_f32(val)?;
        bytes.extend_from_slice(&f32_val.to_ne_bytes());
    }
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
    fn normalized_u8_conversion_retains_intermediate_levels() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![3, 1, 1], vec![1.; 3], vec![0.; 3]).unwrap();
        let volume = DenseVolume3::from_data(space, vec![32u8, 64, 96]);
        assert_eq!(convert_to_r8unorm(&volume).unwrap(), [0, 128, 255]);
        assert_eq!(
            encode_with_policy(
                &volume,
                UploadFormat::Automatic {
                    preserve_labels: false
                }
            )
            .unwrap()
            .0,
            wgpu::TextureFormat::R16Float
        );
    }

    #[test]
    fn normalized_range_overflow_is_rejected() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![2, 1, 1], vec![1.; 3], vec![0.; 3]).unwrap();
        let volume = DenseVolume3::from_data(space, vec![-1e308f64, 1e308]);
        assert!(convert_to_r8unorm(&volume).is_err());
    }

    #[test]
    fn default_precision_preserves_finite_range_and_label_identity() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![1; 3], vec![1.; 3], vec![0.; 3]).unwrap();
        for value in [70_000f32, -70_000., 1e-9] {
            let volume = DenseVolume3::from_data(space.clone(), vec![value]);
            assert_eq!(
                encode_with_policy(
                    &volume,
                    UploadFormat::Automatic {
                        preserve_labels: false
                    }
                )
                .unwrap()
                .0,
                wgpu::TextureFormat::R32Float
            );
            assert!(convert_to_r16float(&volume).is_err());
            assert_eq!(convert_to_r32float(&volume).unwrap(), value.to_ne_bytes());
        }
        let label = DenseVolume3::from_data(space.clone(), vec![2049u16]);
        assert_eq!(
            encode_with_policy(
                &label,
                UploadFormat::Automatic {
                    preserve_labels: true
                }
            )
            .unwrap()
            .0,
            wgpu::TextureFormat::R32Float
        );
        let label32 = DenseVolume3::from_data(space.clone(), vec![16_777_217u32]);
        assert!(encode_with_policy(
            &label32,
            UploadFormat::Automatic {
                preserve_labels: true
            }
        )
        .is_err());
        let overflow = DenseVolume3::from_data(space, vec![1e100f64]);
        assert!(convert_to_r32float(&overflow).is_err());
    }

    #[test]
    fn unfilterable_r32_falls_back_to_lossy_r16_for_scalars_only() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![3, 1, 1], vec![1.; 3], vec![0.; 3]).unwrap();
        // 1e6 overflows f16 and 1e-9 underflows it: automatic encoding promotes.
        let volume = DenseVolume3::from_data(space.clone(), vec![1e6f32, 1e-9, 3.0]);
        let scalar = UploadFormat::Automatic {
            preserve_labels: false,
        };
        let (format, bytes) = encode_with_policy(&volume, scalar).unwrap();
        assert_eq!(format, wgpu::TextureFormat::R32Float);
        // Filterable adapter: R32Float is kept.
        let kept = fit_filterable_format(&volume, scalar, format, bytes.clone(), false).unwrap();
        assert_eq!(kept.0, wgpu::TextureFormat::R32Float);
        // Unfilterable adapter: R16Float with clamp and flush.
        let (format, bytes) = fit_filterable_format(&volume, scalar, format, bytes, true).unwrap();
        assert_eq!(format, wgpu::TextureFormat::R16Float);
        let decoded: Vec<f32> = bytes
            .chunks_exact(2)
            .map(|b| half::f16::from_ne_bytes([b[0], b[1]]).to_f32())
            .collect();
        assert_eq!(decoded, vec![65504.0, 0.0, 3.0]);
        // Labels and explicit R32Float keep the error.
        let labels = DenseVolume3::from_data(space, vec![1u32, 2049, 7]);
        let label_policy = UploadFormat::Automatic {
            preserve_labels: true,
        };
        let (format, bytes) = encode_with_policy(&labels, label_policy).unwrap();
        assert!(fit_filterable_format(&labels, label_policy, format, bytes, true).is_err());
        let explicit = UploadFormat::Explicit(wgpu::TextureFormat::R32Float);
        let (format, bytes) = encode_with_policy(&volume, explicit).unwrap();
        assert!(fit_filterable_format(&volume, explicit, format, bytes, true).is_err());
    }

    #[test]
    fn unfilterable_device_uploads_promoted_scalar_volume_as_r16() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        // The default device descriptor does not enable FLOAT32_FILTERABLE.
        let (device, queue) = pollster::block_on(create_test_device());
        assert!(!device
            .features()
            .contains(wgpu::Features::FLOAT32_FILTERABLE));
        let mut manager = MultiTextureManager::new(&device, &queue, 4);
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![2, 2, 2], vec![1.; 3], vec![0.; 3]).unwrap();
        let volume =
            DenseVolume3::from_data(space, vec![1e6f32, 0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        let (index, _) = manager
            .upload_volume_with_policy(
                &device,
                &queue,
                &volume,
                UploadFormat::Automatic {
                    preserve_labels: false,
                },
                true,
            )
            .unwrap();
        assert_eq!(
            manager.textures.get(&index).unwrap().format,
            wgpu::TextureFormat::R16Float
        );
    }

    #[test]
    fn automatic_encoding_retries_and_checks_all_labels() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        let space =
            NeuroSpace::from_dims_spacing_origin(vec![3, 1, 1], vec![1.; 3], vec![0.; 3]).unwrap();
        let volume = DenseVolume3::from_data(space.clone(), vec![1u32, 2049, 7]);
        let (format, bytes) = encode_with_policy(
            &volume,
            UploadFormat::Automatic {
                preserve_labels: true,
            },
        )
        .unwrap();
        assert_eq!(format, wgpu::TextureFormat::R32Float);
        let expected: Vec<u8> = [1f32, 2049., 7.]
            .iter()
            .flat_map(|value| value.to_ne_bytes())
            .collect();
        assert_eq!(bytes, expected);
        let invalid = DenseVolume3::from_data(space, vec![1u32, 2049, 16_777_217]);
        assert!(encode_with_policy(
            &invalid,
            UploadFormat::Automatic {
                preserve_labels: true
            }
        )
        .is_err());
    }

    #[test]
    fn update_refreshes_texture_affine() {
        use volmath::{NeuroSpace, NeuroSpaceExt};
        pollster::block_on(async {
            let (device, queue) = create_test_device().await;
            let mut manager = MultiTextureManager::new(&device, &queue, MAX_TEXTURES as u32);
            let original =
                NeuroSpace::from_dims_spacing_origin(vec![2; 3], vec![1.; 3], vec![0.; 3]).unwrap();
            let replacement =
                NeuroSpace::from_dims_spacing_origin(vec![2; 3], vec![2.; 3], vec![3.; 3]).unwrap();
            let first = DenseVolume3::from_data(original, vec![1f32; 8]);
            let second = DenseVolume3::from_data(replacement, vec![2f32; 8]);
            let (index, old) = manager
                .upload_volume(&device, &queue, &first, wgpu::TextureFormat::R16Float)
                .unwrap();
            let updated = manager
                .update_volume(&device, &queue, index, &second)
                .unwrap();
            assert_ne!(updated, old);
            assert_eq!(updated, second.space().world_to_voxel());
            assert_eq!(
                manager.get_texture_info(index).unwrap().world_to_voxel,
                updated
            );
        });
    }

    #[test]
    fn test_multi_texture_upload() {
        pollster::block_on(async {
            let (device, queue) = create_test_device().await;
            let mut manager = MultiTextureManager::new(&device, &queue, MAX_TEXTURES as u32);

            let volume = create_test_pattern_volume();

            let (index, _transform) = manager
                .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                .expect("Failed to upload volume");

            assert_eq!(index, 0);

            let info = manager.get_texture_info(0).expect("Should have texture 0");
            assert_eq!(info.dimensions, [64, 64, 25]);
            assert_eq!(info.format, wgpu::TextureFormat::R8Unorm);
        });
    }

    #[test]
    fn failed_uploads_preserve_free_slots() {
        pollster::block_on(async {
            let (device, queue) = create_test_device().await;
            let mut manager = MultiTextureManager::new(&device, &queue, 2);
            let volume = create_test_pattern_volume();
            // Exercise both a fresh index and an index returned to the free list.
            for reused in [false, true] {
                if reused {
                    let (index, _) = manager
                        .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                        .unwrap();
                    manager.release_volume(index).unwrap();
                }
                for _ in 0..20 {
                    assert!(manager
                        .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::Rgba8Unorm)
                        .is_err());
                    assert_eq!(manager.resident_slot_count(), 0);
                    assert_eq!(manager.free_slot_count(), 2);
                }
            }
            let (index, _) = manager
                .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                .unwrap();
            assert_eq!(index, 0);
        });
    }

    #[test]
    fn released_and_cleared_slots_do_not_retain_masks() {
        pollster::block_on(async {
            let (device, queue) = create_test_device().await;
            let mut manager = MultiTextureManager::new(&device, &queue, 2);
            let volume = create_test_pattern_volume();
            let (index, _) = manager
                .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                .unwrap();
            manager
                .upload_mask_texture(&device, &queue, index, [64, 64, 25], &vec![0; 64 * 64 * 25])
                .unwrap();
            assert_eq!(manager.mask_textures.len(), 1);
            manager.release_volume(index).unwrap();
            assert!(manager.mask_textures.is_empty());
            let (reused, _) = manager
                .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                .unwrap();
            assert_eq!(index, reused);
            assert!(manager.mask_textures.is_empty());
            manager
                .upload_mask_texture(
                    &device,
                    &queue,
                    reused,
                    [64, 64, 25],
                    &vec![0; 64 * 64 * 25],
                )
                .unwrap();
            manager.clear();
            assert!(manager.mask_textures.is_empty());
            assert_eq!(manager.free_slot_count(), 2);
        });
    }

    #[test]
    fn format_bytes_per_pixel_covers_supported_formats() {
        assert_eq!(format_bytes_per_pixel(wgpu::TextureFormat::R8Unorm), 1);
        assert_eq!(format_bytes_per_pixel(wgpu::TextureFormat::R16Float), 2);
        assert_eq!(format_bytes_per_pixel(wgpu::TextureFormat::R32Float), 4);
        // Unsupported formats contribute 0 to the budget (never uploaded).
        assert_eq!(format_bytes_per_pixel(wgpu::TextureFormat::Rgba8Unorm), 0);
    }

    #[test]
    fn resident_byte_accounting_tracks_admit_evict() {
        pollster::block_on(async {
            let (device, queue) = create_test_device().await;
            let mut manager = MultiTextureManager::new(&device, &queue, MAX_TEXTURES as u32);

            // Empty manager: nothing resident, all slots free.
            assert_eq!(manager.resident_bytes(), 0);
            assert_eq!(manager.resident_slot_count(), 0);
            assert_eq!(manager.free_slot_count(), MAX_TEXTURES);

            // 64 * 64 * 25 voxels.
            let volume = create_test_pattern_volume();
            let voxels: u64 = 64 * 64 * 25;

            // R8Unorm = 1 byte/voxel.
            let (idx0, _) = manager
                .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                .expect("upload 0");
            assert_eq!(manager.slot_bytes(idx0), voxels);
            assert_eq!(manager.resident_bytes(), voxels);
            assert_eq!(manager.resident_slot_count(), 1);
            assert_eq!(manager.free_slot_count(), MAX_TEXTURES - 1);

            // R16Float = 2 bytes/voxel: the same volume costs twice the VRAM.
            let (idx1, _) = manager
                .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R16Float)
                .expect("upload 1");
            assert_eq!(manager.slot_bytes(idx1), voxels * 2);
            assert_eq!(manager.resident_bytes(), voxels + voxels * 2);
            assert_eq!(manager.resident_slot_count(), 2);

            // Evicting a slot drops its bytes from the budget and frees the slot
            // for reuse.
            manager.release_volume(idx0).expect("release 0");
            assert_eq!(manager.slot_bytes(idx0), 0);
            assert_eq!(manager.resident_bytes(), voxels * 2);
            assert_eq!(manager.resident_slot_count(), 1);

            // Re-admitting reuses the freed index (ring behaviour).
            let (idx2, _) = manager
                .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                .expect("upload 2");
            assert_eq!(idx2, idx0, "freed index should be reused before growing");
            assert_eq!(manager.resident_bytes(), voxels + voxels * 2);
        });
    }

    #[test]
    fn convert_to_r16float_matches_reference() {
        use volmath::space::{NeuroSpace3, NeuroSpaceImpl};

        let dims = [2usize, 3, 4];
        let n = dims[0] * dims[1] * dims[2];
        // Distinct values including fractions and a negative, to exercise the
        // f32 -> f16 rounding and the byte layout.
        let data: Vec<f32> = (0..n).map(|i| (i as f32) * 0.5 - 3.0).collect();
        let voxel_to_world = nalgebra::Matrix4::<f32>::identity();
        let space_impl =
            NeuroSpaceImpl::from_affine_matrix4(dims.to_vec(), voxel_to_world).unwrap();
        let space = NeuroSpace3::new(space_impl);
        let vol = DenseVolume3::from_data(space.0, data);

        // Reference = the original two-step algorithm this commit collapses.
        let reference: Vec<u8> = vol
            .values()
            .iter()
            .map(|&v| half::f16::from_f32(v))
            .flat_map(|h| h.to_ne_bytes())
            .collect();

        let actual = convert_to_r16float(&vol).expect("convert");
        assert_eq!(actual, reference, "single-pass output must match reference");
        assert_eq!(actual.len(), n * 2);
    }
}

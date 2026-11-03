//! GPU volume textures and their masks, one per residency slot: uploads,
//! per-slot generations ([`SlotHandle`]), editable-label claims and byte
//! accounting. It knows nothing about binding positions, layers or
//! workspaces; `MultiTextureManager` builds the bind group from it.

use super::encode::{
    conversion_error, encode_automatic_r32, encode_with_policy, fit_filterable_format, UploadFormat,
};
use crate::RenderLoopError;
use nalgebra::Matrix4;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use volmath::{DataRange, DenseVolume3, NeuroSpaceExt, VoxelData};
use wgpu::{Device, Queue, Texture, TextureView};

static NEXT_TEXTURE_MANAGER: AtomicUsize = AtomicUsize::new(1);

/// Maximum number of textures supported (GPU limit - 1 for colormap)
/// Metal adapters only allow 30 sampled textures per stage, so we keep
/// room for the mask array plus samplers/LUT bindings.
pub const MAX_TEXTURES: usize = 13;

/// The resident volume textures and masks of one renderer.
pub struct ResidentTextureStore {
    /// Map from texture index to texture and view
    textures: HashMap<u32, TextureEntry>,
    /// Optional mask textures per index
    mask_textures: HashMap<u32, MaskTextureEntry>,
    /// Next available texture index
    next_index: u32,
    /// Last generation handed out. Every upload into a slot takes the next one,
    /// so a handle from an earlier residency of the same index never matches.
    next_generation: u64,
    identity: usize,
    /// Maximum number of textures supported
    max_textures: u32,
    /// Freed texture indices available for reuse
    free_indices: Vec<u32>,
}

pub(crate) struct TextureEntry {
    #[allow(dead_code)]
    texture: Texture,
    pub(crate) view: TextureView,
    format: wgpu::TextureFormat,
    pub(crate) dimensions: [u32; 3],
    world_to_voxel: Matrix4<f32>,
    policy: UploadFormat,
    require_filterable: bool,
    /// The upload that filled this slot; see [`SlotHandle`].
    generation: u64,
    /// Uploaded revision of an editable label texture.
    editable: Option<u64>,
    editable_volume_id: Option<String>,
}

pub(crate) struct MaskTextureEntry {
    #[allow(dead_code)]
    texture: Texture,
    pub(crate) view: TextureView,
}

/// One residency of a texture slot: its index and the generation of the upload
/// that filled it. Numeric indices are reused; a generation is not, so an owner
/// holding a handle from an earlier residency (a stale lease, a provisional
/// upload, a ring account) can never release or write another volume's texture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SlotHandle {
    index: u32,
    generation: u64,
    manager: usize,
}
impl SlotHandle {
    pub fn index(self) -> u32 {
        self.index
    }
    pub fn generation(self) -> u64 {
        self.generation
    }
}

/// A resident editable texture's identity: its slot residency, claimed for
/// revisioned label edits. A late edit cannot write into another volume after
/// the numeric slot has been reused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditableTextureHandle {
    slot: SlotHandle,
}
impl EditableTextureHandle {
    pub fn texture_index(self) -> u32 {
        self.slot.index
    }
    pub fn slot(self) -> SlotHandle {
        self.slot
    }
}

/// Tightly packed, x-fastest u16 labels. A partial update must follow the last
/// uploaded revision; a full-grid replacement may catch up across revisions.
pub struct LabelRegionUpdate<'a> {
    pub expected_revision: u64,
    pub revision: u64,
    pub origin: [u32; 3],
    pub dimensions: [u32; 3],
    pub labels: &'a [u16],
    /// Global range after the edit, supplied by the authoritative label store.
    pub data_range: (u16, u16),
}

impl ResidentTextureStore {
    pub fn new(max_textures: u32) -> Self {
        Self {
            textures: HashMap::new(),
            mask_textures: HashMap::new(),
            next_index: 0,
            next_generation: 0,
            identity: NEXT_TEXTURE_MANAGER
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| v.checked_add(1))
                .expect("Texture manager identity exhausted"),
            max_textures,
            free_indices: Vec::new(),
        }
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

        let generation = self
            .next_generation
            .checked_add(1)
            .ok_or_else(|| conversion_error("Texture slot generation exhausted"))?;
        self.next_generation = generation;
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
                generation,
                editable: None,
                editable_volume_id: None,
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

    pub(crate) fn claim_editable(
        &mut self,
        index: u32,
        revision: u64,
    ) -> Result<EditableTextureHandle, RenderLoopError> {
        let entry = self
            .textures
            .get_mut(&index)
            .ok_or_else(|| conversion_error("Editable texture is no longer resident"))?;
        if entry.format != wgpu::TextureFormat::R32Float {
            return Err(conversion_error(
                "Editable labels require exact R32Float storage",
            ));
        }
        entry.editable = Some(revision);
        Ok(EditableTextureHandle {
            slot: SlotHandle {
                index,
                generation: entry.generation,
                manager: self.identity,
            },
        })
    }

    /// The current residency of `index`, if it holds data.
    pub fn slot_handle(&self, index: u32) -> Option<SlotHandle> {
        self.textures.get(&index).map(|entry| SlotHandle {
            index,
            generation: entry.generation,
            manager: self.identity,
        })
    }

    /// Whether `handle` still names the residency in its slot.
    pub fn is_current(&self, handle: SlotHandle) -> bool {
        handle.manager == self.identity && self.slot_handle(handle.index) == Some(handle)
    }

    /// Release the slot only if `handle` is its current residency. A stale
    /// handle (released, or the index since refilled) is a no-op: `Ok(false)`.
    pub fn release_slot(&mut self, handle: SlotHandle) -> Result<bool, RenderLoopError> {
        if !self.is_current(handle) {
            return Ok(false);
        }
        self.release_volume(handle.index).map(|()| true)
    }

    /// The current resident handle, for hosts resolving a live volume mapping
    /// under their own operation lock. Never reconstruct a handle from an old slot.
    pub(crate) fn editable_handle(&self, index: u32) -> Option<EditableTextureHandle> {
        self.textures.get(&index)?.editable?;
        self.slot_handle(index)
            .map(|slot| EditableTextureHandle { slot })
    }

    /// Bind an editable residency to its logical volume. A reused numeric slot
    /// cannot be resolved through a stale host map for a different document.
    pub(crate) fn bind_editable_volume(
        &mut self,
        handle: EditableTextureHandle,
        volume_id: &str,
    ) -> Result<(), RenderLoopError> {
        self.editable_revision(handle)?;
        let entry = self
            .textures
            .get_mut(&handle.texture_index())
            .expect("validated residency");
        if entry
            .editable_volume_id
            .as_deref()
            .is_some_and(|owner| owner != volume_id)
        {
            return Err(conversion_error(
                "Editable residency belongs to another volume",
            ));
        }
        entry.editable_volume_id = Some(volume_id.to_owned());
        Ok(())
    }
    pub fn editable_handle_for_volume(
        &self,
        volume_id: &str,
        index: u32,
    ) -> Option<EditableTextureHandle> {
        if self.textures.get(&index)?.editable_volume_id.as_deref() != Some(volume_id) {
            return None;
        }
        self.editable_handle(index)
    }

    pub fn editable_revision(&self, handle: EditableTextureHandle) -> Result<u64, RenderLoopError> {
        if handle.slot.manager != self.identity {
            return Err(conversion_error(
                "Editable texture belongs to another renderer",
            ));
        }
        self.textures
            .get(&handle.slot.index)
            .filter(|entry| entry.generation == handle.slot.generation)
            .and_then(|entry| entry.editable)
            .ok_or_else(|| conversion_error("Editable texture was released or replaced"))
    }

    /// Validate the entire update before enqueueing any GPU write or revision change.
    pub fn update_label_region(
        &mut self,
        queue: &Queue,
        handle: EditableTextureHandle,
        update: &LabelRegionUpdate<'_>,
    ) -> Result<(), RenderLoopError> {
        let current = self.editable_revision(handle)?;
        if current != update.expected_revision {
            return Err(conversion_error(
                "Label texture revision conflict; a full re-upload is required",
            ));
        }
        let entry = self
            .textures
            .get_mut(&handle.slot.index)
            .expect("validated texture");
        let full = update.origin == [0; 3] && update.dimensions == entry.dimensions;
        if update.revision <= current || (!full && current.checked_add(1) != Some(update.revision))
        {
            return Err(conversion_error(
                "Label texture update skips or repeats a revision",
            ));
        }
        let mut count = 1usize;
        for axis in 0..3 {
            if update.dimensions[axis] == 0
                || update.origin[axis]
                    .checked_add(update.dimensions[axis])
                    .is_none_or(|end| end > entry.dimensions[axis])
            {
                return Err(conversion_error(
                    "Label texture region is outside the volume",
                ));
            }
            count = count
                .checked_mul(update.dimensions[axis] as usize)
                .ok_or_else(|| conversion_error("Label texture region overflows"))?;
        }
        if count != update.labels.len()
            || update.data_range.0 > update.data_range.1
            || update
                .labels
                .iter()
                .any(|&v| v < update.data_range.0 || v > update.data_range.1)
        {
            return Err(conversion_error(
                "Label texture data or range does not match the region",
            ));
        }
        let values: Vec<f32> = update.labels.iter().map(|&v| f32::from(v)).collect();
        queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &entry.texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: update.origin[0],
                    y: update.origin[1],
                    z: update.origin[2],
                },
                aspect: wgpu::TextureAspect::All,
            },
            bytemuck::cast_slice(&values),
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(update.dimensions[0] * 4),
                rows_per_image: Some(update.dimensions[1]),
            },
            wgpu::Extent3d {
                width: update.dimensions[0],
                height: update.dimensions[1],
                depth_or_array_layers: update.dimensions[2],
            },
        );
        entry.editable = Some(update.revision);
        Ok(())
    }

    /// Overwrite an existing texture slot with new volume data (dimensions must match).
    /// Also reports whether the slot's texture (and so its view) was replaced.
    pub fn update_volume<T>(
        &mut self,
        device: &Device,
        queue: &Queue,
        index: u32,
        volume: &DenseVolume3<T>,
    ) -> Result<(Matrix4<f32>, bool), RenderLoopError>
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

        if entry.editable.is_some() {
            return Err(conversion_error(
                "Use revisioned region updates for editable labels",
            ));
        }

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
        let mut replaced = false;
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
            replaced = true;
        } else {
            write_volume_texture(queue, &entry.texture, size, &texture_data);
        }

        entry.world_to_voxel = volume.space().world_to_voxel();
        Ok((entry.world_to_voxel, replaced))
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
    }

    /// The resident entry of `index`, for building bind groups.
    pub(crate) fn texture_entry(&self, index: u32) -> Option<&TextureEntry> {
        self.textures.get(&index)
    }

    /// The mask of `index`, if one was uploaded.
    pub(crate) fn mask_entry(&self, index: u32) -> Option<&MaskTextureEntry> {
        self.mask_textures.get(&index)
    }

    #[cfg(test)]
    pub(crate) fn mask_count(&self) -> usize {
        self.mask_textures.len()
    }
}

/// Bytes-per-voxel for the three texture formats this manager stores.
///
/// Returns `0` for any other format; only `R8Unorm`/`R16Float`/`R32Float` are
/// ever inserted (see [`ResidentTextureStore::upload_volume`]), so this only
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

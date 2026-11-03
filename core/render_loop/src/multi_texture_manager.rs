// Multi-texture management for world-space rendering

use crate::RenderLoopError;
use log::debug;
use nalgebra::Matrix4;
use serde::Serialize;
use std::ops::{Deref, DerefMut};
use volmath::{DataRange, DenseVolume3, VoxelData};
use wgpu::{BindGroupLayout, Device, Queue, Texture, TextureView};

pub(crate) use crate::residency::{encode_with_policy, UploadFormat};
pub use crate::residency::{
    format_bytes_per_pixel, EditableTextureHandle, LabelRegionUpdate, ResidentTextureStore,
    SlotHandle, TextureInfo, MAX_TEXTURES,
};

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

/// The resident textures ([`ResidentTextureStore`]) plus the bind group that
/// exposes them to the slice shaders. Store methods are reached through
/// `Deref`; the ones that change what a binding shows are wrapped here so they
/// also drop the cached bind group.
pub struct MultiTextureManager {
    store: ResidentTextureStore,
    /// Texture bind group
    bind_group: Option<TextureBindGroup>,
    /// Dummy texture for unused slots
    dummy_texture: Option<Texture>,
    /// Dummy texture view
    dummy_view: Option<TextureView>,
    /// Default white mask texture for unmasked layers
    default_mask_texture: Option<Texture>,
    default_mask_view: Option<TextureView>,
}

impl Deref for MultiTextureManager {
    type Target = ResidentTextureStore;
    fn deref(&self) -> &ResidentTextureStore {
        &self.store
    }
}

impl DerefMut for MultiTextureManager {
    fn deref_mut(&mut self) -> &mut ResidentTextureStore {
        &mut self.store
    }
}

impl MultiTextureManager {
    /// Create a new multi-texture manager
    pub fn new(device: &Device, queue: &Queue, max_textures: u32) -> Self {
        let mut manager = Self {
            store: ResidentTextureStore::new(max_textures),
            bind_group: None,
            dummy_texture: None,
            dummy_view: None,
            default_mask_texture: None,
            default_mask_view: None,
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
            self.store.resident_indices()
        );

        // Build bind group entries for individual texture bindings
        let mut entries = Vec::new();

        // Binding indices come from the shared shader contract (group 2).
        let bindings = crate::shader_contract::texture::bindings(self.store.max_textures());

        // Volume textures.
        for i in 0..self.store.max_textures() {
            let view = if let Some(entry) = self.store.texture_entry(i) {
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
        for i in 0..self.store.max_textures() {
            let view = self
                .store
                .mask_entry(i)
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
            self.store.resident_indices()
        );

        // Build bind group entries for individual texture bindings
        let mut entries = Vec::new();

        // Binding indices come from the shared shader contract (group 2).
        let bindings = crate::shader_contract::texture::bindings(self.store.max_textures());

        // Volume textures.
        for i in 0..self.store.max_textures() {
            let view = if let Some(entry) = self.store.texture_entry(i) {
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
        for i in 0..self.store.max_textures() {
            let view = self
                .store
                .mask_entry(i)
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

    /// [`ResidentTextureStore::update_volume`]; a replaced texture invalidates
    /// the bind group.
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
        let (world_to_voxel, replaced) = self.store.update_volume(device, queue, index, volume)?;
        if replaced {
            self.bind_group = None;
        }
        Ok(world_to_voxel)
    }

    /// [`ResidentTextureStore::release_slot`]; a released slot invalidates the
    /// bind group.
    pub fn release_slot(&mut self, handle: SlotHandle) -> Result<bool, RenderLoopError> {
        let released = self.store.release_slot(handle)?;
        if released {
            self.bind_group = None;
        }
        Ok(released)
    }

    /// [`ResidentTextureStore::release_volume`], invalidating the bind group
    /// since texture bindings have changed.
    pub fn release_volume(&mut self, texture_index: u32) -> Result<(), RenderLoopError> {
        self.store.release_volume(texture_index)?;
        self.bind_group = None;
        Ok(())
    }

    /// Clear all textures
    pub fn clear(&mut self) {
        self.store.clear();
        self.bind_group = None;
        // Keep dummy texture, no need to recreate
    }
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
            manager.get_texture_info(index).unwrap().format,
            wgpu::TextureFormat::R16Float
        );
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
            assert_eq!(manager.mask_count(), 1);
            manager.release_volume(index).unwrap();
            assert_eq!(manager.mask_count(), 0);
            let (reused, _) = manager
                .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                .unwrap();
            assert_eq!(index, reused);
            assert_eq!(manager.mask_count(), 0);
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
            assert_eq!(manager.mask_count(), 0);
            assert_eq!(manager.free_slot_count(), 2);
        });
    }

    #[test]
    fn every_upload_into_a_slot_takes_a_new_generation() {
        pollster::block_on(async {
            let (device, queue) = create_test_device().await;
            let mut manager = MultiTextureManager::new(&device, &queue, 2);
            let volume = create_test_pattern_volume();
            let upload = |manager: &mut MultiTextureManager| {
                let (index, _) = manager
                    .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                    .unwrap();
                manager.slot_handle(index).unwrap()
            };
            let first = upload(&mut manager);
            let other = upload(&mut manager);
            assert_ne!(first.index(), other.index());
            assert!(manager.is_current(first) && manager.is_current(other));

            manager.release_volume(first.index()).unwrap();
            assert!(!manager.is_current(first));
            assert_eq!(manager.slot_handle(first.index()), None);
            let refilled = upload(&mut manager);
            assert_eq!(refilled.index(), first.index(), "the index is reused");
            assert!(refilled.generation() > first.generation());
            assert!(refilled.generation() > other.generation());
            assert!(!manager.is_current(first));
            assert!(manager.is_current(refilled));
        });
    }

    #[test]
    fn a_stale_handle_releases_nothing() {
        pollster::block_on(async {
            let (device, queue) = create_test_device().await;
            let mut manager = MultiTextureManager::new(&device, &queue, 2);
            let volume = create_test_pattern_volume();
            let (index, _) = manager
                .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                .unwrap();
            let stale = manager.slot_handle(index).unwrap();
            assert!(manager.release_slot(stale).unwrap());
            // Released twice: the second is a no-op, not an error.
            assert!(!manager.release_slot(stale).unwrap());

            // Another volume takes the index; the old owner cannot free it.
            let (reused, _) = manager
                .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                .unwrap();
            assert_eq!(reused, index);
            let free_before = manager.free_slot_count();
            assert!(!manager.release_slot(stale).unwrap());
            assert!(manager.get_texture_info(reused).is_some());
            assert_eq!(manager.free_slot_count(), free_before);

            // A handle from another manager is never current here.
            let mut other = MultiTextureManager::new(&device, &queue, 2);
            let (foreign, _) = other
                .upload_volume(&device, &queue, &volume, wgpu::TextureFormat::R8Unorm)
                .unwrap();
            let foreign = other.slot_handle(foreign).unwrap();
            assert!(!manager.release_slot(foreign).unwrap());
            assert!(manager.get_texture_info(reused).is_some());
        });
    }

    #[test]
    fn an_editable_handle_is_its_slot_residency() {
        pollster::block_on(async {
            use volmath::{NeuroSpace, NeuroSpaceExt};
            let (device, queue) = create_test_device().await;
            let mut manager = MultiTextureManager::new(&device, &queue, 2);
            let space =
                NeuroSpace::from_dims_spacing_origin(vec![2, 2, 2], vec![1.; 3], vec![0.; 3])
                    .unwrap();
            let labels = DenseVolume3::from_data(space, vec![0u16; 8]);
            let (index, _) = manager
                .upload_volume(&device, &queue, &labels, wgpu::TextureFormat::R32Float)
                .unwrap();
            assert!(manager.editable_handle(index).is_none(), "not claimed yet");
            let handle = manager.claim_editable(index, 3).unwrap();
            assert_eq!(handle.slot(), manager.slot_handle(index).unwrap());
            assert_eq!(manager.editable_handle(index), Some(handle));
            assert_eq!(manager.editable_revision(handle).unwrap(), 3);

            manager.release_volume(index).unwrap();
            let (reused, _) = manager
                .upload_volume(&device, &queue, &labels, wgpu::TextureFormat::R32Float)
                .unwrap();
            assert_eq!(reused, index);
            let fresh = manager.claim_editable(reused, 0).unwrap();
            assert_ne!(fresh, handle);
            assert!(manager.editable_revision(handle).is_err());
            assert!(!manager.release_slot(handle.slot()).unwrap());
            assert_eq!(manager.editable_revision(fresh).unwrap(), 0);
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
}

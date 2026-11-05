// Multi-texture management for world-space rendering

use crate::{
    binding::{BindingCacheStats, BindingPlan, BindingPlanner},
    RenderLoopError,
};
use nalgebra::Matrix4;
use serde::Serialize;
use std::ops::{Deref, DerefMut};
use std::sync::Arc;
use volmath::{DataRange, DenseVolume3, VoxelData};
use wgpu::{BindGroupLayout, Device, Queue, Texture, TextureView};

pub(crate) use crate::residency::{encode_with_policy, UploadFormat};
pub use crate::residency::{
    format_bytes_per_pixel, EditableTextureHandle, LabelRegionUpdate, ResidentTextureStore,
    SlotHandle, TextureInfo, MAX_TEXTURES,
};

type TextureBindGroup = wgpu::BindGroup;

/// The resident textures ([`ResidentTextureStore`]) plus the bind group that
/// exposes them to the slice shaders. Store methods are reached through
/// `Deref`; the ones that change what a binding shows are wrapped here so they
/// also drop the cached bind group.
pub struct MultiTextureManager {
    store: ResidentTextureStore,
    /// Texture bind group
    bind_group: Option<Arc<TextureBindGroup>>,
    bind_group_revision: Option<(usize, u64)>,
    identity_group: bool,
    pub(crate) binding_planner: BindingPlanner,
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
            bind_group_revision: None,
            identity_group: true,
            binding_planner: BindingPlanner::new(max_textures),
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

    /// Compatibility identity group. Draw submission selects a per-draw plan.
    pub fn create_bind_group(
        &mut self,
        device: &Device,
        layout: &BindGroupLayout,
        linear_sampler: &wgpu::Sampler,
        nearest_sampler: &wgpu::Sampler,
        colormap_texture: &TextureView,
        _colormap_sampler: &wgpu::Sampler,
    ) -> Result<(), RenderLoopError> {
        // Includes LUT/layout replacement; these resources are outside the store.
        self.invalidate_bind_groups();
        let group = self.build_bind_group(
            device,
            layout,
            linear_sampler,
            nearest_sampler,
            colormap_texture,
            None,
        );
        self.bind_group = Some(Arc::new(group));
        self.identity_group = true;
        self.bind_group_revision = Some(self.store.binding_token());
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn set_binding_capacity_for_test(&mut self, capacity: u32) {
        self.invalidate_bind_groups();
        self.binding_planner.set_capacity_for_test(capacity);
    }

    /// Unchanged storage rows and unchanged resource views keep the selected
    /// plan valid. No key allocation, sorting or GPU write is needed.
    pub(crate) fn reuse_current_draw_bindings(&mut self) -> bool {
        #[cfg(test)]
        if self.binding_planner.identity {
            return false;
        }
        if !self.identity_group && self.bind_group().is_some() {
            self.binding_planner.record_hit();
            true
        } else {
            false
        }
    }

    // Device/layout/samplers/LUT are a single renderer-owned binding context.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare_draw(
        &mut self,
        indices: &[u32],
        captured: &[Option<SlotHandle>],
        device: &Device,
        layout: &BindGroupLayout,
        linear_sampler: &wgpu::Sampler,
        nearest_sampler: &wgpu::Sampler,
        colormap_texture: &TextureView,
    ) -> Result<BindingPlan, RenderLoopError> {
        if captured
            .iter()
            .flatten()
            .any(|h| self.store.slot_handle(h.index()) != Some(*h))
        {
            self.invalidate_bind_groups();
            return Err(RenderLoopError::Internal {
                code: 6023,
                details:
                    "Draw references a released or replaced residency; upload fresh layer rows"
                        .into(),
            });
        }
        let plan = match self.binding_planner.plan(&self.store, indices) {
            Ok(plan) => plan,
            Err(error) => {
                self.invalidate_bind_groups();
                return Err(error);
            }
        };
        // Test oracle retains the old all-residents identity binding path. It
        // does not use the compact map to construct the reference bind group.
        #[cfg(test)]
        if self.binding_planner.identity {
            if !self.identity_group || self.bind_group().is_none() {
                self.create_bind_group(
                    device,
                    layout,
                    linear_sampler,
                    nearest_sampler,
                    colormap_texture,
                    nearest_sampler,
                )?;
            }
            return Ok(plan);
        }
        let group = if let Some(group) = self.binding_planner.lookup(&plan, &self.store) {
            group
        } else {
            let group = Arc::new(self.build_bind_group(
                device,
                layout,
                linear_sampler,
                nearest_sampler,
                colormap_texture,
                Some(&plan),
            ));
            self.binding_planner.insert(plan.clone(), group.clone());
            group
        };
        self.bind_group_revision = Some(self.store.binding_token());
        self.bind_group = Some(group);
        self.identity_group = false;
        Ok(plan)
    }

    fn build_bind_group(
        &mut self,
        device: &Device,
        layout: &BindGroupLayout,
        linear_sampler: &wgpu::Sampler,
        nearest_sampler: &wgpu::Sampler,
        colormap_texture: &TextureView,
        plan: Option<&BindingPlan>,
    ) -> TextureBindGroup {
        self.binding_planner.record_group_created();
        let capacity = self.store.max_textures();
        let bindings = crate::shader_contract::texture::bindings(capacity);
        let dummy = self.dummy_view.as_ref().expect("dummy volume initialized");
        let white_mask = self
            .default_mask_view
            .as_ref()
            .expect("default mask initialized");
        let resident_at = |position| match plan {
            None => Some(position),
            Some(plan) => plan
                .handles
                .iter()
                .find(|h| plan.position(h.index()) == Some(position))
                .map(|h| h.index()),
        };
        let mut entries = Vec::with_capacity((capacity * 2 + 3) as usize);
        for position in 0..capacity {
            let view = resident_at(position)
                .and_then(|i| self.store.texture_entry(i))
                .map(|e| &e.view)
                .unwrap_or(dummy);
            entries.push(wgpu::BindGroupEntry {
                binding: bindings.volume_base + position,
                resource: wgpu::BindingResource::TextureView(view),
            });
        }
        for position in 0..capacity {
            let view = resident_at(position)
                .and_then(|i| self.store.mask_entry(i))
                .map(|e| &e.view)
                .unwrap_or(white_mask);
            entries.push(wgpu::BindGroupEntry {
                binding: bindings.mask_base + position,
                resource: wgpu::BindingResource::TextureView(view),
            });
        }
        entries.extend([
            wgpu::BindGroupEntry {
                binding: bindings.sampler_linear,
                resource: wgpu::BindingResource::Sampler(linear_sampler),
            },
            wgpu::BindGroupEntry {
                binding: bindings.colormap_lut,
                resource: wgpu::BindingResource::TextureView(colormap_texture),
            },
            wgpu::BindGroupEntry {
                binding: bindings.sampler_nearest,
                resource: wgpu::BindingResource::Sampler(nearest_sampler),
            },
        ]);
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Per-draw Volume Bind Group"),
            layout,
            entries: &entries,
        })
    }

    fn invalidate_bind_groups(&mut self) {
        self.bind_group = None;
        self.binding_planner.clear();
    }

    pub(crate) fn record_frame_bindings(&mut self, groups_created: u32, cache_hit: bool) {
        self.binding_planner.record_frame(groups_created, cache_hit);
    }

    pub fn binding_cache_stats(&self) -> BindingCacheStats {
        self.binding_planner.stats()
    }

    pub fn upload_mask_texture(
        &mut self,
        device: &Device,
        queue: &Queue,
        index: u32,
        dimensions: [u32; 3],
        mask_data: &[u8],
    ) -> Result<(), RenderLoopError> {
        self.store
            .upload_mask_texture(device, queue, index, dimensions, mask_data)?;
        self.invalidate_bind_groups();
        Ok(())
    }

    pub fn clear_mask_texture(&mut self, index: u32) {
        self.store.clear_mask_texture(index);
        self.invalidate_bind_groups();
    }

    /// Get bind group for rendering
    pub fn bind_group(&self) -> Option<&TextureBindGroup> {
        if self.bind_group_revision == Some(self.store.binding_token()) {
            self.bind_group.as_deref()
        } else {
            None
        }
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
            self.invalidate_bind_groups();
        }
        Ok(world_to_voxel)
    }

    /// [`ResidentTextureStore::release_slot`]; a released slot invalidates the
    /// bind group.
    pub fn release_slot(&mut self, handle: SlotHandle) -> Result<bool, RenderLoopError> {
        let released = self.store.release_slot(handle)?;
        if released {
            self.invalidate_bind_groups();
        }
        Ok(released)
    }

    /// [`ResidentTextureStore::release_volume`], invalidating the bind group
    /// since texture bindings have changed.
    pub fn release_volume(&mut self, texture_index: u32) -> Result<(), RenderLoopError> {
        self.store.release_volume(texture_index)?;
        self.invalidate_bind_groups();
        Ok(())
    }

    /// Clear all textures
    pub fn clear(&mut self) {
        self.store.clear();
        self.invalidate_bind_groups();
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

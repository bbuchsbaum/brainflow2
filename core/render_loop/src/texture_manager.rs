// Texture manager for handling volume atlas and colormap textures

use colormap::{BuiltinColormap, BUILTIN_COLORMAPS};
use std::collections::HashMap;
use wgpu::{BindGroup, BindGroupLayout, Device, Queue, Sampler, Texture, TextureView};

/// Width (in texels) for each 1D colormap LUT row.
///
/// Notes:
/// - Builtin colormaps are 256 entries; we upsample by repetition.
/// - Atlas/label palettes often need >256 entries (e.g. Schaefer 400), so this must be larger.
// NOTE: Must not exceed the device's max 2D texture dimension.
// On some platforms / limit configurations this can be as low as 2048.
//
// If we need >2048 label entries in the future, we should switch to a tiled LUT
// layout (e.g. width 2048, height N) and update shaders to index into rows.
pub const COLORMAP_LUT_WIDTH: u32 = 2048; // 256 * 8

/// Number of custom (runtime) colormap slots in the LUT array.
pub const CUSTOM_COLORMAP_SLOTS: u32 = 64;

fn total_colormap_layers() -> u32 {
    BuiltinColormap::COUNT as u32 + CUSTOM_COLORMAP_SLOTS
}

/// Manages texture resources and bind groups
pub struct TextureManager {
    /// Linear sampler for volume atlas
    linear_sampler: Sampler,
    /// Nearest sampler for colormaps
    nearest_sampler: Sampler,
    /// Colormap texture array
    colormap_texture: Option<Texture>,
    /// Colormap texture view
    colormap_view: Option<TextureView>,
    /// Texture bind groups cache
    bind_groups: HashMap<u64, BindGroup>,
    /// Next bind group ID
    next_bind_group_id: u64,
}

impl TextureManager {
    /// Create a new texture manager
    pub fn new(device: &Device) -> Self {
        // Check if device supports float32-filterable
        let supports_float32_filterable = device
            .features()
            .contains(wgpu::Features::FLOAT32_FILTERABLE);

        // Create appropriate sampler based on feature support
        let filter_mode = if supports_float32_filterable {
            wgpu::FilterMode::Linear
        } else {
            println!("WARNING: Using nearest neighbor sampling for volume textures because FLOAT32_FILTERABLE is not supported");
            wgpu::FilterMode::Nearest
        };

        // Create linear sampler for volume data
        let linear_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Linear Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: filter_mode,
            min_filter: filter_mode,
            mipmap_filter: wgpu::FilterMode::Nearest,
            lod_min_clamp: 0.0,
            lod_max_clamp: 0.0,
            compare: None,
            anisotropy_clamp: 1,
            border_color: None,
        });

        // Create nearest sampler for colormaps
        let nearest_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Nearest Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            mipmap_filter: wgpu::FilterMode::Nearest,
            lod_min_clamp: 0.0,
            lod_max_clamp: 0.0,
            compare: None,
            anisotropy_clamp: 1,
            border_color: None,
        });

        Self {
            linear_sampler,
            nearest_sampler,
            colormap_texture: None,
            colormap_view: None,
            bind_groups: HashMap::new(),
            next_bind_group_id: 0,
        }
    }

    /// Initialize colormap texture array
    pub fn init_colormaps(&mut self, device: &Device, queue: &Queue) {
        // Create colormap texture array (COLORMAP_LUT_WIDTH x 1 x N for N colormaps)
        let num_colormaps = total_colormap_layers();
        let colormap_size = wgpu::Extent3d {
            width: COLORMAP_LUT_WIDTH,
            height: 1,
            depth_or_array_layers: num_colormaps,
        };

        let colormap_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Colormap Texture Array"),
            size: colormap_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm, // Use linear color space for colormaps
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        let colormap_view = colormap_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Colormap Array View"),
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });

        // Upload all builtin colormaps (upsampled to COLORMAP_LUT_WIDTH by repetition)
        let scale = COLORMAP_LUT_WIDTH / 256;
        if scale == 0 || COLORMAP_LUT_WIDTH % 256 != 0 {
            println!(
                "WARNING: COLORMAP_LUT_WIDTH={} is not a multiple of 256; builtin colormap upsampling may be uneven",
                COLORMAP_LUT_WIDTH
            );
        }

        for (i, colormap) in BUILTIN_COLORMAPS.iter().enumerate() {
            let mut data: Vec<u8> = Vec::with_capacity((COLORMAP_LUT_WIDTH * 4) as usize);

            for x in 0..COLORMAP_LUT_WIDTH {
                let src_idx = if scale > 0 {
                    (x / scale).min(255) as usize
                } else {
                    ((x as u64 * 255) / (COLORMAP_LUT_WIDTH.saturating_sub(1) as u64).max(1))
                        as usize
                };
                data.extend_from_slice(&colormap[src_idx]);
            }

            // Debug: Print first few values of each colormap
            if i < 3 {
                println!(
                    "Colormap {}: First pixel = {:?}, Middle pixel = {:?}",
                    i, &colormap[0], &colormap[128]
                );
            }

            queue.write_texture(
                wgpu::ImageCopyTexture {
                    texture: &colormap_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: 0,
                        y: 0,
                        z: i as u32,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                &data,
                wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(COLORMAP_LUT_WIDTH * 4),
                    rows_per_image: Some(1),
                },
                wgpu::Extent3d {
                    width: COLORMAP_LUT_WIDTH,
                    height: 1,
                    depth_or_array_layers: 1,
                },
            );
        }

        self.colormap_texture = Some(colormap_texture);
        self.colormap_view = Some(colormap_view);
    }

    /// Upload a colormap to a specific layer
    pub fn upload_colormap(
        &self,
        queue: &Queue,
        colormap_id: u32,
        data: &[u8],
    ) -> Result<(), &'static str> {
        if colormap_id >= total_colormap_layers() {
            return Err("Colormap ID exceeds maximum");
        }

        if data.len() != (COLORMAP_LUT_WIDTH as usize) * 4 {
            return Err("Colormap data must be COLORMAP_LUT_WIDTH RGBA values");
        }

        if let Some(texture) = &self.colormap_texture {
            queue.write_texture(
                wgpu::ImageCopyTexture {
                    texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: 0,
                        y: 0,
                        z: colormap_id,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                data,
                wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(COLORMAP_LUT_WIDTH * 4),
                    rows_per_image: Some(1),
                },
                wgpu::Extent3d {
                    width: COLORMAP_LUT_WIDTH,
                    height: 1,
                    depth_or_array_layers: 1,
                },
            );
            Ok(())
        } else {
            Err("Colormap texture not initialized")
        }
    }

    /// Create texture bind group
    pub fn create_bind_group(
        &mut self,
        device: &Device,
        layout: &BindGroupLayout,
        atlas_view: &TextureView,
    ) -> u64 {
        let colormap_view = self
            .colormap_view
            .as_ref()
            .expect("Colormap texture not initialized");

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Texture Bind Group"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(atlas_view),
                },
                wgpu::BindGroupEntry {
                    binding: 15,
                    resource: wgpu::BindingResource::Sampler(&self.linear_sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 16,
                    resource: wgpu::BindingResource::TextureView(colormap_view),
                },
                wgpu::BindGroupEntry {
                    binding: 17,
                    resource: wgpu::BindingResource::Sampler(&self.nearest_sampler),
                },
            ],
        });

        let id = self.next_bind_group_id;
        self.next_bind_group_id += 1;
        self.bind_groups.insert(id, bind_group);

        id
    }

    /// Get bind group by ID
    pub fn get_bind_group(&self, id: u64) -> Option<&BindGroup> {
        self.bind_groups.get(&id)
    }

    /// Get linear sampler
    pub fn linear_sampler(&self) -> &Sampler {
        &self.linear_sampler
    }

    /// Get colormap texture view
    pub fn colormap_view(&self) -> Option<&TextureView> {
        self.colormap_view.as_ref()
    }

    /// Get colormap sampler (nearest)
    pub fn colormap_sampler(&self) -> &Sampler {
        &self.nearest_sampler
    }

    /// Get nearest sampler
    pub fn nearest_sampler(&self) -> &Sampler {
        &self.nearest_sampler
    }
}

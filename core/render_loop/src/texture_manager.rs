// Texture manager for handling volume atlas and colormap textures

use wgpu::{Device, Queue, Sampler, BindGroup, BindGroupLayout, Texture, TextureView};
use std::collections::HashMap;
use colormap::{BUILTIN_COLORMAPS, BuiltinColormap};

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
        // Create linear sampler for volume data
        let linear_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Linear Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
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
        // Create colormap texture array (256x1xN for N colormaps)
        let num_colormaps = BuiltinColormap::COUNT as u32;
        let colormap_size = wgpu::Extent3d {
            width: 256,
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
        
        // Upload all builtin colormaps
        for (i, colormap) in BUILTIN_COLORMAPS.iter().enumerate() {
            // Flatten the colormap data into a contiguous buffer
            let data: Vec<u8> = colormap.iter()
                .flat_map(|pixel| pixel.iter().copied())
                .collect();
            
            // Debug: Print first few values of each colormap
            if i < 3 {
                println!("Colormap {}: First pixel = {:?}, Middle pixel = {:?}", 
                    i, 
                    &colormap[0],
                    &colormap[128]);
            }
            
            queue.write_texture(
                wgpu::ImageCopyTexture {
                    texture: &colormap_texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d { x: 0, y: 0, z: i as u32 },
                    aspect: wgpu::TextureAspect::All,
                },
                &data,
                wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(256 * 4),
                    rows_per_image: Some(1),
                },
                wgpu::Extent3d {
                    width: 256,
                    height: 1,
                    depth_or_array_layers: 1,
                },
            );
        }
        
        self.colormap_texture = Some(colormap_texture);
        self.colormap_view = Some(colormap_view);
    }
    
    /// Upload a colormap to a specific layer
    pub fn upload_colormap(&self, queue: &Queue, colormap_id: u32, data: &[u8]) -> Result<(), &'static str> {
        if colormap_id >= BuiltinColormap::COUNT as u32 {
            return Err("Colormap ID exceeds maximum");
        }
        
        if data.len() != 256 * 4 {
            return Err("Colormap data must be 256 RGBA values (1024 bytes)");
        }
        
        if let Some(texture) = &self.colormap_texture {
            queue.write_texture(
                wgpu::ImageCopyTexture {
                    texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d { x: 0, y: 0, z: colormap_id },
                    aspect: wgpu::TextureAspect::All,
                },
                data,
                wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(256 * 4),
                    rows_per_image: Some(1),
                },
                wgpu::Extent3d {
                    width: 256,
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
        let colormap_view = self.colormap_view.as_ref()
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
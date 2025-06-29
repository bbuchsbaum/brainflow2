# Optimized Colormap System Design

## Performance Requirements

1. **Zero-copy GPU operations** - Colormaps should stay on GPU once loaded
2. **Compile-time optimization** - Built-in colormaps should be const data
3. **No runtime allocation** - Avoid heap allocations in hot paths
4. **Cache-friendly** - Keep frequently used data together
5. **Minimal indirection** - Direct indexing where possible

## Optimized Architecture

### 1. Compile-Time Colormap Data

```rust
// core/colormap/src/data.rs

/// Colormap data as const arrays for zero-runtime cost
pub mod builtin {
    /// Grayscale colormap - generated at compile time
    pub const GRAYSCALE: [[u8; 4]; 256] = {
        let mut lut = [[0u8; 4]; 256];
        let mut i = 0;
        while i < 256 {
            lut[i] = [i as u8, i as u8, i as u8, 255];
            i += 1;
        }
        lut
    };
    
    /// Viridis colormap - embedded at compile time
    pub const VIRIDIS: [[u8; 4]; 256] = include!("../data/viridis.rs");
    
    /// Hot colormap
    pub const HOT: [[u8; 4]; 256] = include!("../data/hot.rs");
    
    /// Cool colormap  
    pub const COOL: [[u8; 4]; 256] = include!("../data/cool.rs");
    
    /// PET Hot Metal
    pub const PET_HOT_METAL: [[u8; 4]; 256] = include!("../data/pet_hot_metal.rs");
}

/// Fast colormap ID to data mapping
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuiltinColormap {
    Grayscale = 0,
    Viridis = 1,
    Hot = 2,
    Cool = 3,
    Plasma = 4,
    Inferno = 5,
    Magma = 6,
    Turbo = 7,
    PetHotMetal = 8,
    FmriRedBlue = 9,
    // ... up to 16 builtin colormaps
}

impl BuiltinColormap {
    /// Get colormap data - zero cost, returns reference to const data
    #[inline(always)]
    pub const fn data(&self) -> &'static [[u8; 4]; 256] {
        match self {
            Self::Grayscale => &builtin::GRAYSCALE,
            Self::Viridis => &builtin::VIRIDIS,
            Self::Hot => &builtin::HOT,
            Self::Cool => &builtin::COOL,
            Self::PetHotMetal => &builtin::PET_HOT_METAL,
            // ...
            _ => &builtin::GRAYSCALE, // fallback
        }
    }
    
    /// Get all builtin colormaps for GPU upload
    pub const fn all_data() -> &'static [[[u8; 4]; 256]; 16] {
        &[
            builtin::GRAYSCALE,
            builtin::VIRIDIS,
            builtin::HOT,
            builtin::COOL,
            builtin::PLASMA,
            builtin::INFERNO,
            builtin::MAGMA,
            builtin::TURBO,
            builtin::PET_HOT_METAL,
            builtin::FMRI_RED_BLUE,
            // ... pad with grayscale if < 16
            builtin::GRAYSCALE,
            builtin::GRAYSCALE,
            builtin::GRAYSCALE,
            builtin::GRAYSCALE,
            builtin::GRAYSCALE,
            builtin::GRAYSCALE,
        ]
    }
}
```

### 2. GPU-Optimized Upload

```rust
// core/render_loop/src/texture_manager.rs

impl TextureManager {
    /// Initialize all builtin colormaps at once - single GPU operation
    pub fn init_builtin_colormaps(&mut self, device: &Device, queue: &Queue) {
        // Create texture array for all colormaps
        let colormap_size = wgpu::Extent3d {
            width: 256,
            height: 1,
            depth_or_array_layers: 16,
        };
        
        let colormap_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Colormap Texture Array"),
            size: colormap_size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm, // Changed from sRGB for performance
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        
        // Upload all builtin colormaps in one operation
        let all_colormaps = BuiltinColormap::all_data();
        let data: &[u8] = bytemuck::cast_slice(all_colormaps);
        
        queue.write_texture(
            wgpu::ImageCopyTexture {
                texture: &colormap_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            data,
            wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(256 * 4),
                rows_per_image: Some(1),
            },
            colormap_size,
        );
        
        // Create view
        let colormap_view = colormap_texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Colormap Array View"),
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        
        self.colormap_texture = Some(colormap_texture);
        self.colormap_view = Some(colormap_view);
    }
}
```

### 3. Lightweight Metadata System

```rust
// core/colormap/src/metadata.rs

/// Minimal metadata for runtime - keep it small
#[derive(Debug, Clone, Copy)]
pub struct ColormapInfo {
    pub id: BuiltinColormap,
    pub category: ColormapCategory,
    pub flags: ColormapFlags,
}

#[derive(Debug, Clone, Copy)]
#[repr(u8)]
pub enum ColormapCategory {
    Sequential = 0,
    Diverging = 1,
    Qualitative = 2,
    Clinical = 3,
}

/// Bit flags for colormap properties
#[derive(Debug, Clone, Copy)]
pub struct ColormapFlags(u8);

impl ColormapFlags {
    pub const PERCEPTUALLY_UNIFORM: u8 = 0b00000001;
    pub const COLORBLIND_SAFE: u8 = 0b00000010;
    pub const CLINICAL_APPROVED: u8 = 0b00000100;
    
    pub const fn new(flags: u8) -> Self {
        Self(flags)
    }
    
    pub const fn is_perceptually_uniform(&self) -> bool {
        self.0 & Self::PERCEPTUALLY_UNIFORM != 0
    }
    
    pub const fn is_colorblind_safe(&self) -> bool {
        self.0 & Self::COLORBLIND_SAFE != 0
    }
}

/// Static metadata table - compile time constant
pub const COLORMAP_INFO: [ColormapInfo; 10] = [
    ColormapInfo {
        id: BuiltinColormap::Grayscale,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(
            ColormapFlags::PERCEPTUALLY_UNIFORM | 
            ColormapFlags::COLORBLIND_SAFE
        ),
    },
    ColormapInfo {
        id: BuiltinColormap::Viridis,
        category: ColormapCategory::Sequential,
        flags: ColormapFlags::new(
            ColormapFlags::PERCEPTUALLY_UNIFORM | 
            ColormapFlags::COLORBLIND_SAFE
        ),
    },
    // ... etc
];
```

### 4. Fast String-to-ID Mapping

```rust
// core/colormap/src/lib.rs

use phf::phf_map;

/// Compile-time string to colormap ID mapping
static COLORMAP_NAMES: phf::Map<&'static str, BuiltinColormap> = phf_map! {
    "grayscale" => BuiltinColormap::Grayscale,
    "grey" => BuiltinColormap::Grayscale, // alias
    "gray" => BuiltinColormap::Grayscale, // alias
    "viridis" => BuiltinColormap::Viridis,
    "hot" => BuiltinColormap::Hot,
    "cool" => BuiltinColormap::Cool,
    "plasma" => BuiltinColormap::Plasma,
    "inferno" => BuiltinColormap::Inferno,
    "magma" => BuiltinColormap::Magma,
    "turbo" => BuiltinColormap::Turbo,
    "pet" => BuiltinColormap::PetHotMetal,
    "pet_hot_metal" => BuiltinColormap::PetHotMetal,
    "fmri" => BuiltinColormap::FmriRedBlue,
    "activation" => BuiltinColormap::FmriRedBlue,
};

/// Fast lookup by name - O(1) at runtime
#[inline]
pub fn colormap_by_name(name: &str) -> Option<BuiltinColormap> {
    COLORMAP_NAMES.get(name).copied()
}
```

### 5. Custom Colormap Support (Performance-Conscious)

```rust
// core/colormap/src/custom.rs

/// Custom colormaps stored in a fixed-size arena
pub struct CustomColormapArena {
    /// Fixed storage for custom colormaps
    storage: Box<[[[u8; 4]; 256]; 16]>, // 16 custom slots
    /// Which slots are occupied
    occupied: u16, // bit mask
    /// Name to slot mapping
    names: HashMap<String, u8>,
}

impl CustomColormapArena {
    pub fn new() -> Self {
        Self {
            storage: Box::new([[[0; 4]; 256]; 16]),
            occupied: 0,
            names: HashMap::new(),
        }
    }
    
    /// Add custom colormap - returns slot index
    pub fn add(&mut self, name: String, data: [[u8; 4]; 256]) -> Result<u8, &'static str> {
        // Find free slot
        let slot = self.occupied.trailing_ones();
        if slot >= 16 {
            return Err("No free custom colormap slots");
        }
        
        // Copy data
        self.storage[slot as usize] = data;
        self.occupied |= 1 << slot;
        self.names.insert(name, slot as u8);
        
        Ok(slot as u8 + 16) // Offset by 16 for GPU indexing
    }
    
    /// Get custom colormap data
    #[inline]
    pub fn get(&self, slot: u8) -> Option<&[[u8; 4]; 256]> {
        if slot < 16 && (self.occupied & (1 << slot)) != 0 {
            Some(&self.storage[slot as usize])
        } else {
            None
        }
    }
}
```

### 6. Optimized API Layer

```rust
// core/api_bridge/src/lib.rs

#[command]
async fn patch_layer(
    layer_id: String,
    patch: LayerPatch,
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    if let Some(colormap_name) = patch.colormap {
        // Fast lookup - no allocation
        let colormap_id = if let Some(builtin) = colormap_by_name(&colormap_name) {
            builtin as u32
        } else {
            // Check custom colormaps
            let custom_arena = state.custom_colormaps.lock().await;
            custom_arena.names.get(&colormap_name)
                .map(|&slot| slot as u32)
                .unwrap_or(0) // fallback to grayscale
        };
        
        // Update layer with colormap ID - no GPU upload needed!
        // Colormaps are already on GPU
        update_layer_colormap(layer_id, colormap_id)?;
    }
    
    Ok(())
}

/// List available colormaps - returns static data
#[command]
async fn list_builtin_colormaps() -> BridgeResult<&'static [ColormapInfo]> {
    Ok(&COLORMAP_INFO)
}
```

### 7. Shader Optimizations

```wgsl
// slice.wgsl

struct LayerUBO {
    // ... other fields ...
    colormap_id: u32,  // Direct index into texture array
    // ... other fields ...
}

@group(2) @binding(2) var colormapArray: texture_2d_array<f32>;
@group(2) @binding(3) var colormapSampler: sampler;

fn apply_colormap(value: f32, colormap_id: u32) -> vec3<f32> {
    // Single texture lookup - no branching
    let uv = vec2<f32>(value, 0.5);
    return textureSample(colormapArray, colormapSampler, uv, i32(colormap_id)).rgb;
}
```

## Performance Benefits

1. **Zero runtime allocation** - All builtin colormaps are const data
2. **Single GPU upload** - All colormaps loaded in one operation at startup
3. **O(1) lookup** - Perfect hash for name-to-ID mapping
4. **No indirection** - Direct array indexing in shaders
5. **Cache friendly** - Colormap data is contiguous in memory
6. **Minimal metadata** - Only essential data kept in memory

## Memory Usage

- **Builtin colormaps**: 16 × 256 × 4 = 16KB (compile-time const)
- **Custom colormaps**: 16 × 256 × 4 = 16KB (runtime allocated)
- **GPU texture**: 32 × 256 × 4 = 32KB total
- **Metadata**: ~200 bytes for all colormap info

Total runtime overhead: ~48KB + minimal metadata

## Implementation Priority

1. **Phase 1**: Implement builtin colormaps with const data
2. **Phase 2**: Add GPU upload and shader support
3. **Phase 3**: Add custom colormap arena
4. **Phase 4**: UI components with preview generation

This approach gives us the flexibility of a registry system with the performance of hardcoded colormaps!
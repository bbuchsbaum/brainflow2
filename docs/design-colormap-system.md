# Colormap System Design

## Current State Analysis

The current colormap system has several limitations:
1. **Hardcoded mappings** - String names are mapped to integer IDs in api_bridge
2. **Fixed colormap set** - Only grayscale is implemented, others are placeholders
3. **No extensibility** - Adding new colormaps requires code changes in multiple places
4. **No metadata** - No way to describe colormap properties (perceptual uniformity, diverging vs sequential, etc.)
5. **Limited texture slots** - Only 16 colormaps can be loaded at once

## Proposed Architecture

### 1. Colormap Registry Pattern

```rust
// core/colormap/src/lib.rs

/// Metadata about a colormap
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColormapMetadata {
    /// Unique identifier (e.g., "viridis", "grayscale")
    pub id: String,
    /// Display name (e.g., "Viridis", "Grayscale")
    pub name: String,
    /// Category (e.g., "sequential", "diverging", "qualitative", "clinical")
    pub category: ColormapCategory,
    /// Whether the colormap is perceptually uniform
    pub perceptually_uniform: bool,
    /// Whether the colormap is colorblind-safe
    pub colorblind_safe: bool,
    /// Preview gradient (for UI display)
    pub preview: Vec<[u8; 4]>, // Small RGBA array for preview
    /// Source attribution (e.g., "matplotlib", "custom")
    pub source: String,
    /// Tags for search/filtering
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ColormapCategory {
    Sequential,     // For ordered data (low to high)
    Diverging,      // For data with meaningful midpoint
    Qualitative,    // For categorical data
    Clinical,       // Medical imaging specific (e.g., PET, fMRI)
    Custom,         // User-defined
}

/// A colormap definition
pub trait Colormap: Send + Sync {
    /// Get metadata for this colormap
    fn metadata(&self) -> &ColormapMetadata;
    
    /// Generate RGBA values for the colormap
    /// Returns 256 RGBA values (1024 bytes)
    fn generate_lut(&self) -> Vec<[u8; 4]>;
    
    /// Map a normalized value [0, 1] to RGBA
    fn map_scalar(&self, value: f32) -> [u8; 4];
}

/// Registry for managing colormaps
pub struct ColormapRegistry {
    colormaps: HashMap<String, Box<dyn Colormap>>,
    gpu_slots: Vec<Option<String>>, // Which colormap is in each GPU slot
}

impl ColormapRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            colormaps: HashMap::new(),
            gpu_slots: vec![None; 16], // 16 GPU texture slots
        };
        
        // Register built-in colormaps
        registry.register_builtin_colormaps();
        registry
    }
    
    /// Register a new colormap
    pub fn register(&mut self, colormap: Box<dyn Colormap>) -> Result<(), RegistryError> {
        let id = colormap.metadata().id.clone();
        if self.colormaps.contains_key(&id) {
            return Err(RegistryError::DuplicateId(id));
        }
        self.colormaps.insert(id, colormap);
        Ok(())
    }
    
    /// Load colormap from file (JSON, XML, etc.)
    pub fn load_from_file(&mut self, path: &Path) -> Result<(), RegistryError> {
        // Implementation for loading custom colormaps
        todo!()
    }
    
    /// Get colormap by ID
    pub fn get(&self, id: &str) -> Option<&dyn Colormap> {
        self.colormaps.get(id).map(|b| b.as_ref())
    }
    
    /// List all available colormaps
    pub fn list(&self) -> Vec<&ColormapMetadata> {
        self.colormaps.values()
            .map(|cm| cm.metadata())
            .collect()
    }
    
    /// Allocate GPU slot for a colormap
    pub fn allocate_gpu_slot(&mut self, colormap_id: &str) -> Result<u32, RegistryError> {
        // Find existing slot or allocate new one
        if let Some(slot) = self.find_gpu_slot(colormap_id) {
            return Ok(slot as u32);
        }
        
        // Find free slot or evict LRU
        if let Some(free_slot) = self.gpu_slots.iter().position(|s| s.is_none()) {
            self.gpu_slots[free_slot] = Some(colormap_id.to_string());
            Ok(free_slot as u32)
        } else {
            // TODO: Implement LRU eviction
            Err(RegistryError::NoFreeSlots)
        }
    }
}
```

### 2. Built-in Colormap Implementations

```rust
// core/colormap/src/builtin/mod.rs

mod grayscale;
mod viridis;
mod hot;
mod cool;
mod clinical;

use crate::{Colormap, ColormapMetadata, ColormapCategory};

/// Grayscale colormap
pub struct Grayscale {
    metadata: ColormapMetadata,
}

impl Grayscale {
    pub fn new() -> Self {
        Self {
            metadata: ColormapMetadata {
                id: "grayscale".to_string(),
                name: "Grayscale".to_string(),
                category: ColormapCategory::Sequential,
                perceptually_uniform: true,
                colorblind_safe: true,
                preview: vec![[0, 0, 0, 255], [128, 128, 128, 255], [255, 255, 255, 255]],
                source: "builtin".to_string(),
                tags: vec!["monochrome", "default"].into_iter().map(String::from).collect(),
            }
        }
    }
}

impl Colormap for Grayscale {
    fn metadata(&self) -> &ColormapMetadata {
        &self.metadata
    }
    
    fn generate_lut(&self) -> Vec<[u8; 4]> {
        (0..=255).map(|i| [i, i, i, 255]).collect()
    }
    
    fn map_scalar(&self, value: f32) -> [u8; 4] {
        let v = (value.clamp(0.0, 1.0) * 255.0) as u8;
        [v, v, v, 255]
    }
}

/// Viridis colormap (perceptually uniform)
pub struct Viridis {
    metadata: ColormapMetadata,
    // Store the actual colormap data
    lut: Vec<[u8; 4]>,
}

impl Viridis {
    pub fn new() -> Self {
        // Viridis colormap data (simplified - would load from data file)
        let lut = vec![
            [68, 1, 84, 255],    // Dark purple
            [72, 40, 120, 255],  // ...
            [62, 73, 137, 255],
            // ... 256 values total
            [253, 231, 37, 255], // Yellow
        ];
        
        Self {
            metadata: ColormapMetadata {
                id: "viridis".to_string(),
                name: "Viridis".to_string(),
                category: ColormapCategory::Sequential,
                perceptually_uniform: true,
                colorblind_safe: true,
                preview: vec![lut[0], lut[128], lut[255]],
                source: "matplotlib".to_string(),
                tags: vec!["perceptual", "scientific"].into_iter().map(String::from).collect(),
            },
            lut,
        }
    }
}
```

### 3. Clinical/Medical Colormaps

```rust
// core/colormap/src/builtin/clinical.rs

/// PET-specific colormap (hot metal variant)
pub struct PetHotMetal {
    metadata: ColormapMetadata,
    lut: Vec<[u8; 4]>,
}

impl PetHotMetal {
    pub fn new() -> Self {
        // Generate hot metal colormap
        let mut lut = Vec::with_capacity(256);
        
        // Black -> Red -> Yellow -> White
        for i in 0..256 {
            let t = i as f32 / 255.0;
            let (r, g, b) = if t < 0.33 {
                // Black to red
                let s = t * 3.0;
                ((s * 255.0) as u8, 0, 0)
            } else if t < 0.66 {
                // Red to yellow
                let s = (t - 0.33) * 3.0;
                (255, (s * 255.0) as u8, 0)
            } else {
                // Yellow to white
                let s = (t - 0.66) * 3.0;
                (255, 255, (s * 255.0) as u8)
            };
            lut.push([r, g, b, 255]);
        }
        
        Self {
            metadata: ColormapMetadata {
                id: "pet_hot_metal".to_string(),
                name: "PET Hot Metal".to_string(),
                category: ColormapCategory::Clinical,
                perceptually_uniform: false,
                colorblind_safe: false,
                preview: vec![lut[0], lut[128], lut[255]],
                source: "clinical".to_string(),
                tags: vec!["pet", "nuclear", "hot"].into_iter().map(String::from).collect(),
            },
            lut,
        }
    }
}

/// fMRI activation colormap (red-yellow for positive, blue-cyan for negative)
pub struct FmriActivation {
    metadata: ColormapMetadata,
    lut: Vec<[u8; 4]>,
}
```

### 4. Custom Colormap Support

```rust
// core/colormap/src/custom.rs

/// Custom colormap loaded from file
pub struct CustomColormap {
    metadata: ColormapMetadata,
    lut: Vec<[u8; 4]>,
}

impl CustomColormap {
    /// Load from JSON file
    pub fn from_json(path: &Path) -> Result<Self, CustomColormapError> {
        let file = std::fs::File::open(path)?;
        let data: CustomColormapData = serde_json::from_reader(file)?;
        
        // Validate and convert
        let lut = data.colors.into_iter()
            .map(|c| [c.r, c.g, c.b, c.a.unwrap_or(255)])
            .collect();
            
        Ok(Self {
            metadata: data.metadata,
            lut,
        })
    }
    
    /// Load from CSV (R,G,B,A columns)
    pub fn from_csv(path: &Path, metadata: ColormapMetadata) -> Result<Self, CustomColormapError> {
        // Implementation
        todo!()
    }
    
    /// Load from image file (single row)
    pub fn from_image(path: &Path, metadata: ColormapMetadata) -> Result<Self, CustomColormapError> {
        // Use image crate to load colormap from PNG/JPEG
        todo!()
    }
}

#[derive(Serialize, Deserialize)]
struct CustomColormapData {
    metadata: ColormapMetadata,
    colors: Vec<ColorEntry>,
}

#[derive(Serialize, Deserialize)]
struct ColorEntry {
    r: u8,
    g: u8,
    b: u8,
    a: Option<u8>,
}
```

### 5. Integration with Render System

```rust
// core/render_loop/src/lib.rs

impl RenderLoopService {
    /// Update colormap registry
    pub fn set_colormap_registry(&mut self, registry: Arc<Mutex<ColormapRegistry>>) {
        self.colormap_registry = Some(registry);
    }
    
    /// Ensure colormap is loaded to GPU
    pub fn ensure_colormap_loaded(&mut self, colormap_id: &str) -> Result<u32, RenderLoopError> {
        let registry = self.colormap_registry.as_ref()
            .ok_or(RenderLoopError::NoColormapRegistry)?;
            
        let mut registry = registry.lock().unwrap();
        
        // Get GPU slot (may already be allocated)
        let slot = registry.allocate_gpu_slot(colormap_id)?;
        
        // Check if we need to upload
        if !self.colormap_loaded_slots.contains(&slot) {
            // Get colormap and generate LUT
            let colormap = registry.get(colormap_id)
                .ok_or(RenderLoopError::ColormapNotFound)?;
            let lut = colormap.generate_lut();
            
            // Upload to GPU
            self.texture_manager.upload_colormap(
                &self.queue,
                slot,
                bytemuck::cast_slice(&lut)
            )?;
            
            self.colormap_loaded_slots.insert(slot);
        }
        
        Ok(slot)
    }
}
```

### 6. API Layer Updates

```rust
// core/api_bridge/src/lib.rs

#[command]
async fn patch_layer(
    layer_id: String,
    patch: LayerPatch,
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    // ... existing code ...
    
    if let Some(colormap) = patch.colormap {
        // Ensure colormap is loaded and get GPU slot
        let colormap_slot = service.ensure_colormap_loaded(&colormap)
            .map_err(|e| BridgeError::Internal { 
                code: 5020, 
                details: format!("Failed to load colormap: {}", e) 
            })?;
            
        // Update layer with GPU slot
        // ... update layer uniforms ...
    }
}

#[command]
async fn list_colormaps(state: State<'_, BridgeState>) -> BridgeResult<Vec<ColormapMetadata>> {
    let registry = state.colormap_registry.lock().await;
    Ok(registry.list().into_iter().cloned().collect())
}

#[command]
async fn load_custom_colormap(
    path: String,
    state: State<'_, BridgeState>
) -> BridgeResult<ColormapMetadata> {
    let mut registry = state.colormap_registry.lock().await;
    registry.load_from_file(Path::new(&path))?;
    // Return metadata of loaded colormap
    todo!()
}
```

### 7. Frontend Integration

```typescript
// packages/api/src/colormap.ts

export interface ColormapMetadata {
  id: string;
  name: string;
  category: 'sequential' | 'diverging' | 'qualitative' | 'clinical' | 'custom';
  perceptuallyUniform: boolean;
  colorblindSafe: boolean;
  preview: number[][]; // RGB(A) values for preview
  source: string;
  tags: string[];
}

export class ColormapManager {
  private colormaps: Map<string, ColormapMetadata> = new Map();
  
  async loadAvailableColormaps(): Promise<void> {
    const list = await coreApi.list_colormaps();
    list.forEach(cm => this.colormaps.set(cm.id, cm));
  }
  
  getByCategory(category: string): ColormapMetadata[] {
    return Array.from(this.colormaps.values())
      .filter(cm => cm.category === category);
  }
  
  search(query: string): ColormapMetadata[] {
    const lower = query.toLowerCase();
    return Array.from(this.colormaps.values())
      .filter(cm => 
        cm.name.toLowerCase().includes(lower) ||
        cm.tags.some(tag => tag.toLowerCase().includes(lower))
      );
  }
  
  async loadCustom(file: File): Promise<ColormapMetadata> {
    // Handle file upload and call API
    const path = await uploadFile(file);
    return await coreApi.load_custom_colormap(path);
  }
}
```

### 8. UI Components

```svelte
<!-- ColormapPicker.svelte -->
<script lang="ts">
  import { ColormapManager } from '@brainflow/api/colormap';
  import type { ColormapMetadata } from '@brainflow/api/colormap';
  
  export let value: string;
  export let onChange: (id: string) => void;
  
  const manager = new ColormapManager();
  let colormaps = $state<ColormapMetadata[]>([]);
  let searchQuery = $state('');
  let selectedCategory = $state<string | null>(null);
  
  $effect(async () => {
    await manager.loadAvailableColormaps();
    colormaps = manager.getByCategory('all');
  });
  
  function handleSearch() {
    if (searchQuery) {
      colormaps = manager.search(searchQuery);
    } else if (selectedCategory) {
      colormaps = manager.getByCategory(selectedCategory);
    }
  }
  
  function renderPreview(colormap: ColormapMetadata) {
    const gradient = colormap.preview
      .map((c, i) => `rgb(${c[0]},${c[1]},${c[2]}) ${i * 50}%`)
      .join(', ');
    return `linear-gradient(to right, ${gradient})`;
  }
</script>

<div class="colormap-picker">
  <input
    type="search"
    bind:value={searchQuery}
    oninput={handleSearch}
    placeholder="Search colormaps..."
  />
  
  <div class="categories">
    <button onclick={() => selectedCategory = 'sequential'}>Sequential</button>
    <button onclick={() => selectedCategory = 'diverging'}>Diverging</button>
    <button onclick={() => selectedCategory = 'clinical'}>Clinical</button>
    <button onclick={() => selectedCategory = 'custom'}>Custom</button>
  </div>
  
  <div class="colormap-grid">
    {#each colormaps as cm}
      <div
        class="colormap-item"
        class:selected={value === cm.id}
        onclick={() => onChange(cm.id)}
      >
        <div 
          class="preview"
          style="background: {renderPreview(cm)}"
        />
        <span class="name">{cm.name}</span>
        {#if cm.perceptuallyUniform}
          <span class="badge">Perceptual</span>
        {/if}
        {#if cm.colorblindSafe}
          <span class="badge">Colorblind Safe</span>
        {/if}
      </div>
    {/each}
  </div>
  
  <button class="load-custom" onclick={loadCustomColormap}>
    Load Custom Colormap...
  </button>
</div>
```

## Benefits of This Architecture

1. **Extensibility** - Easy to add new colormaps without changing core code
2. **Runtime Loading** - Load colormaps from files at runtime
3. **Metadata Rich** - Colormaps carry useful metadata for UI/UX
4. **GPU Efficient** - LRU caching of colormaps in GPU texture slots
5. **Type Safe** - Strong typing throughout the stack
6. **Searchable** - Tags and categories make colormaps discoverable
7. **Clinical Focus** - Built-in support for medical imaging colormaps
8. **User Friendly** - Visual previews and metadata help users choose

## Implementation Plan

1. Create `core/colormap` crate with registry and trait definitions
2. Implement built-in colormaps (grayscale, viridis, hot, cool)
3. Add clinical colormaps (PET, fMRI, perfusion)
4. Update render_loop to use colormap registry
5. Add API commands for colormap management
6. Create frontend ColorPicker component
7. Add custom colormap loading support
8. Write tests and documentation

## Future Extensions

- Colormap editor UI
- Colormap interpolation for continuous scales
- Multi-dimensional colormaps (e.g., magnitude + phase)
- Colormap presets for specific imaging modalities
- Export/share custom colormaps
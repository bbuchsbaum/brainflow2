# 4D Volume Support Flow Analysis Report

## Executive Summary

This report maps the execution paths and file interconnections for adding 4D volume support to brainflow2. The analysis reveals that **neuroim-rs already provides comprehensive 4D support**, but brainflow2's current architecture is designed around 3D volumes only. The implementation requires strategic modifications across three main layers: the data loading pipeline, the volume storage architecture, and the UI integration points.

## Current 3D Volume Loading Flow

### 1. Entry Points and Data Flow

The volume loading pipeline follows this execution path:

```
Frontend Request → API Bridge → NIfTI Loader → neuroim-rs → Volume Registry → GPU Rendering
```

**Detailed Flow:**

1. **Frontend Initiation** (`ui2/src/services/FileLoadingService.ts`)
   - User double-clicks file in browser
   - `FileLoadingService.loadFile(path)` called
   - Validates file extensions (.nii, .nii.gz, .gii)
   - Calls `ApiService.loadFile(path)`

2. **API Transport** (`ui2/src/services/apiService.ts` + `transport.ts`)
   - `ApiService.loadFile()` invokes Tauri command
   - Transport maps to namespaced command: `plugin:api-bridge|load_file`
   - Arguments sent as `{ path: string }`

3. **Tauri API Bridge** (`core/api_bridge/src/lib.rs`)
   - `load_file()` command receives path parameter
   - Calls `core_loaders::load_any_volume(path)`
   - Creates unique volume ID using `uuid::Uuid::new_v4()`
   - Stores `VolumeSendable` in `Arc<Mutex<HashMap<String, VolumeSendable>>>`

4. **NIfTI Loader** (`core/loaders/nifti/src/lib.rs`)
   - **CRITICAL RESTRICTION**: `if dims.len() != 3` → `DimensionMismatch` error
   - Uses `neuroim::read_vol_as(path, 0)` for 3D loading
   - Creates `DenseVolume3<T>` from neuroim data
   - Extracts affine transform from `NeuroSpace.trans`
   - Returns `VolumeSendable` enum variant

5. **Volume Storage** (`core/bridge_types/src/lib.rs`)
   - `VolumeSendable` enum with 8 numeric type variants (f32, i16, u8, etc.)
   - Each variant: `Vol[TYPE](DenseVolume3<T>, Affine3<f32>)`
   - Stored in registry with handle info containing `dims: [usize; 3]`

6. **GPU Integration** (`core/render_loop/src/lib.rs`)
   - Volume uploaded to GPU textures via `TextureManager`
   - Slice extraction for 2D orthogonal views
   - 3D surface rendering via WebGL/Three.js integration

### 2. Key Data Structures

**Current Volume Types (3D Only):**
```rust
// core/bridge_types/src/lib.rs
pub enum VolumeSendable {
    VolF32(DenseVolume3<f32>, Affine3<f32>),
    VolI16(DenseVolume3<i16>, Affine3<f32>),
    // ... 6 more numeric variants
}

pub struct VolumeHandleInfo {
    pub id: String,
    pub name: String,
    pub dims: [usize; 3],  // Fixed 3D dimensions
    pub dtype: String,
}
```

**Volume Registry:**
```rust
// core/api_bridge/src/lib.rs (line 286)
pub volume_registry: Arc<Mutex<HashMap<String, VolumeSendable>>>
```

## 4D Capabilities in neuroim-rs

### 1. Comprehensive 4D Infrastructure

**Available 4D Data Structures:**
```rust
// From /Users/bbuchsbaum/code/rust/neuroim-rs/src/neuro_vec.rs
pub struct DenseNeuroVec<T: Numeric + Sum> {
    pub data: Array4<T>,     // 4D array [x, y, z, time]
    pub space: NeuroSpace,   // 4D spatial metadata
    pub label: String,
}

pub struct SparseNeuroVec<T> {
    pub data: Array2<T>,        // [time x masked_voxels]
    pub space: NeuroSpace,      // 4D spatial metadata  
    pub mask: LogicalNeuroVol,  // 3D mask defining ROI
    pub indices: Vec<usize>,    // Linear indices of masked voxels
}
```

**4D I/O Functions:**
```rust
// From /Users/bbuchsbaum/code/rust/neuroim-rs/src/io.rs
pub fn read_vec(filename: impl AsRef<Path>) -> Result<DenseNeuroVec<f64>>
pub fn read_vec_f32(filename: impl AsRef<Path>) -> Result<DenseNeuroVec<f32>>
pub fn read_vec_as<T>(filename: impl AsRef<Path>) -> Result<DenseNeuroVec<T>>
```

**4D Operations Available:**
- `volume(t: usize)` - Extract 3D volume at time t
- `series(x, y, z)` - Extract time series for voxel
- `series_multi(coords)` - Extract multiple time series
- `sub_vector(indices)` - Extract time subset
- `scale_series(center, scale)` - Normalize time series

### 2. 4D Validation in neuroim-rs

The `read_vec_as<T>()` function includes proper 4D validation:
```rust
// Line 161-164 in io.rs
if ndim != 4 {
    return Err(Error::InvalidDimensions(
        format!("Expected 4D data for NeuroVec, got {}D", ndim)
    ));
}
```

## Integration Points for 4D Support

### 1. NIfTI Loader Modifications

**Current Blocking Code:**
```rust
// core/loaders/nifti/src/lib.rs, lines 45-47
if dims.len() != 3 {
    return Err(NiftiError::DimensionMismatch(dims.len()));
}
```

**Required Changes:**
```rust
// Replace with dimension-aware loading
match dims.len() {
    3 => load_as_3d_volume(path),
    4 => load_as_4d_timeseries(path),
    _ => Err(NiftiError::DimensionMismatch(dims.len()))
}
```

### 2. Volume Type Extensions

**Extended VolumeSendable:**
```rust
pub enum VolumeSendable {
    // Existing 3D variants
    VolF32(DenseVolume3<f32>, Affine3<f32>),
    // ... other 3D types
    
    // New 4D variants
    Vec4DF32(DenseNeuroVec<f32>),
    Vec4DI16(DenseNeuroVec<i16>),
    // ... other 4D types
}
```

**Enhanced Volume Handle Info:**
```rust
pub struct VolumeHandleInfo {
    pub id: String,
    pub name: String,
    pub dims: Vec<usize>,      // Support both 3D [x,y,z] and 4D [x,y,z,t]
    pub dtype: String,
    pub volume_type: VolumeType,
    pub num_timepoints: Option<usize>,
}

pub enum VolumeType {
    Volume3D,
    TimeSeries4D,
}
```

### 3. API Bridge Extensions

**New 4D Commands Required:**
```rust
#[command]
async fn get_volume_at_timepoint(
    volume_id: String, 
    timepoint: usize
) -> BridgeResult<VolumeHandleInfo>

#[command]  
async fn get_timeseries_matrix(
    volume_id: String,
    coords: Vec<[f32; 3]>
) -> BridgeResult<TimeSeriesResult>

#[command]
async fn get_volume_info(
    volume_id: String
) -> BridgeResult<VolumeInfo>
```

**Transport Integration:**
```typescript
// ui2/src/services/transport.ts - Add to apiBridgeCommands array
'get_volume_at_timepoint',
'get_timeseries_matrix', 
'get_volume_info'
```

### 4. Volume Registry Modifications

**Dual Storage Architecture:**
```rust
pub struct BridgeState {
    pub volume_registry: Arc<Mutex<VolumeRegistry>>,
    // ... other fields
}

pub struct VolumeRegistry {
    volumes_3d: HashMap<String, VolumeSendable>,     // 3D volumes
    volumes_4d: HashMap<String, DenseNeuroVec<f32>>, // 4D time series
    volume_metadata: HashMap<String, VolumeMetadata>, // Combined metadata
}
```

### 5. GPU Rendering Integration

**Temporal Navigation:**
- Extract current timepoint as 3D volume: `vec.volume(current_timepoint)`
- Cache recently accessed timepoints in GPU memory
- Handle temporal navigation through existing 3D rendering pipeline

**No GPU Pipeline Changes Required:**
- 4D volumes render current timepoint as 3D
- Existing WebGPU slicing and texture management unchanged
- Time dimension handled at volume extraction level

## File Interconnection Map

### Core Dependencies

```
core/api_bridge/src/lib.rs
├── Imports: bridge_types::VolumeSendable
├── Imports: brainflow_loaders::load_any_volume
├── Uses: VolumeRegistry for storage
├── Exports: load_file command
└── Dependencies: [Volume Types] → [Loaders] → [neuroim-rs]

core/bridge_types/src/lib.rs  
├── Defines: VolumeSendable enum (3D only)
├── Defines: VolumeHandleInfo struct
├── Used by: api_bridge, loaders, render_loop
└── Dependencies: [volmath] → [neuroim-rs]

core/loaders/nifti/src/lib.rs
├── Imports: bridge_types::VolumeSendable
├── Imports: neuroim::{read_vol_as, DenseNeuroVol}
├── Blocks: 4D files with dimension check
├── Exports: load_nifti_volume_neuroim
└── Dependencies: [neuroim-rs I/O]

core/volmath/src/lib.rs
├── Re-exports: neuroim::*
├── Provides: DenseVolume3<T> type alias
├── Provides: NeuroSpace3 compatibility
└── Dependencies: [neuroim-rs core types]
```

### UI Integration Points

```
ui2/src/services/FileLoadingService.ts
├── Entry point: file double-click events
├── Calls: ApiService.loadFile(path)
├── Handles: volume loading coordination
└── Dependencies: [ApiService] → [EventBus] → [LayerService]

ui2/src/services/apiService.ts
├── Invokes: load_file Tauri command
├── Returns: VolumeHandle interface
├── Coordinates: layer creation and rendering
└── Dependencies: [transport.ts] → [Tauri Bridge]

ui2/src/services/transport.ts
├── Maps: commands to plugin namespace
├── Handles: plugin:api-bridge|load_file
├── Lists: all available API bridge commands
└── Dependencies: [Tauri Core API]
```

### Render Pipeline Flow

```
core/render_loop/src/lib.rs
├── Accepts: VolumeSendable for GPU upload
├── Creates: 3D textures from volume data
├── Handles: slice extraction and rendering
├── Uses: TextureManager for GPU resources
└── Dependencies: [wgpu] → [WebGPU] → [GPU hardware]

core/render_loop/src/texture_manager.rs
├── Uploads: volume data to GPU textures
├── Manages: texture atlases and resources
├── Extracts: 2D slices from 3D volumes
└── Dependencies: [wgpu texture API]
```

## Implementation Strategy

### Phase 1: Backend 4D Foundation

**Files to Modify:**
1. `core/bridge_types/src/lib.rs`
   - Add 4D variants to `VolumeSendable` enum
   - Extend `VolumeHandleInfo` for 4D metadata
   - Add `VolumeType` enum (3D vs 4D)

2. `core/loaders/nifti/src/lib.rs`
   - Remove 3D-only dimension restriction
   - Add dimension-aware loading logic
   - Implement `load_as_4d_timeseries()` function

3. `core/api_bridge/src/lib.rs`
   - Extend volume registry for 4D storage
   - Add 4D volume detection in `load_file` command
   - Implement basic 4D commands

**New Files Needed:**
- `core/bridge_types/src/volume_4d.rs` - 4D-specific types
- `core/loaders/nifti/src/timeseries_loader.rs` - 4D loading logic

### Phase 2: API Integration

**Files to Modify:**
1. `core/api_bridge/src/lib.rs`
   - Add `get_volume_at_timepoint()` command
   - Add `get_timeseries_matrix()` command  
   - Add `get_volume_info()` command

2. `ui2/src/services/transport.ts`
   - Add new commands to `apiBridgeCommands` array
   - Handle 4D command namespacing

3. `ui2/src/services/apiService.ts`
   - Add TypeScript interfaces for 4D operations
   - Implement 4D volume API methods

### Phase 3: UI Temporal Controls

**Files to Create:**
- `ui2/src/components/temporal/TimeSlider.tsx`
- `ui2/src/components/temporal/TimeSeriesPlot.tsx`
- `ui2/src/components/temporal/TemporalControls.tsx`
- `ui2/src/services/TimeSeriesService.ts`

**Files to Modify:**
- `ui2/src/stores/viewStateStore.ts` - Add temporal state
- Various UI components for 4D volume handling

### Phase 4: Advanced Features

- ROI-based time series extraction
- Temporal filtering and preprocessing
- 4D volume visualizations
- Export time series data

## Critical Success Factors

### 1. Non-Breaking Changes
- 3D volumes continue to work unchanged
- Existing API commands remain compatible
- No disruption to current 3D workflows

### 2. Memory Management
- Efficient 4D volume storage in registry
- Smart caching of timepoints in GPU memory
- Proper cleanup of large 4D datasets

### 3. Performance Considerations
- Extract single timepoints for rendering (no 4D GPU textures)
- Cache recently accessed timepoints
- Use sparse representations for ROI analysis

### 4. User Experience
- Clear 4D vs 3D volume identification
- Intuitive temporal navigation controls
- Responsive time series visualization

## Risk Assessment

### Low Risk
- neuroim-rs has mature 4D support
- Clear separation between 3D and 4D code paths
- Incremental implementation possible

### Medium Risk  
- Memory usage with large fMRI datasets
- UI complexity for temporal navigation
- GPU texture size limits

### High Risk
- Performance impact on existing 3D workflows
- Compatibility with all NIfTI 4D variants
- User experience complexity with mixed 3D/4D workflows

## Conclusion

Adding 4D fMRI support to brainflow2 is highly feasible due to neuroim-rs's comprehensive 4D infrastructure. The implementation requires targeted modifications across three main areas:

1. **Data Loading Pipeline**: Extend NIfTI loader and volume types for 4D support
2. **Volume Storage**: Add 4D variants to registry and handle dual 3D/4D architecture
3. **UI Integration**: Add temporal controls and time series visualization

The key insight is that 4D volumes can be rendered through the existing 3D pipeline by extracting individual timepoints, minimizing changes to the GPU rendering system while leveraging the robust 4D capabilities already present in neuroim-rs.

**Estimated Implementation Effort**: 3-4 weeks for core 4D support, 2-3 additional weeks for advanced temporal visualization features.
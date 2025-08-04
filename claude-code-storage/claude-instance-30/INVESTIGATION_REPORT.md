# 4D fMRI Support Investigation Report

## Executive Summary

This investigation examined the current brainflow2 codebase to understand how 3D volumes are loaded and processed, and explored the feasibility of adding support for 4D fMRI time series. The key finding is that **neuroim-rs already has comprehensive 4D support**, but brainflow2's current architecture is designed around 3D volumes only. Adding 4D support will require strategic modifications across the loading pipeline, data structures, and UI components.

## Current Volume Loading Pipeline

### 1. Architecture Overview

Brainflow2 uses a layered architecture for volume loading:

```
Frontend (TypeScript) → API Bridge (Rust/Tauri) → Loaders (Rust) → neuroim-rs → GPU Rendering
```

The current pipeline supports only 3D volumes through these key components:

- **NIfTI Loader** (`core/loaders/nifti/src/lib.rs`)
- **Volume Types** (`core/bridge_types/src/lib.rs`)
- **Volume Math** (`core/volmath/src/lib.rs`)
- **API Bridge** (`core/api_bridge/src/lib.rs`)

### 2. Current 3D Volume Flow

1. **File Loading**: `load_file()` command in API bridge calls `NiftiLoader::load()`
2. **Volume Creation**: Creates `VolumeSendable` enum with 3D volume variants
3. **Storage**: Stores volume in `VolumeRegistry` with unique handle
4. **Rendering**: Uploads volume to GPU via `RenderLoopService`
5. **Display**: Renders 2D slices and 3D surfaces

### 3. Key Data Structures

**Current Volume Types (3D only):**
```rust
pub enum VolumeSendable {
    VolF32(DenseVolume3<f32>, Affine3<f32>),
    VolI16(DenseVolume3<i16>, Affine3<f32>),
    // ... other numeric types
}

pub type DenseVolume3<T> = CompatibleVolume<T>;  // Wraps neuroim::DenseNeuroVol<T>
```

**Volume Handle Info:**
```rust
pub struct VolumeHandleInfo {
    pub id: String,
    pub name: String,
    pub dims: [usize; 3],  // 3D only
    pub dtype: String,
}
```

## neuroim-rs 4D Capabilities

### 1. Comprehensive 4D Support

The neuroim-rs library has **full 4D support** including:

- **DenseNeuroVec<T>**: 4D time series volumes
- **SparseNeuroVec<T>**: 4D sparse representations for ROI analysis
- **4D I/O**: `read_vec()`, `read_vec_f32()`, `write_vec()` functions
- **Time Series Operations**: Extract individual volumes, time series, scaling, concatenation

### 2. 4D Data Structures

```rust
// 4D volume with time dimension
pub struct DenseNeuroVec<T: Numeric + Sum> {
    pub data: Array4<T>,     // 4D array [x, y, z, time]
    pub space: NeuroSpace,   // 4D spatial metadata
    pub label: String,
}

// 4D sparse volume for efficient ROI analysis
pub struct SparseNeuroVec<T> {
    pub data: Array2<T>,        // [time x masked_voxels]
    pub space: NeuroSpace,      // 4D spatial metadata
    pub mask: LogicalNeuroVol,  // 3D mask defining ROI
    pub indices: Vec<usize>,    // Linear indices of masked voxels
}
```

### 3. 4D Operations Available

- **Volume Extraction**: `volume(t: usize)` - extract 3D volume at time t
- **Time Series**: `series(x, y, z)` - extract time series for voxel
- **Multi-Voxel Series**: `series_multi(coords)` - extract multiple time series
- **Subset Operations**: `sub_vector(indices)` - extract time subset
- **Scaling**: `scale_series(center, scale)` - normalize time series
- **Concatenation**: `concat()` - combine multiple 4D volumes

### 4. I/O Functions

```rust
// Read 4D NIfTI as time series
pub fn read_vec<T>(filename: impl AsRef<Path>) -> Result<DenseNeuroVec<T>>

// Read specific 3D volume from 4D file
pub fn read_vol_as<T>(filename: impl AsRef<Path>, index: usize) -> Result<DenseNeuroVol<T>>

// Write 4D time series
pub fn write_vec(vec: &DenseNeuroVec<f32>, filename: impl AsRef<Path>) -> Result<()>
```

## Current Limitations for 4D Support

### 1. NIfTI Loader Restrictions

The current loader **rejects 4D files**:

```rust
// In nifti/src/lib.rs, line 45-47
if dims.len() != 3 {
    return Err(NiftiError::DimensionMismatch(dims.len()));
}
```

However, it has handling for 4D detection:
```rust
// Line 21-22 in error enum
#[error("Unsupported volume dimensions: {0}, expected 3 or 4 (only first volume used)")]
DimensionMismatch(usize),
```

### 2. Volume Storage Architecture

- `VolumeSendable` enum only supports 3D variants
- `VolumeHandleInfo` has `dims: [usize; 3]` - fixed 3D
- No storage for 4D volumes in the registry

### 3. API Bridge Limitations

- No commands for 4D volume operations
- `get_timeseries_matrix()` is stubbed out (not implemented)
- No time dimension navigation in UI

### 4. GPU Rendering Pipeline

- Render loop expects 3D volumes only
- No temporal navigation or time series visualization
- Slice extraction assumes 3D structure

## Required Changes for 4D Support

### 1. Extend Volume Types

**Add 4D variants to VolumeSendable:**
```rust
pub enum VolumeSendable {
    // Existing 3D variants...
    VolF32(DenseVolume3<f32>, Affine3<f32>),
    
    // New 4D variants
    Vec4DF32(DenseNeuroVec<f32>),
    Vec4DI16(DenseNeuroVec<i16>),
    // ... other 4D types
}
```

**Extend Volume Handle Info:**
```rust
pub struct VolumeHandleInfo {
    pub id: String,
    pub name: String,
    pub dims: Vec<usize>,      // Support both 3D and 4D
    pub dtype: String,
    pub volume_type: VolumeType, // 3D vs 4D
}

pub enum VolumeType {
    Volume3D,
    TimeSeries4D,
}
```

### 2. Modify NIfTI Loader

**Update dimension validation:**
```rust
// Replace current 3D-only check with:
if dims.len() < 3 || dims.len() > 4 {
    return Err(NiftiError::DimensionMismatch(dims.len()));
}

// Handle 4D case
if dims.len() == 4 {
    // Load as DenseNeuroVec<T> using read_vec_as()
    return Ok(VolumeSendable::Vec4DF32(volume_4d));
}
```

**Add auto-detection:**
```rust
pub fn load_nifti_auto(path: &Path) -> Result<VolumeSendable> {
    let header = read_header(path)?;
    let ndim = header.dim[0] as usize;
    
    match ndim {
        3 => load_as_3d_volume(path),
        4 => load_as_4d_timeseries(path),
        _ => Err(NiftiError::DimensionMismatch(ndim))
    }
}
```

### 3. API Bridge Extensions

**Add 4D-specific commands:**
```rust
#[command]
async fn get_volume_at_timepoint(
    volume_id: String, 
    timepoint: usize
) -> BridgeResult<VolumeHandleInfo> { /* ... */ }

#[command]
async fn get_timeseries_matrix(
    volume_id: String, 
    coords: Vec<[f32; 3]>
) -> BridgeResult<TimeSeriesResult> { /* ... */ }

#[command]
async fn get_volume_info(
    volume_id: String
) -> BridgeResult<VolumeInfo> { /* ... */ }

pub struct VolumeInfo {
    pub dims: Vec<usize>,
    pub volume_type: VolumeType,
    pub num_timepoints: Option<usize>,
}
```

### 4. UI Components

**Add time navigation:**
- Time slider component for 4D volumes
- Time series plot panels
- Temporal controls in toolbar

**Volume type detection:**
- Display volume type (3D/4D) in UI
- Show time dimension information
- Enable/disable temporal controls

### 5. Integration Points

**Volume Registry updates:**
```rust
pub struct VolumeRegistry {
    volumes_3d: HashMap<String, VolumeSendable>,
    volumes_4d: HashMap<String, DenseNeuroVec<f32>>, // Add 4D storage
}
```

**Render loop integration:**
- Extract current timepoint as 3D volume for rendering
- Cache recently accessed timepoints
- Handle temporal navigation

## Implementation Strategy

### Phase 1: Core 4D Support (Backend)
1. **Extend VolumeSendable enum** with 4D variants
2. **Update NIfTI loader** to handle 4D files
3. **Add 4D storage** to volume registry
4. **Implement basic API commands** for 4D operations

### Phase 2: Time Series API
1. **Implement get_timeseries_matrix()** command
2. **Add volume_at_timepoint()** extraction
3. **Create 4D volume info** API
4. **Add temporal metadata** handling

### Phase 3: UI Integration
1. **Add volume type detection** in frontend
2. **Implement time slider** component
3. **Create time series plots** functionality
4. **Update volume browser** to show 4D info

### Phase 4: Advanced Features
1. **ROI-based time series** extraction
2. **Temporal filtering** and preprocessing
3. **4D volume visualizations**
4. **Export time series** data

## File Structure Impact

### New Files Needed:
```
core/
├── bridge_types/src/
│   └── volume_4d.rs          # 4D-specific types
├── loaders/nifti/src/
│   └── timeseries_loader.rs  # 4D loading logic
└── api_bridge/src/
    └── timeseries_commands.rs # 4D API commands

ui2/src/
├── components/temporal/
│   ├── TimeSlider.tsx
│   ├── TimeSeriesPlot.tsx
│   └── TemporalControls.tsx
└── services/
    └── TimeSeriesService.ts
```

### Modified Files:
- `core/bridge_types/src/lib.rs` - Extend volume types
- `core/loaders/nifti/src/lib.rs` - Add 4D support
- `core/api_bridge/src/lib.rs` - Add 4D commands
- `ui2/src/services/transport.ts` - Add 4D API calls
- Multiple UI components for 4D volume handling

## Testing Strategy

### Unit Tests:
1. **4D NIfTI loading** with various data types
2. **Time series extraction** accuracy
3. **Volume-at-timepoint** extraction
4. **API command** integration tests

### Integration Tests:
1. **End-to-end 4D loading** workflow
2. **UI temporal controls** functionality
3. **Time series plotting** accuracy
4. **Memory usage** with large 4D volumes

### Test Data:
- Create synthetic 4D fMRI datasets
- Use real fMRI data samples (small)
- Performance benchmarks with large volumes

## Risk Assessment

### Low Risk:
- neuroim-rs already has complete 4D support
- Clear separation between 3D and 4D code paths
- Non-breaking changes to existing 3D functionality

### Medium Risk:
- Memory usage with large 4D volumes
- GPU texture size limits for temporal data
- UI complexity for temporal navigation

### High Risk:
- Performance impact on existing 3D workflows
- Compatibility with all NIfTI 4D variants
- User experience complexity

## Conclusion

Adding 4D fMRI support to brainflow2 is **highly feasible** because:

1. **neuroim-rs has comprehensive 4D support** - no need to build from scratch
2. **Clean architecture** allows for non-breaking extensions
3. **Clear integration points** identified throughout the codebase
4. **Incremental implementation** possible via phased approach

The main work involves extending the existing 3D-focused data structures and API to handle 4D volumes, leveraging the robust 4D capabilities already present in neuroim-rs. This would position brainflow2 as a comprehensive neuroimaging tool supporting both structural (3D) and functional (4D) data analysis workflows.

**Estimated effort**: 3-4 weeks for basic 4D support, 2-3 additional weeks for advanced temporal visualization features.
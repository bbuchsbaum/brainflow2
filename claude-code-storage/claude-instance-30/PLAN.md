# Comprehensive Implementation Plan: 4D fMRI Time Series Support for brainflow2

## Executive Summary

This plan outlines the complete implementation strategy for adding 4D functional MRI (fMRI) time series support to brainflow2. Based on comprehensive investigation of the codebase and data flow analysis, the implementation leverages neuroim-rs's existing 4D capabilities while maintaining full backward compatibility with current 3D volume workflows.

**Key Strategy**: Enable 4D volume loading and display the first timepoint initially, establishing a foundation for future temporal navigation features. This approach allows users to immediately work with fMRI data while preparing the architecture for advanced time series functionality.

## Phase 1: Core 4D Foundation (Week 1-2)

### Objective
Establish basic 4D volume loading capability, storing 4D data in the backend while displaying the first timepoint through existing 3D rendering pipeline.

### 1.1 Extend Volume Type System

**File: `/Users/bbuchsbaum/code/brainflow2/core/bridge_types/src/lib.rs`**

**Current State Analysis:**
- `VolumeSendable` enum has 8 variants for 3D volumes only
- `VolumeHandleInfo` has fixed `dims: [usize; 3]` array
- No concept of temporal data or volume types

**Required Changes:**

```rust
// Add 4D variants to VolumeSendable enum
pub enum VolumeSendable {
    // Existing 3D variants (unchanged)
    VolF32(DenseVolume3<f32>, Affine3<f32>),
    VolI16(DenseVolume3<i16>, Affine3<f32>),
    VolU8(DenseVolume3<u8>, Affine3<f32>),
    VolI8(DenseVolume3<i8>, Affine3<f32>),
    VolU16(DenseVolume3<u16>, Affine3<f32>),
    VolI32(DenseVolume3<i32>, Affine3<f32>),
    VolU32(DenseVolume3<u32>, Affine3<f32>),
    VolF64(DenseVolume3<f64>, Affine3<f32>),
    
    // New 4D variants
    Vec4DF32(DenseNeuroVec<f32>),
    Vec4DI16(DenseNeuroVec<i16>),
    Vec4DU8(DenseNeuroVec<u8>),
    Vec4DI8(DenseNeuroVec<i8>),
    Vec4DU16(DenseNeuroVec<u16>),
    Vec4DI32(DenseNeuroVec<i32>),
    Vec4DU32(DenseNeuroVec<u32>),
    Vec4DF64(DenseNeuroVec<f64>),
}

// Extended volume metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeHandleInfo {
    pub id: String,
    pub name: String,
    pub dims: Vec<usize>,           // Support both 3D [x,y,z] and 4D [x,y,z,t]
    pub dtype: String,
    pub volume_type: VolumeType,
    pub num_timepoints: Option<usize>,
    pub current_timepoint: Option<usize>,  // For 4D volumes, track current display
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VolumeType {
    Volume3D,
    TimeSeries4D,
}

// 4D-specific metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeSeriesInfo {
    pub num_timepoints: usize,
    pub tr: Option<f32>,              // Repetition time in seconds
    pub temporal_unit: Option<String>, // Time unit (e.g., "seconds", "milliseconds")
    pub acquisition_time: Option<f32>, // Total acquisition time
}
```

**Implementation Details:**
- Import `DenseNeuroVec` from neuroim-rs via volmath crate
- Add proper serialization attributes for TypeScript binding generation
- Ensure backward compatibility by making new fields optional where appropriate

### 1.2 Update NIfTI Loader for 4D Support

**File: `/Users/bbuchsbaum/code/brainflow2/core/loaders/nifti/src/lib.rs`**

**Current Blocking Issue:**
```rust
// Line 45-47: This explicitly rejects 4D files
if dims.len() != 3 {
    return Err(NiftiError::DimensionMismatch(dims.len()));
}
```

**Required Changes:**

```rust
// Replace the 3D-only check with dimension-aware loading
pub fn load_nifti_volume_neuroim(path: &Path) -> Result<VolumeSendable, NiftiError> {
    let header = read_header(path).map_err(NiftiError::IoError)?;
    let dims: Vec<usize> = header.dim[1..=header.dim[0] as usize].iter()
        .map(|&d| d as usize)
        .collect();
    
    // Validate dimensions
    if dims.len() < 3 || dims.len() > 4 {
        return Err(NiftiError::DimensionMismatch(dims.len()));
    }
    
    // Route to appropriate loader based on dimensions
    match dims.len() {
        3 => load_as_3d_volume(path),
        4 => load_as_4d_timeseries(path),
        _ => unreachable!(), // Already validated above
    }
}

// New function for 4D loading
fn load_as_4d_timeseries(path: &Path) -> Result<VolumeSendable, NiftiError> {
    use neuroim::read_vec_as;
    
    // Try different data types in order of likelihood for fMRI
    if let Ok(vol) = read_vec_as::<f32>(path) {
        return Ok(VolumeSendable::Vec4DF32(vol));
    }
    if let Ok(vol) = read_vec_as::<i16>(path) {
        return Ok(VolumeSendable::Vec4DI16(vol));
    }
    if let Ok(vol) = read_vec_as::<f64>(path) {
        return Ok(VolumeSendable::Vec4DF64(vol));
    }
    // Add other types as needed
    
    Err(NiftiError::UnsupportedDataType("Could not load 4D volume with any supported data type".to_string()))
}

// Keep existing 3D loading function unchanged
fn load_as_3d_volume(path: &Path) -> Result<VolumeSendable, NiftiError> {
    // Existing implementation remains unchanged
    // ...
}
```

**Error Handling Updates:**
```rust
// Update error enum for better 4D support
#[derive(Debug)]
pub enum NiftiError {
    IoError(std::io::Error),
    #[error("Unsupported volume dimensions: {0}, supported: 3D or 4D")]
    DimensionMismatch(usize),
    #[error("Unsupported data type: {0}")]
    UnsupportedDataType(String),
    #[error("4D volume loading failed: {0}")]
    TimeSeriesLoadError(String),
}
```

### 1.3 Extend Volume Registry for 4D Storage

**File: `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/src/lib.rs`**

**Current State:**
- Simple `HashMap<String, VolumeSendable>` for volume storage
- No distinction between 3D and 4D volumes in registry

**Required Changes:**

```rust
// Enhanced volume registry structure
pub struct VolumeRegistry {
    volumes: HashMap<String, VolumeSendable>,       // Unified storage for all volume types
    volume_info: HashMap<String, VolumeHandleInfo>, // Enhanced metadata
    current_timepoints: HashMap<String, usize>,     // Track current timepoint for 4D volumes
}

impl VolumeRegistry {
    pub fn new() -> Self {
        Self {
            volumes: HashMap::new(),
            volume_info: HashMap::new(),
            current_timepoints: HashMap::new(),
        }
    }
    
    pub fn store_volume(&mut self, id: String, volume: VolumeSendable, name: String) -> VolumeHandleInfo {
        let handle_info = match &volume {
            // 3D volume variants
            VolumeSendable::VolF32(vol, _) => VolumeHandleInfo {
                id: id.clone(),
                name: name.clone(),
                dims: vol.shape().to_vec(),
                dtype: "f32".to_string(),
                volume_type: VolumeType::Volume3D,
                num_timepoints: None,
                current_timepoint: None,
            },
            
            // 4D volume variants
            VolumeSendable::Vec4DF32(vec) => {
                let dims = vec.data.shape().to_vec();
                let num_timepoints = dims[3];
                
                // Set initial timepoint to 0
                self.current_timepoints.insert(id.clone(), 0);
                
                VolumeHandleInfo {
                    id: id.clone(),
                    name: name.clone(),
                    dims,
                    dtype: "f32".to_string(),
                    volume_type: VolumeType::TimeSeries4D,
                    num_timepoints: Some(num_timepoints),
                    current_timepoint: Some(0),
                }
            },
            
            // Handle other variants...
        };
        
        self.volumes.insert(id.clone(), volume);
        self.volume_info.insert(id.clone(), handle_info.clone());
        handle_info
    }
    
    pub fn get_volume_info(&self, id: &str) -> Option<&VolumeHandleInfo> {
        self.volume_info.get(id)
    }
    
    pub fn set_current_timepoint(&mut self, id: &str, timepoint: usize) -> Result<(), String> {
        if let Some(info) = self.volume_info.get(id) {
            if let Some(num_tp) = info.num_timepoints {
                if timepoint >= num_tp {
                    return Err(format!("Timepoint {} out of range [0, {})", timepoint, num_tp));
                }
                self.current_timepoints.insert(id.to_string(), timepoint);
                Ok(())
            } else {
                Err("Volume is not a time series".to_string())
            }
        } else {
            Err("Volume not found".to_string())
        }
    }
}
```

**Update load_file command:**
```rust
#[command]
async fn load_file(path: String, state: State<'_, BridgeState>) -> BridgeResult<VolumeHandleInfo> {
    let volume = core_loaders::load_any_volume(&path)
        .map_err(|e| BridgeError::LoadError(e.to_string()))?;
    
    let id = uuid::Uuid::new_v4().to_string();
    let name = std::path::Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string();
    
    let mut registry = state.volume_registry.lock().await;
    let handle_info = registry.store_volume(id, volume, name);
    
    Ok(handle_info)
}
```

### 1.4 Add Basic 4D Commands

**File: `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/src/lib.rs`**

```rust
// Get detailed volume information
#[command]
async fn get_volume_info(
    volume_id: String,
    state: State<'_, BridgeState>
) -> BridgeResult<VolumeHandleInfo> {
    let registry = state.volume_registry.lock().await;
    let info = registry.get_volume_info(&volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound(volume_id))?;
    Ok(info.clone())
}

// Extract 3D volume at specific timepoint for rendering
#[command]
async fn get_volume_at_timepoint(
    volume_id: String,
    timepoint: usize,
    state: State<'_, BridgeState>
) -> BridgeResult<VolumeHandleInfo> {
    let mut registry = state.volume_registry.lock().await;
    
    // Set the current timepoint
    registry.set_current_timepoint(&volume_id, timepoint)
        .map_err(|e| BridgeError::InvalidOperation(e))?;
    
    // Return updated volume info
    let info = registry.get_volume_info(&volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound(volume_id))?;
    Ok(info.clone())
}

// Check if volume is 4D time series
#[command]
async fn is_time_series(
    volume_id: String,
    state: State<'_, BridgeState>
) -> BridgeResult<bool> {
    let registry = state.volume_registry.lock().await;
    let info = registry.get_volume_info(&volume_id)
        .ok_or_else(|| BridgeError::VolumeNotFound(volume_id))?;
    Ok(matches!(info.volume_type, VolumeType::TimeSeries4D))
}
```

**Update command registration:**
```rust
// Add new commands to the generate_handler! macro
tauri::generate_handler![
    load_file,
    get_volume_info,          // New
    get_volume_at_timepoint,  // New  
    is_time_series,           // New
    // ... existing commands
]
```

**Update build.rs:**
```rust
// File: /Users/bbuchsbaum/code/brainflow2/core/api_bridge/build.rs
const COMMANDS: &[&str] = &[
    "load_file",
    "get_volume_info",
    "get_volume_at_timepoint", 
    "is_time_series",
    // ... existing commands
];
```

## Phase 2: Rendering Integration (Week 2-3)

### Objective
Enable 4D volumes to display through the existing 3D rendering pipeline by extracting the current timepoint as a 3D volume.

### 2.1 Modify Render Loop for 4D Support

**File: `/Users/bbuchsbaum/code/brainflow2/core/render_loop/src/lib.rs`**

**Strategy**: No changes to GPU textures or WebGPU pipeline. Instead, extract current timepoint as 3D volume for rendering.

```rust
// Add 4D volume extraction for rendering
impl RenderLoopService {
    pub fn upload_4d_volume_current_timepoint(&mut self, 
        volume_id: &str, 
        vec_4d: &DenseNeuroVec<f32>,
        current_timepoint: usize
    ) -> Result<(), RenderError> {
        // Extract 3D volume at current timepoint
        let vol_3d = vec_4d.volume(current_timepoint)
            .map_err(|e| RenderError::VolumeExtractionError(e.to_string()))?;
        
        // Convert to existing 3D volume format
        let dense_vol_3d = DenseVolume3::from_neuro_vol(vol_3d);
        
        // Use existing 3D upload pipeline
        self.upload_volume_to_gpu(volume_id, &dense_vol_3d)
    }
    
    pub fn update_timepoint_rendering(&mut self,
        volume_id: &str,
        vec_4d: &DenseNeuroVec<f32>,
        new_timepoint: usize
    ) -> Result<(), RenderError> {
        // Re-upload current timepoint to GPU
        self.upload_4d_volume_current_timepoint(volume_id, vec_4d, new_timepoint)
    }
}
```

### 2.2 Volume Registry Integration with Rendering

**File: `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/src/lib.rs`**

```rust
// Update existing rendering commands to handle 4D volumes
#[command]
async fn update_frame_ubo(
    origin_mm: [f32; 4],
    u_mm: [f32; 4], 
    v_mm: [f32; 4],
    state: State<'_, BridgeState>
) -> BridgeResult<()> {
    let mut render_loop = state.render_loop.lock().await;
    
    // For each active volume, check if it's 4D and needs current timepoint rendering
    let registry = state.volume_registry.lock().await;
    for (volume_id, volume) in &registry.volumes {
        match volume {
            VolumeSendable::Vec4DF32(vec_4d) => {
                if let Some(current_tp) = registry.current_timepoints.get(volume_id) {
                    render_loop.upload_4d_volume_current_timepoint(volume_id, vec_4d, *current_tp)?;
                }
            },
            // Handle other 4D types...
            _ => {
                // Existing 3D volume handling unchanged
            }
        }
    }
    
    render_loop.update_frame_ubo(origin_mm, u_mm, v_mm).await
        .map_err(|e| BridgeError::RenderError(e.to_string()))?;
    
    Ok(())
}
```

## Phase 3: Frontend Integration (Week 3-4)

### Objective
Add TypeScript interfaces and basic UI support for 4D volume detection and display.

### 3.1 TypeScript Type Generation

**Files to update for TypeScript bindings:**
- `/Users/bbuchsbaum/code/brainflow2/core/api_bridge/src/lib.rs` (add serde derives)
- Run: `cargo xtask ts-bindings` to generate updated TypeScript interfaces

**Expected generated types:**
```typescript
// Generated in TypeScript bindings
export interface VolumeHandleInfo {
  id: string;
  name: string;
  dims: number[];
  dtype: string;
  volume_type: VolumeType;
  num_timepoints?: number;
  current_timepoint?: number;
}

export enum VolumeType {
  Volume3D = "Volume3D",
  TimeSeries4D = "TimeSeries4D"
}

export interface TimeSeriesInfo {
  num_timepoints: number;
  tr?: number;
  temporal_unit?: string;
  acquisition_time?: number;
}
```

### 3.2 Transport Layer Updates

**File: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/transport.ts`**

```typescript
// Add new commands to the transport layer
export const apiBridgeCommands = [
  'load_file',
  'get_volume_info',          // Add
  'get_volume_at_timepoint',  // Add
  'is_time_series',           // Add
  // ... existing commands
] as const;
```

### 3.3 API Service Extensions

**File: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/apiService.ts`**

```typescript
// Add 4D-specific API methods
export class ApiService {
  // Existing methods unchanged...
  
  // Get detailed volume information
  async getVolumeInfo(volumeId: string): Promise<VolumeHandleInfo> {
    return invoke('plugin:api-bridge|get_volume_info', { volumeId });
  }
  
  // Check if volume is a time series
  async isTimeSeries(volumeId: string): Promise<boolean> {
    return invoke('plugin:api-bridge|is_time_series', { volumeId });
  }
  
  // Set current timepoint for 4D volume
  async setVolumeTimepoint(volumeId: string, timepoint: number): Promise<VolumeHandleInfo> {
    return invoke('plugin:api-bridge|get_volume_at_timepoint', { 
      volumeId, 
      timepoint 
    });
  }
}
```

### 3.4 Volume Detection in File Loading

**File: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/FileLoadingService.ts`**

```typescript
// Enhance file loading to detect and handle 4D volumes
export class FileLoadingService {
  async loadFile(path: string): Promise<void> {
    try {
      // Load file using existing API
      const volumeHandle = await ApiService.loadFile(path);
      
      // Check if it's a 4D time series
      const isTimeSeries = await ApiService.isTimeSeries(volumeHandle.id);
      
      if (isTimeSeries) {
        console.log(`Loaded 4D time series: ${volumeHandle.name}`);
        console.log(`Dimensions: ${volumeHandle.dims.join('x')}`);
        console.log(`Timepoints: ${volumeHandle.num_timepoints}`);
        console.log(`Currently displaying timepoint: ${volumeHandle.current_timepoint}`);
        
        // For now, just display the first timepoint
        // Future: Add temporal navigation UI
        EventBus.emit('volume-loaded-4d', {
          volumeHandle,
          currentTimepoint: volumeHandle.current_timepoint || 0
        });
      } else {
        // Handle as regular 3D volume (existing behavior)
        EventBus.emit('volume-loaded', volumeHandle);
      }
      
      // Create layer using existing pipeline
      await LayerService.createLayerFromVolume(volumeHandle);
      
    } catch (error) {
      console.error('Failed to load file:', error);
      throw error;
    }
  }
}
```

### 3.5 UI Indicators for 4D Volumes

**File: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/ui/LayerTable.tsx`**

```typescript
// Add 4D volume indicators to layer table
export const LayerTable: React.FC<LayerTableProps> = ({ layers }) => {
  return (
    <div className="layer-table">
      {layers.map(layer => (
        <div key={layer.id} className="layer-row">
          <div className="layer-info">
            <span className="layer-name">{layer.name}</span>
            
            {/* Add 4D indicator */}
            {layer.volumeType === 'TimeSeries4D' && (
              <span className="volume-type-badge time-series">
                4D ({layer.numTimepoints} timepoints)
              </span>
            )}
            
            {layer.volumeType === 'Volume3D' && (
              <span className="volume-type-badge volume-3d">3D</span>
            )}
          </div>
          
          {/* Show current timepoint for 4D volumes */}
          {layer.volumeType === 'TimeSeries4D' && (
            <div className="temporal-info">
              <span className="current-timepoint">
                t = {layer.currentTimepoint || 0}
              </span>
            </div>
          )}
          
          {/* Existing layer controls */}
        </div>
      ))}
    </div>
  );
};
```

## Phase 4: Testing and Validation (Week 4)

### 4.1 Unit Tests

**File: `/Users/bbuchsbaum/code/brainflow2/core/loaders/nifti/tests/test_4d_loading.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    
    #[test]
    fn test_4d_nifti_loading() {
        // Test with synthetic 4D NIfTI file
        let path = Path::new("test_data/synthetic_4d_fmri.nii.gz");
        let result = load_nifti_volume_neuroim(path);
        
        assert!(result.is_ok());
        match result.unwrap() {
            VolumeSendable::Vec4DF32(vec) => {
                let dims = vec.data.shape();
                assert_eq!(dims.len(), 4);
                assert!(dims[3] > 1); // Has time dimension
            },
            _ => panic!("Expected 4D volume variant"),
        }
    }
    
    #[test]
    fn test_3d_backward_compatibility() {
        // Ensure 3D volumes still work
        let path = Path::new("test_data/test_3d_volume.nii.gz");
        let result = load_nifti_volume_neuroim(path);
        
        assert!(result.is_ok());
        match result.unwrap() {
            VolumeSendable::VolF32(_, _) => {}, // Success
            _ => panic!("Expected 3D volume variant"),
        }
    }
    
    #[test]
    fn test_volume_at_timepoint_extraction() {
        // Test timepoint extraction
        let path = Path::new("test_data/synthetic_4d_fmri.nii.gz");
        let volume = load_nifti_volume_neuroim(path).unwrap();
        
        if let VolumeSendable::Vec4DF32(vec) = volume {
            let timepoint_0 = vec.volume(0);
            assert!(timepoint_0.is_ok());
            
            let vol_3d = timepoint_0.unwrap();
            assert_eq!(vol_3d.shape().len(), 3);
        }
    }
}
```

### 4.2 Integration Tests

**File: `/Users/bbuchsbaum/code/brainflow2/tests/integration_4d_loading.rs`**

```rust
#[tokio::test]
async fn test_4d_volume_loading_pipeline() {
    // Test complete 4D loading pipeline from API bridge to volume registry
    let bridge_state = setup_test_bridge_state().await;
    
    // Load 4D volume
    let result = load_file(
        "test_data/synthetic_4d_fmri.nii.gz".to_string(),
        State::new(bridge_state.clone())
    ).await;
    
    assert!(result.is_ok());
    let handle_info = result.unwrap();
    
    // Verify 4D properties
    assert_eq!(handle_info.volume_type, VolumeType::TimeSeries4D);
    assert!(handle_info.num_timepoints.is_some());
    assert_eq!(handle_info.dims.len(), 4);
    
    // Test timepoint navigation
    let timepoint_result = get_volume_at_timepoint(
        handle_info.id.clone(),
        5,
        State::new(bridge_state)
    ).await;
    
    assert!(timepoint_result.is_ok());
    let updated_info = timepoint_result.unwrap();
    assert_eq!(updated_info.current_timepoint, Some(5));
}
```

### 4.3 End-to-End Tests

**File: `/Users/bbuchsbaum/code/brainflow2/e2e/tests/4d_volume_loading.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

test('4D fMRI volume loading and display', async ({ page }) => {
  // Start the application
  await page.goto('tauri://localhost');
  
  // Load a 4D fMRI file
  await page.click('[data-testid="load-file-button"]');
  await page.setInputFiles('[data-testid="file-input"]', 'test-data/synthetic_4d_fmri.nii.gz');
  
  // Wait for volume to load
  await page.waitForSelector('[data-testid="layer-table"]', { timeout: 10000 });
  
  // Verify 4D volume is detected
  const layerRow = page.locator('[data-testid="layer-row"]').first();
  await expect(layerRow.locator('.volume-type-badge.time-series')).toBeVisible();
  
  // Verify timepoint indicator
  const timepointIndicator = layerRow.locator('.current-timepoint');
  await expect(timepointIndicator).toContainText('t = 0');
  
  // Verify rendering (first timepoint should display)
  const orthogonalView = page.locator('[data-testid="orthogonal-view"]');
  await expect(orthogonalView).toBeVisible();
  
  // Take screenshot for visual verification
  await page.screenshot({ path: 'test-results/4d-volume-loaded.png' });
});
```

## Phase 5: Advanced Features (Future Phases)

### 5.1 Temporal Navigation UI (Week 5-6)

**Planned Components:**
- Time slider for navigating between timepoints
- Play/pause controls for automatic playback
- Time series plots for selected voxels
- Temporal range selection tools

### 5.2 Time Series Analysis (Week 7-8)

**Planned Features:**
- ROI-based time series extraction
- Statistical analysis tools
- Temporal filtering capabilities
- Time series export functionality

### 5.3 Advanced 4D Visualization (Week 9-10)

**Planned Features:**
- Animated volume rendering
- Temporal colormap overlays
- 4D connectivity visualization
- Real-time temporal analysis

## Error Handling and Edge Cases

### 5.1 4D Loading Error Scenarios

**Corrupted 4D Files:**
```rust
// Handle incomplete or corrupted 4D NIfTI files
fn load_as_4d_timeseries(path: &Path) -> Result<VolumeSendable, NiftiError> {
    match read_vec_as::<f32>(path) {
        Ok(vec) => {
            // Validate 4D structure
            let dims = vec.data.shape();
            if dims.len() != 4 {
                return Err(NiftiError::TimeSeriesLoadError(
                    format!("Expected 4D data, got {}D", dims.len())
                ));
            }
            if dims[3] == 0 {
                return Err(NiftiError::TimeSeriesLoadError(
                    "Time dimension cannot be zero".to_string()
                ));
            }
            Ok(VolumeSendable::Vec4DF32(vec))
        },
        Err(e) => Err(NiftiError::TimeSeriesLoadError(e.to_string())),
    }
}
```

**Memory Constraints:**
```rust
// Add memory usage validation for large 4D volumes
fn validate_4d_memory_usage(dims: &[usize]) -> Result<(), NiftiError> {
    const MAX_VOXELS: usize = 500_000_000; // ~2GB for f32 data
    
    let total_voxels: usize = dims.iter().product();
    if total_voxels > MAX_VOXELS {
        return Err(NiftiError::TimeSeriesLoadError(
            format!("4D volume too large: {} voxels (max: {})", 
                    total_voxels, MAX_VOXELS)
        ));
    }
    Ok(())
}
```

### 5.2 Timepoint Navigation Errors

**Out of Range Timepoints:**
```rust
impl VolumeRegistry {
    pub fn set_current_timepoint(&mut self, id: &str, timepoint: usize) -> Result<(), String> {
        if let Some(info) = self.volume_info.get_mut(id) {
            if let Some(num_tp) = info.num_timepoints {
                if timepoint >= num_tp {
                    return Err(format!(
                        "Timepoint {} out of range [0, {})", 
                        timepoint, num_tp
                    ));
                }
                self.current_timepoints.insert(id.to_string(), timepoint);
                
                // Update info
                info.current_timepoint = Some(timepoint);
                Ok(())
            } else {
                Err("Volume is not a time series".to_string())
            }
        } else {
            Err("Volume not found".to_string())
        }
    }
}
```

### 5.3 Frontend Error Handling

**File Loading Failures:**
```typescript
export class FileLoadingService {
  async loadFile(path: string): Promise<void> {
    try {
      const volumeHandle = await ApiService.loadFile(path);
      
      // Validate volume handle
      if (!volumeHandle || !volumeHandle.id) {
        throw new Error('Invalid volume handle received');
      }
      
      // Handle 4D-specific errors
      if (volumeHandle.volume_type === 'TimeSeries4D') {
        if (!volumeHandle.num_timepoints || volumeHandle.num_timepoints <= 0) {
          throw new Error('Invalid 4D volume: no timepoints');
        }
        
        if (volumeHandle.dims.length !== 4) {
          throw new Error('Invalid 4D volume: incorrect dimensions');
        }
      }
      
      // Continue with normal loading...
      
    } catch (error) {
      console.error('4D volume loading failed:', error);
      
      // Show user-friendly error message
      if (error.message.includes('TimeSeriesLoadError')) {
        EventBus.emit('show-error', {
          title: '4D Volume Loading Failed',
          message: 'This fMRI file could not be loaded. Please check the file format and try again.',
          details: error.message
        });
      } else {
        EventBus.emit('show-error', {
          title: 'File Loading Failed',
          message: 'An error occurred while loading the file.',
          details: error.message
        });
      }
      
      throw error;
    }
  }
}
```

## Backward Compatibility Assurance

### Major Compatibility Points:

1. **3D Volume Loading**: All existing 3D volume loading workflows remain unchanged
2. **API Commands**: All existing commands maintain their signatures and behavior
3. **UI Components**: Existing UI components work with 3D volumes as before
4. **GPU Rendering**: No changes to the core WebGPU rendering pipeline
5. **Data Structures**: New fields are optional and don't break existing serialization

### Validation Strategy:

1. **Regression Tests**: Run full test suite with existing 3D volumes
2. **API Compatibility**: Ensure all existing Tauri commands still work
3. **UI Compatibility**: Verify existing UI components handle 3D volumes correctly
4. **Performance**: Ensure no performance degradation for 3D volume workflows

## Performance Considerations

### Memory Management:
- 4D volumes can be very large (several GB)
- Store full 4D data in registry but only upload current timepoint to GPU
- Implement intelligent caching for recently accessed timepoints
- Consider lazy loading for timepoints not currently displayed

### GPU Resource Usage:
- No change to GPU memory requirements (still rendering 3D slices)
- Same texture upload patterns as 3D volumes
- Current timepoint extraction happens in CPU memory before GPU upload

### Rendering Performance:
- Timepoint switching requires new GPU texture upload
- Cache commonly accessed timepoints in GPU memory
- Use existing WebGPU optimization strategies

## File Structure Summary

### New Files Created:
```
core/bridge_types/src/volume_4d.rs          # 4D-specific type definitions
core/loaders/nifti/src/timeseries_loader.rs # 4D loading logic (optional)
core/loaders/nifti/tests/test_4d_loading.rs # 4D loading unit tests
tests/integration_4d_loading.rs             # Integration tests
e2e/tests/4d_volume_loading.spec.ts         # E2E tests
ui2/src/types/volume4d.ts                   # TypeScript 4D interfaces (generated)
```

### Modified Files:
```
core/bridge_types/src/lib.rs                # Extended volume types
core/loaders/nifti/src/lib.rs               # 4D loading support
core/api_bridge/src/lib.rs                  # 4D commands and registry
core/api_bridge/build.rs                    # Command registration
core/render_loop/src/lib.rs                 # 4D rendering integration
ui2/src/services/transport.ts               # API transport updates
ui2/src/services/apiService.ts              # 4D API methods
ui2/src/services/FileLoadingService.ts      # 4D loading detection
ui2/src/components/ui/LayerTable.tsx        # 4D volume indicators
```

## Implementation Timeline

### Week 1: Core Backend Foundation
- Day 1-2: Extend `VolumeSendable` enum and `VolumeHandleInfo`
- Day 3-4: Update NIfTI loader for 4D support
- Day 5-7: Extend volume registry and add basic 4D commands

### Week 2: Rendering Integration
- Day 1-3: Modify render loop for 4D timepoint extraction
- Day 4-5: Update API bridge rendering commands
- Day 6-7: Test backend 4D loading and rendering pipeline

### Week 3: Frontend Integration
- Day 1-2: Generate TypeScript bindings and update transport
- Day 3-4: Extend API service and file loading service
- Day 5-7: Add 4D volume indicators to UI components

### Week 4: Testing and Validation
- Day 1-3: Write comprehensive unit and integration tests
- Day 4-5: Create E2E tests for 4D volume loading
- Day 6-7: Performance testing and optimization

### Week 5+: Advanced Features (Future Phases)
- Temporal navigation UI components
- Time series analysis tools
- Advanced 4D visualization features

## Success Criteria

### Phase 1 Success Metrics:
1. **4D NIfTI files load successfully** without errors
2. **First timepoint displays correctly** through existing 3D pipeline
3. **Volume registry stores 4D metadata** including timepoint information
4. **API commands return proper 4D volume information**
5. **UI correctly identifies and labels 4D volumes**
6. **All existing 3D volume workflows remain unchanged**
7. **Memory usage remains reasonable** for typical fMRI datasets
8. **No performance degradation** for existing 3D volume operations

### Validation Checklist:
- [ ] Load various 4D fMRI datasets (different sizes, data types)
- [ ] Verify first timepoint rendering matches neuroimaging software
- [ ] Confirm 3D volume loading still works identically
- [ ] Test error handling with corrupted/invalid 4D files
- [ ] Validate memory usage with large 4D datasets
- [ ] Check UI responsiveness with 4D volume metadata
- [ ] Verify TypeScript type generation works correctly
- [ ] Confirm all unit and integration tests pass

## Risk Mitigation

### High-Risk Areas:
1. **Memory Usage**: Large 4D volumes could cause memory issues
   - *Mitigation*: Add memory validation and loading limits
   
2. **Performance Impact**: 4D support might slow down 3D workflows
   - *Mitigation*: Keep 3D and 4D code paths separate, comprehensive performance testing
   
3. **Compatibility**: Changes might break existing functionality
   - *Mitigation*: Extensive regression testing, backward compatibility validation

### Medium-Risk Areas:
1. **Complex Error Handling**: 4D files have more failure modes
   - *Mitigation*: Comprehensive error handling and user feedback
   
2. **UI Complexity**: 4D metadata adds UI complexity
   - *Mitigation*: Gradual UI enhancement, maintain simplicity for 3D volumes

## Conclusion

This comprehensive plan provides a strategic approach to adding 4D fMRI support to brainflow2 while maintaining backward compatibility and leveraging the existing robust infrastructure. The phased implementation ensures that each step builds upon the previous one, with thorough testing and validation at each stage.

The key insight is that neuroim-rs already provides comprehensive 4D support, so the primary work involves extending brainflow2's data structures and API to expose this functionality while routing 4D volume rendering through the existing proven 3D pipeline by extracting individual timepoints.

**Expected Outcome**: Users will be able to load 4D fMRI datasets and immediately see the first timepoint displayed, with full temporal metadata available for future navigation features. This establishes a solid foundation for advanced time series analysis and visualization capabilities.
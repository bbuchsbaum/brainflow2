# Histogram Data Flow Analysis Report

## Executive Summary

This report traces the execution flows for histogram data computation when loading templates vs files in the BrainFlow2 application. The analysis reveals a critical **backend state synchronization issue** where template loading fails to properly populate the `layer_to_volume_map` required for histogram computation, while file loading works correctly.

## Key Finding: Backend Layer-to-Volume Mapping Critical Path

The histogram computation failure stems from a missing mapping in the backend's `layer_to_volume_map`. This mapping is **only populated during GPU resource allocation**, not during volume registry insertion, creating a timing-dependent race condition.

---

## Template Loading Flow (BROKEN)

### 1. Frontend Initiation
**File**: `/ui2/src/services/TemplateService.ts:115`
```typescript
// Menu click triggers template-action event
const templateResult = await invoke('plugin:api-bridge|load_template_by_id', {
    templateId: templateId
}) as TemplateLoadResult;
```

### 2. Backend Template Loading
**File**: `/core/api_bridge/src/lib.rs` - `load_template_by_id()`
```rust
// Template service loads volume data
let template_service = state.template_service.lock().await;
let result = template_service.load_template(config).await;

// Volume gets registered in volume_registry
let mut registry = state.volume_registry.lock().await;
registry.insert(result.volume_handle_info.id.clone(), volume_sendable, metadata);
```

**⚠️ CRITICAL GAP**: Template loading registers volume in `volume_registry` but does **NOT** populate `layer_to_volume_map`.

### 3. Volume Loading Service Coordination
**File**: `/ui2/src/services/VolumeLoadingService.ts:138`
```typescript
// Unified volume loading
const addedLayer = await this.layerService!.addLayer(layer);

// Attempts timing fix (insufficient)
coalesceUtils.flush();
await new Promise(resolve => setTimeout(resolve, 50));
```

### 4. Layer API Implementation
**File**: `/ui2/src/services/LayerApiImpl.ts:35`
```typescript
// GPU resource allocation - CRITICAL for layer_to_volume_map
const gpuInfo = await this.apiService.requestLayerGpuResources(newLayer.id, newLayer.volumeId);
```

### 5. Backend GPU Resource Allocation
**File**: `/core/api_bridge/src/lib.rs:1729-1731`
```rust
// THIS is where layer_to_volume_map gets populated
let mut volume_map = state.layer_to_volume_map.lock().await;
let LayerSpec::Volume(vol_spec) = &layer_spec;
volume_map.insert(ui_layer_id.clone(), vol_spec.source_resource_id.clone());
```

### 6. Histogram Request (FAILS)
**File**: `/ui2/src/components/panels/PlotPanel.tsx:55`
```typescript
// PlotPanel requests histogram
const data = await histogramService.computeHistogram({
    layerId: selectedLayerId,
    binCount: 256,
    excludeZeros: true
});
```

### 7. Backend Histogram Computation (FAILS)
**File**: `/core/api_bridge/src/lib.rs:2974-2983`
```rust
// FAILURE POINT: layer_to_volume_map lookup fails
let layer_map = state.layer_to_volume_map.lock().await;
match layer_map.get(&layer_id) {
    Some(handle) => handle.clone(),
    None => {
        return Err(BridgeError::VolumeNotFound {
            code: 4044,
            details: format!("Volume for layer {} not found", layer_id),
        });
    }
}
```

**Result**: `VolumeNotFound` error → Empty histogram display

---

## File Loading Flow (WORKING)

### 1. Frontend Initiation
**File**: `/ui2/src/services/FileLoadingService.ts:77`
```typescript
// Double-click in file browser
const volumeHandle = await this.apiService.loadFile(path);
```

### 2. Backend File Loading
**File**: `/core/api_bridge/src/lib.rs` - `load_file()`
```rust
// Direct file loading
let (volume_sendable, _affine) = nifti_loader::load_nifti_volume_auto(file_path);

// Volume gets registered in volume_registry
let mut registry = state.volume_registry.lock().await;
registry.insert(handle_id.clone(), volume_sendable, metadata);
```

### 3-7. Identical Flow to Template Loading
The same unified volume loading path follows, but **crucially**, the volume registry entry exists and GPU resource allocation succeeds, properly populating `layer_to_volume_map`.

**Result**: Histogram computation succeeds → Valid histogram display

---

## Critical Differences Analysis

### Volume Registry Population
- **File Loading**: Direct NIfTI loader → immediate registry insertion
- **Template Loading**: Template service → registry insertion (same pattern)

### Layer-to-Volume Mapping Population
- **Both flows**: Only happens during `request_layer_gpu_resources` at line 1731
- **Template loading issue**: Race condition or incomplete GPU resource allocation

### Timing Dependencies
**File**: `/ui2/src/services/VolumeLoadingService.ts:144-150`
```typescript
// Attempted mitigation (insufficient)
// Force an immediate flush to ensure the backend populates layer_to_volume_map
coalesceUtils.flush();
// Small delay to ensure the render completes and backend mappings are established
await new Promise(resolve => setTimeout(resolve, 50));
```

---

## Event Propagation Analysis

### Template Loading Events
1. `template-action` (Tauri menu)
2. `file.loading` (VolumeLoadingService)
3. `volume.loaded` (VolumeLoadingService)
4. `layer.added` (LayerService)
5. `volume.load.complete` (VolumeLoadingService)

### File Loading Events
1. `filebrowser.file.doubleclick` (EventBus)
2. `file.loading` (FileLoadingService)
3. `volume.loaded` (VolumeLoadingService)
4. `layer.added` (LayerService)
5. `volume.load.complete` (VolumeLoadingService)

**Key Insight**: Event sequences are identical - the issue is in backend state management, not event propagation.

---

## Backend State Dependencies

### Volume Registry (`volume_registry`)
```rust
// Stores actual volume data
pub volume_registry: Arc<Mutex<VolumeRegistry>>,
```
- Populated: ✅ Both template and file loading
- Contains: Volume data and metadata

### Layer-to-Volume Mapping (`layer_to_volume_map`)
```rust
// Maps UI layer IDs to volume handle IDs
layer_to_volume_map: Arc<Mutex<HashMap<String, String>>>,
```
- Populated: Only during GPU resource allocation
- Required for: Histogram computation
- **Issue**: Template loading may not trigger proper population

---

## Histogram Service Flow

### Request Initiation
**File**: `/ui2/src/services/HistogramService.ts:113`
```typescript
private async fetchHistogram(request: HistogramRequest): Promise<HistogramData> {
    const response = await invoke<{...}>('plugin:api-bridge|compute_layer_histogram', {
        layerId: request.layerId,
        binCount: request.binCount || 256,
        range: request.range,
        excludeZeros: request.excludeZeros || false
    });
}
```

### Backend Processing
**File**: `/core/api_bridge/src/lib.rs:2974-2989`
```rust
// Step 1: Look up volume handle (FAILS for templates)
let volume_handle = {
    let layer_map = state.layer_to_volume_map.lock().await;
    match layer_map.get(&layer_id) { /* ... */ }
};

// Step 2: Get volume from registry (would work if step 1 succeeded)
let volume = {
    let registry = state.volume_registry.lock().await;
    match registry.get(&volume_handle) { /* ... */ }
};
```

---

## Root Cause Analysis

### Primary Cause: State Synchronization Issue
The `layer_to_volume_map` is populated **only** during `request_layer_gpu_resources`, not during volume loading. This creates a dependency on:
1. GPU resource allocation completing successfully
2. Proper timing between volume loading and layer addition
3. Backend state consistency across async operations

### Secondary Cause: Template Loading Path Differences
Template loading uses a different backend service (`template_service`) which may have subtle differences in state management compared to direct file loading.

### Tertiary Cause: Insufficient Timing Coordination
The 50ms delay in VolumeLoadingService is insufficient to guarantee backend state consistency.

---

## Potential Solutions

### Option 1: Fix Backend State Management (Recommended)
**Location**: `/core/api_bridge/src/lib.rs`
- Modify `load_template_by_id` to populate `layer_to_volume_map` directly
- Ensure consistent state management across all volume loading paths
- Add state validation before returning success

### Option 2: Enhanced Timing Coordination
**Location**: `/ui2/src/services/VolumeLoadingService.ts`
- Implement proper backend state polling instead of fixed delays
- Add retry logic for histogram computation
- Verify backend mappings before completing volume loading

### Option 3: Histogram Service Fallback
**Location**: `/core/api_bridge/src/lib.rs` - `compute_layer_histogram`
- Add fallback logic when `layer_to_volume_map` lookup fails
- Search `volume_registry` directly using layer ID as volume handle
- Implement alternative mapping strategies

---

## Implementation Priority

1. **High Priority**: Fix backend state management (Option 1)
   - Ensures consistent behavior across all loading paths
   - Addresses root cause rather than symptoms

2. **Medium Priority**: Enhanced timing coordination (Option 2)
   - Provides robustness against future timing issues
   - Improves overall reliability

3. **Low Priority**: Histogram service fallback (Option 3)
   - Defensive programming approach
   - May mask underlying architectural issues

---

## Testing Recommendations

### Validation Steps
1. Add logging to `request_layer_gpu_resources` to verify mapping population
2. Add logging to `compute_layer_histogram` to trace exact failure points
3. Test template loading with different timing delays
4. Verify file loading still works after fixes

### Debug Instrumentation
```rust
// Add to request_layer_gpu_resources
info!("Layer-to-volume mapping added: {} -> {}", ui_layer_id, vol_spec.source_resource_id);

// Add to compute_layer_histogram
info!("Available layer mappings: {:?}", layer_map.keys().collect::<Vec<_>>());
```

---

## Conclusion

The histogram data flow issue is a **backend architectural problem** rooted in inconsistent state management between template and file loading paths. The `layer_to_volume_map` dependency creates a critical synchronization point that template loading fails to properly handle.

The recommended solution is to fix the backend state management to ensure all volume loading paths properly populate the required mappings, eliminating the timing dependency and ensuring consistent behavior across all data sources.
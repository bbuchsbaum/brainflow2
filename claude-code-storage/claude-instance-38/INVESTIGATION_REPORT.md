# Histogram Data Investigation Report

## Issue Summary
When loading templates from the template menu, the histogram component appears but shows no actual histogram data (empty bins). However, when loading files from the file browser, the histogram works correctly and displays valid data.

## Root Cause Analysis

### Critical Discovery: Layer-to-Volume Mapping Issue

The fundamental issue is in the **layer-to-volume mapping** population timing in the backend. The `compute_layer_histogram` function relies on a critical mapping:

```rust
// In compute_layer_histogram function (line 2974-2983)
let volume_handle = {
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
};
```

This mapping is populated in the `request_layer_gpu_resources` function at line 1731:
```rust
volume_map.insert(ui_layer_id.clone(), vol_spec.source_resource_id.clone());
```

However, **this only happens when GPU resources are actually allocated**, not just when volumes are loaded into the registry.

## Data Flow Comparison

### File Loading Flow (WORKING)
1. **FileLoadingService.loadFile()** → calls `apiService.loadFile(path)`
2. **Backend load_file()** → loads volume into `volume_registry` 
3. **VolumeLoadingService.loadVolume()** → calls `layerService.addLayer()`
4. **LayerApiImpl.addLayer()** → calls `apiService.requestLayerGpuResources()`
5. **Backend request_layer_gpu_resources()** → **POPULATES layer_to_volume_map** (line 1731)
6. **PlotPanel** → calls `histogramService.computeHistogram()`
7. **Backend compute_layer_histogram()** → **FINDS mapping** → returns histogram data

### Template Loading Flow (BROKEN)
1. **TemplateService.loadTemplate()** → calls backend `load_template_by_id()`
2. **Backend load_template_by_id()** → loads template through template service
3. **Template service** → loads volume into `volume_registry` **BUT NO GPU RESOURCE ALLOCATION**
4. **VolumeLoadingService.loadVolume()** → calls `layerService.addLayer()`
5. **LayerApiImpl.addLayer()** → calls `apiService.requestLayerGpuResources()`
6. **Backend request_layer_gpu_resources()** → **MAY NOT POPULATE layer_to_volume_map properly**
7. **PlotPanel** → calls `histogramService.computeHistogram()`
8. **Backend compute_layer_histogram()** → **CANNOT FIND mapping** → returns VolumeNotFound error

## Key Differences

### Template Loading Path Issues

1. **Different Volume Loading Method**: Templates use `templates::TemplateService` instead of direct file loading
2. **Async Resource Allocation**: The template loading creates volume handles differently than file loading
3. **Timing Issues**: The `layer_to_volume_map` population might not complete before histogram requests

### Evidence from Code Analysis

#### Template Service (ui2/src/services/TemplateService.ts:115)
```typescript
const templateResult = await invoke('plugin:api-bridge|load_template_by_id', {
    templateId: templateId
}) as TemplateLoadResult;
```
- Uses different backend loading path
- Volume handle structure may differ

#### Volume Loading Service Attempt at Fix (ui2/src/services/VolumeLoadingService.ts:144-150)
```typescript
// 8. Force a render to ensure layer_to_volume_map is populated in backend
// This is critical for histogram computation to work
console.log(`[VolumeLoadingService] Forcing immediate render to populate backend mappings`);

// Force an immediate flush to ensure the backend populates layer_to_volume_map
coalesceUtils.flush();

// Small delay to ensure the render completes and backend mappings are established
await new Promise(resolve => setTimeout(resolve, 50));
```
This suggests awareness of the timing issue but may not be sufficient.

## Specific Technical Issues

### Backend State Management
- `volume_registry`: Stores actual volume data
- `layer_to_volume_map`: Maps UI layer IDs to volume handle IDs
- **CRITICAL**: Histogram computation requires BOTH mappings to exist

### Template Loading Backend (load_template_by_id)
```rust
// Template service loads directly into registry
// But layer_to_volume_map population depends on GPU resource allocation
```

### GPU Resource Allocation Timing
In `request_layer_gpu_resources` (line 1729-1732):
```rust
// Also store the volume handle mapping
let mut volume_map = state.layer_to_volume_map.lock().await;
let LayerSpec::Volume(vol_spec) = &layer_spec;
volume_map.insert(ui_layer_id.clone(), vol_spec.source_resource_id.clone());
```

This mapping is **ONLY** created during GPU resource allocation, not during volume loading.

## Potential Solutions

### Option 1: Fix Template Loading Path
Ensure template loading properly populates the `layer_to_volume_map` mapping either:
- During template loading itself
- By ensuring GPU resource allocation completes before histogram requests

### Option 2: Fix Histogram Service
Modify `compute_layer_histogram` to handle cases where layer-to-volume mapping doesn't exist:
- Try to find volume by layer ID directly
- Fall back to searching the volume registry by alternative methods

### Option 3: Fix Volume Loading Service
Ensure the timing and flush mechanisms in `VolumeLoadingService` properly wait for backend state to be fully populated.

## Debug Recommendations

1. **Add logging** to backend `compute_layer_histogram` to see exact error messages
2. **Add logging** to template loading to verify volume registry population
3. **Add logging** to `request_layer_gpu_resources` to verify layer_to_volume_map population
4. **Test hypothesis** by manually checking backend state after template loading

## Files Requiring Investigation/Modification

### Backend (Rust)
- `/core/api_bridge/src/lib.rs` - `compute_layer_histogram` function
- `/core/api_bridge/src/lib.rs` - `load_template_by_id` function  
- `/core/api_bridge/src/lib.rs` - `request_layer_gpu_resources` function
- `/core/templates/` - Template service implementation

### Frontend (TypeScript)
- `/ui2/src/services/TemplateService.ts` - Template loading flow
- `/ui2/src/services/VolumeLoadingService.ts` - Volume loading coordination
- `/ui2/src/services/HistogramService.ts` - Histogram computation requests
- `/ui2/src/components/panels/PlotPanel.tsx` - Histogram display

## Conclusion

The root cause is a **backend state synchronization issue** where template loading doesn't properly populate the `layer_to_volume_map` that the histogram computation depends on. The file loading path works because it goes through a different code path that ensures this mapping is created during GPU resource allocation.

The fix likely requires either:
1. Ensuring template loading properly triggers GPU resource allocation and mapping population
2. Modifying the histogram computation to not depend on this specific mapping
3. Improving the timing coordination in the volume loading service

This is a **backend architectural issue** rather than a frontend bug, though the timing coordination in the frontend services may also need improvement.
# Investigation Report: MosaicView Black Squares Issue

## Executive Summary

MosaicView displays black squares instead of properly rendered medical imaging data, despite using the same ViewStateStore and ViewLayers as the working SliceView component. The investigation revealed that while MosaicView correctly extracts dimensions and layer properties, the batch rendering pipeline returns images with all pixels set to rgba(0,0,0,1).

## Key Findings

### 1. Correct Data Flow Until Backend
- MosaicView successfully retrieves ViewLayers from ViewStateStore with proper intensity values (e.g., [0, 9848])
- FrontendViewState structures are correctly built with all required fields
- Layer configurations match those used by SliceView exactly
- Console logs confirm correct data is being sent to the backend

### 2. Critical Difference: Batch vs Single Rendering
The fundamental difference between SliceView and MosaicView is in the rendering approach:

**SliceView (Working):**
- Uses `apply_and_render_view_state_internal` directly
- Single render operation per view
- Returns properly rendered images

**MosaicView (Broken):**
- Uses `batch_render_slices` command
- Iterates through multiple ViewStates
- Each iteration calls `service.request_frame()` instead of `apply_and_render_view_state_internal`

### 3. Backend Implementation Analysis

#### batch_render_slices (core/api_bridge/src/lib.rs)
```rust
// Line 3482-3489
let frame_result = service.request_frame(
    render_loop::view_state::ViewId::new(format!("batch_slice_{}", idx)),
    view_state.clone()
).await.map_err(|e| BridgeError::GpuError {
    code: 8011,
    details: format!("Failed to render slice {}: {:?}", idx, e),
})?;
```

This uses the declarative ViewState API (`request_frame`) rather than the imperative API used by single slice rendering.

#### apply_and_render_view_state_internal
This function:
1. Parses FrontendViewState JSON
2. Manually looks up layers in `layer_to_atlas_map`
3. Calls lower-level rendering functions
4. Handles layer GPU resource allocation checks

### 4. Root Cause Hypothesis

The issue appears to be that `batch_render_slices` uses a different rendering path that may not properly handle:

1. **Layer GPU Resource Lookup**: The `request_frame` path expects volumes to be registered differently than the `apply_and_render_view_state_internal` path
2. **ViewState Structure Mismatch**: The transformation from FrontendViewState to render_loop::ViewState may be losing critical information
3. **Missing Layer Registration**: Batch rendering might not be checking the same layer maps as single rendering

### 5. Evidence of the Problem

From the backend logs in `apply_and_render_view_state_internal`:
```rust
// Line 2829-2833
// Check both layer.id and layer.volume_id to ensure we find the layer
let atlas_idx = {
    let layer_map = state.layer_to_atlas_map.lock().await;
    info!("  - Searching in layer_map with {} entries", layer_map.len());
    // ... complex lookup logic
```

But in `batch_render_slices`, this lookup is delegated to `request_frame` which uses:
```rust
// Line 2836-2840
let vol_entry = self.volumes.get(&layer_config.volume_id)
    .ok_or_else(|| RenderLoopError::Internal {
        code: 8002,
        details: format!("Volume '{}' not registered", layer_config.volume_id),
    })?;
```

## Specific Issues Identified

### 1. Volume Registration Mismatch
- Single rendering checks `layer_to_atlas_map` with complex ID matching
- Batch rendering only checks `volumes` registry
- Layer IDs might not be properly registered in the volumes registry

### 2. ViewState Transformation
The transformation in `batchRenderSlices` (apiService.ts lines 783-889) creates a different structure than what `apply_and_render_view_state_internal` expects:
- Uses `render_loop::ViewState` format instead of FrontendViewState
- May be missing critical fields or transforming them incorrectly

### 3. GPU Resource Allocation
- Single rendering explicitly checks for GPU resources via `layer_to_atlas_map`
- Batch rendering assumes resources exist in the volumes registry
- No explicit GPU resource allocation check in the batch path

## Recommendations

### Immediate Fix Options

1. **Use Single Rendering in Batch Mode**: Modify `batch_render_slices` to call `apply_and_render_view_state_internal` for each slice instead of using `request_frame`

2. **Fix Volume Registration**: Ensure volumes are properly registered in both `layer_to_atlas_map` AND the `volumes` registry before batch rendering

3. **Align ViewState Structures**: Make the batch rendering path use the same FrontendViewState → rendering pipeline as single slice rendering

### Long-term Solution

Unify the rendering pipelines so both single and batch rendering use the same code path, eliminating the divergence that causes this issue.

## Next Steps

1. Test if volumes are properly registered in the render_loop service's volumes registry
2. Compare the exact ViewState structures being sent to each rendering path
3. Add logging to `request_frame` to see why it's returning black images
4. Consider implementing a temporary workaround using multiple single-slice renders

## Technical Details

### File Locations
- **MosaicView Component**: `/ui2/src/components/views/MosaicView.tsx`
- **API Service**: `/ui2/src/services/apiService.ts`
- **Batch Render Backend**: `/core/api_bridge/src/lib.rs:3340`
- **Single Render Backend**: `/core/api_bridge/src/lib.rs:2679`
- **Render Loop Service**: `/core/render_loop/src/lib.rs`

### Data Flow
1. MosaicView → `buildViewStates()` → FrontendViewState[]
2. `batchRenderSlices()` → Transform to RustViewState[]
3. Backend `batch_render_slices` → Parse JSON to render_loop::ViewState
4. Loop: `request_frame()` → Returns black image
5. Concatenate results → Return to frontend

The break occurs at step 4 where `request_frame` doesn't properly render the layers, likely due to missing volume registration or incorrect ViewState structure.
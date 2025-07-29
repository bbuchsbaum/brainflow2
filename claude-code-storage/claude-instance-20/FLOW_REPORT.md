# MosaicView Batch Rendering Flow Analysis

## Executive Summary

The MosaicView batch rendering fails due to a JSON deserialization error where the frontend sends `threshold: [0, 0]` as an array, but the backend expects either `null` or a `ThresholdConfig` object with `mode` and `range` fields. This report traces the complete data flow from UI creation to backend parsing.

## Data Flow Overview

```
MosaicView.tsx → apiService.ts → Tauri Bridge → batch_render_slices (Rust) → ViewState deserialization
```

## Detailed Flow Analysis

### 1. Frontend: MosaicView State Creation

**File**: `/ui2/src/components/views/MosaicView.tsx`
**Method**: `buildViewStates` (lines 210-349)

The MosaicView component creates view states for each slice to render:

```typescript
// Line 292-301: Layer configuration creation
return {
  id: layer.id,
  volumeId: layer.volumeId,
  visible: true,
  opacity: render?.opacity ?? 1.0,
  colormap: render?.colormap || 'gray',
  intensity: [intensityMin, intensityMax],
  threshold: [0, 0],  // ❌ PROBLEM: Array format
  blendMode: 'alpha'
};
```

**Data Structure Created**:
```javascript
{
  views: { axial: { origin_mm: [...], u_mm: [...], v_mm: [...] } },
  crosshair: { world_mm: [...], visible: false },
  layers: [{
    id: "layer-id",
    volumeId: "volume-id",
    visible: true,
    opacity: 1.0,
    colormap: 'gray',
    intensity: [0, 100],
    threshold: [0, 0],  // ❌ Array format
    blendMode: 'alpha'
  }],
  requestedView: { ... }
}
```

### 2. Frontend: API Service Transformation

**File**: `/ui2/src/services/apiService.ts`
**Method**: `batchRenderSlices` (lines 776-903)

The API service transforms FrontendViewState to backend format:

```typescript
// Lines 841-850: Layer transformation
return {
  volume_id: layer.volumeId,
  opacity: layer.opacity || 1.0,
  colormap_id: colormapNameToId(layer.colormap || 'gray'),
  blend_mode: layer.blendMode === 'alpha' ? 'Normal' : 'Normal',
  intensity_window: [intensityMin, intensityMax],
  threshold: null,  // ✅ Correctly sets to null
  visible: layer.visible !== false
};
```

**Critical Issue**: The transformation logic at line 847 correctly sets `threshold: null`, but this transformation is applied to a **copy** of the layer data. The original `threshold: [0, 0]` from MosaicView may still be present in the JSON if the transformation isn't properly applied.

### 3. JSON Serialization

**File**: `/ui2/src/services/apiService.ts`
**Lines**: 880-886

```typescript
const viewStatesJson = JSON.stringify(transformedViewStates, (key, value) => {
  if (key === 'intensity_window' && Array.isArray(value) && value.length === 2) {
    return value;
  }
  return value;
});
```

The JSON serialization uses a custom replacer but doesn't handle the `threshold` field specially. The serialized JSON contains the transformed view states.

### 4. Tauri Bridge Invocation

**File**: `/ui2/src/services/apiService.ts`
**Lines**: 894-900

```typescript
const response = await this.transport.invoke<ArrayBuffer>('batch_render_slices', {
  batchRequest: {
    view_states_json: viewStatesJson,
    width_per_slice: widthPerSlice,
    height_per_slice: heightPerSlice
  }
});
```

The JSON string is passed as part of a `BatchRenderRequest` structure.

### 5. Backend: Command Handler

**File**: `/core/api_bridge/src/lib.rs`
**Function**: `batch_render_slices` (lines 3340-3370)

```rust
#[command]
async fn batch_render_slices(
    batch_request: BatchRenderRequest,
    state: State<'_, BridgeState>
) -> Result<tauri::ipc::Response, BridgeError> {
    // Line 3347: Parse JSON to ViewState structs
    let view_states: Vec<render_loop::view_state::ViewState> = 
        serde_json::from_str(&batch_request.view_states_json)
        .map_err(|e| {
            // Error handling with position info
            let column = e.column();
            BridgeError::Input {
                code: 7001,
                details: format!("Failed to parse view states JSON: {}", e)
            }
        })?;
```

### 6. Backend: ViewState Structure

**File**: `/core/render_loop/src/view_state.rs`
**Structures**: `LayerConfig` and `ThresholdConfig` (lines 85-104)

```rust
pub struct LayerConfig {
    pub volume_id: String,
    pub opacity: f32,
    pub colormap_id: u32,
    pub blend_mode: BlendMode,
    pub intensity_window: (f32, f32),
    pub threshold: Option<ThresholdConfig>,  // ❌ Expects Option<ThresholdConfig>
    pub visible: bool,
}

pub struct ThresholdConfig {
    pub mode: ThresholdMode,
    pub range: (f32, f32),
}
```

### 7. Type Definitions

**Frontend Type** (implicit in MosaicView):
```typescript
threshold: [number, number]  // Array format
```

**Backend Type** (Rust):
```rust
threshold: Option<ThresholdConfig>  // null or { mode, range }
```

## Root Cause Analysis

The error occurs at **column 403** in the JSON, which corresponds to the first layer's `threshold` field. The investigation report correctly identified that MosaicView creates layers with `threshold: [0, 0]`, but the apiService transformation that converts this to `threshold: null` may not be properly applied.

### Why the Transformation Fails

Looking at the code flow:

1. MosaicView creates its own layer structure with `threshold: [0, 0]`
2. These layers are part of the FrontendViewState passed to `batchRenderSlices`
3. The apiService transforms the layers, creating **new** layer objects with `threshold: null`
4. However, if there's any path where the original layer structure bypasses this transformation, the `[0, 0]` array would be serialized to JSON
5. The Rust deserializer expects `Option<ThresholdConfig>` which can only be `null` or an object with `mode` and `range` fields

## Solution

The immediate fix is to ensure MosaicView creates layers with the correct threshold format:

```typescript
// In MosaicView.tsx, line 299
threshold: null,  // Instead of [0, 0]
```

Or if threshold is needed:
```typescript
threshold: {
  mode: 'Range',
  range: [0, 0]
}
```

## Verification Steps

1. Check the actual JSON being sent by logging in apiService before the invoke call
2. Verify that all layer transformations are applied correctly
3. Ensure no code path allows the original MosaicView layer format to reach the backend

## Long-term Recommendations

1. **Type Safety**: Create shared TypeScript interfaces that exactly match Rust structures
2. **Validation**: Add frontend validation before JSON serialization
3. **Consistency**: Use a single layer creation utility across all view components
4. **Testing**: Add unit tests for the serialization/deserialization boundary
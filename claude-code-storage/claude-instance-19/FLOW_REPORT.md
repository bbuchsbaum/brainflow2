# Flow Report: batch_render_slices JSON Serialization Pipeline

## Overview
This report traces the complete data flow of the `batch_render_slices` feature from frontend to backend, focusing on JSON serialization/deserialization and type transformations, particularly the tuple type handling for `intensity_window`.

## 1. Frontend: ViewState Construction in MosaicView

### Location: `/ui2/src/components/views/MosaicView.tsx`

The data flow starts in MosaicView's `buildViewStates` function (lines 233-299):

```javascript
// Line 277-285: LayerConfig construction
{
  volume_id: layer.volumeId,
  opacity: render?.opacity ?? 1.0,
  colormap_id: 0,
  blend_mode: 'Normal',
  intensity_window: [intensityMin, intensityMax], // JavaScript Array format
  threshold: null,
  visible: true
}
```

**Key Points:**
- `intensity_window` is constructed as a JavaScript array `[min, max]`
- Values are ensured to be non-null using fallback defaults (lines 271-272)
- The complete ViewState structure follows:
```javascript
{
  layout_version: 1,
  camera: {...},
  crosshair_world: [0, 0, 0],
  layers: layerConfigs,
  viewport_size: [width, height],
  show_crosshair: false,
}
```

## 2. Frontend: JSON Serialization in apiService

### Location: `/ui2/src/services/apiService.ts`

The `batchRenderSlices` method (lines 779-802) performs a custom serialization:

```javascript
// Lines 785-786: Custom serialization workaround
const individualJsonStrings = viewStates.map(vs => JSON.stringify(vs));
const viewStatesJson = '[' + individualJsonStrings.join(',') + ']';
```

**Important:** This is a workaround for backend re-serialization issues. Instead of:
- `JSON.stringify(viewStates)` - single serialization

It does:
- Individual serialization of each ViewState
- Manual array construction

This approach was implemented to avoid issues with the backend's re-serialization step.

## 3. Tauri IPC Layer

### Location: `/ui2/src/services/transport.ts`

The transport layer (lines 15-25) invokes the Tauri command:

```javascript
// Line 20: Tauri invoke with namespace
await invoke<T>('plugin:api-bridge|batch_render_slices', {
  batchRequest: {
    view_states_json: viewStatesJson,
    width_per_slice: widthPerSlice,
    height_per_slice: heightPerSlice
  }
});
```

**Parameter Naming Convention:**
- JavaScript uses camelCase: `batchRequest`
- Tauri automatically converts to snake_case: `batch_request`
- Field names inside objects must match Rust exactly

## 4. Backend: Initial Deserialization

### Location: `/core/api_bridge/src/lib.rs`

The `batch_render_slices` function (lines 3338-3446) receives the request:

```rust
// Line 3341: Function signature
async fn batch_render_slices(
    batch_request: BatchRenderRequest,
    state: State<'_, BridgeState>
) -> Result<tauri::ipc::Response, BridgeError>
```

The `BatchRenderRequest` structure (from `/core/bridge_types/src/lib.rs`):
```rust
pub struct BatchRenderRequest {
    pub view_states_json: String,  // JSON string of ViewState array
    pub width_per_slice: u32,
    pub height_per_slice: u32,
}
```

## 5. Backend: ViewState Deserialization

### Location: `/core/api_bridge/src/lib.rs` (line 3347)

```rust
// Parse JSON string to ViewState structs
let view_states: Vec<render_loop::view_state::ViewState> = 
    serde_json::from_str(&batch_request.view_states_json)
        .map_err(|e| BridgeError::Input {
            code: 7001,
            details: format!("Failed to parse view states JSON: {}", e)
        })?;
```

**Critical Type Mismatch:**

The Rust `LayerConfig` struct expects (from `/core/render_loop/src/view_state.rs`):
```rust
pub struct LayerConfig {
    pub intensity_window: (f32, f32),  // Rust tuple type
    // ...other fields
}
```

But JavaScript sends:
```javascript
intensity_window: [intensityMin, intensityMax]  // JavaScript array
```

**Why it Works:** Serde can deserialize JSON arrays into Rust tuples automatically. A JSON array `[1.0, 2.0]` is compatible with a Rust tuple `(f32, f32)`.

## 6. Backend: Re-serialization Issue

### Location: `/core/api_bridge/src/lib.rs` (lines 3397-3402)

For each ViewState, the backend re-serializes it:

```rust
// Line 3398: Individual re-serialization
let view_state_str = serde_json::to_string(&view_state_json)
    .map_err(|e| BridgeError::Internal {
        code: 7012,
        details: format!("Failed to serialize view state {}: {}", idx, e)
    })?;
```

**Problem:** This re-serialization step is unnecessary and can cause issues if:
1. Any field contains null values
2. Type conversion errors occur
3. The serialization format differs from the original

## 7. Data Format Transformations

### Summary of Transformations:

1. **Frontend Construction:**
   - `intensity_window`: JavaScript Array `[min, max]`
   - All arrays use JavaScript array format

2. **Frontend Serialization:**
   - Individual ViewState objects → JSON strings
   - Manual array construction to avoid nested serialization

3. **IPC Transport:**
   - No transformation, just parameter name conversion (camelCase → snake_case)

4. **Backend Deserialization:**
   - JSON arrays → Rust tuples (automatic via Serde)
   - String → Parsed ViewState structs

5. **Backend Re-serialization:**
   - ViewState structs → JSON strings (individual)
   - **Potential issue point** if null values exist

## 8. Error Analysis

The error "invalid type: null, expected an array of length 2 at line 1 column 394" indicates:

1. **Location:** Column 394 suggests it's deep in the JSON structure
2. **Cause:** A null value where a 2-element array is expected
3. **Likely Fields:**
   - `intensity_window` if render state is missing
   - `viewport_size` if dimensions are undefined
   - `crosshair_world` (always set to [0,0,0] so unlikely)
   - Camera frame vectors if they're null

## 9. Solution Recommendations

### Immediate Fixes:

1. **Add Frontend Validation:**
```javascript
// Ensure no null values in arrays
const intensityMin = render?.intensityMin ?? dataRange.min;
const intensityMax = render?.intensityMax ?? dataRange.max;

if (intensityMin == null || intensityMax == null) {
    console.error('Invalid intensity values');
    return; // Skip this layer
}
```

2. **Remove Backend Re-serialization:**
The re-serialization in `batch_render_slices` (line 3398) appears unnecessary since the ViewState is already parsed and validated.

3. **Add Debug Logging:**
```javascript
// In apiService before sending
console.log('Sending ViewStates JSON:', viewStatesJson);
```

### Long-term Improvements:

1. **Use Custom Serde Deserializer:**
```rust
#[serde(deserialize_with = "deserialize_array_as_tuple")]
pub intensity_window: (f32, f32),
```

2. **Implement True Batch Rendering:**
Instead of looping through individual renders, implement batch processing in the GPU render loop.

3. **Type-safe Contract:**
Generate TypeScript types from Rust using ts-rs to ensure perfect type alignment.

## Conclusion

The batch_render_slices pipeline has a complex JSON serialization flow with multiple transformation points. The main issue stems from:

1. Potential null values in array fields
2. Unnecessary re-serialization in the backend
3. Mismatch between JavaScript arrays and Rust tuples (though Serde handles this)

The frontend workaround of individually serializing ViewStates suggests awareness of these issues, but a more robust solution would involve proper validation and removing the redundant re-serialization step.
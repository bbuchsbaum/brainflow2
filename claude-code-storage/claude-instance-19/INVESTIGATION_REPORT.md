# Investigation Report: batch_render_slices JSON Parsing Error

## Error Details
- **Error Message**: "Failed to parse view state JSON: invalid type: null, expected an array of length 2 at line 1 column 394"
- **Context**: The error occurs when the Rust backend tries to parse ViewState JSON sent from the frontend MosaicView component

## Investigation Findings

### 1. JSON Structure Being Sent from Frontend

The frontend (MosaicView.tsx) constructs ViewState objects with the following structure:

```javascript
// Line 277-285 in MosaicView.tsx
{
  volume_id: layer.volumeId,
  opacity: render?.opacity ?? 1.0,
  colormap_id: 0,
  blend_mode: 'Normal',
  intensity_window: [intensityMin, intensityMax], // <-- Array format
  threshold: null,
  visible: true
}
```

The complete ViewState structure sent:
```javascript
// Line 288-295
{
  layout_version: 1,
  camera,
  crosshair_world: [0, 0, 0],
  layers: layerConfigs,
  viewport_size: [width, height],
  show_crosshair: false,
}
```

### 2. Rust Struct Definitions Expecting Tuples

The backend expects `intensity_window` as a tuple `(f32, f32)` not an array:

```rust
// Line 89 in core/render_loop/src/view_state.rs
pub struct LayerConfig {
    pub volume_id: String,
    pub opacity: f32,
    pub colormap_id: u32,
    pub blend_mode: BlendMode,
    pub intensity_window: (f32, f32), // <-- Tuple format expected
    pub threshold: Option<ThresholdConfig>,
    pub visible: bool,
}
```

### 3. The Serialization/Deserialization Mismatch

**Root Cause**: JavaScript arrays `[min, max]` are being sent but Rust expects tuples `(min, max)`.

In Serde, tuples are serialized/deserialized differently than arrays:
- Arrays in JSON: `[1.0, 2.0]`
- Tuples in Rust when serialized by default may expect a different format

### 4. The Re-serialization Issue in batch_render_slices

Looking at the batch_render_slices implementation:

```rust
// Line 3230-3234 in core/api_bridge/src/lib.rs
// Parse view states from JSON string to ViewState structs
let view_states: Vec<render_loop::view_state::ViewState> = serde_json::from_str(&batch_request.view_states_json)
    .map_err(|e| BridgeError::Input {
        code: 7001,
        details: format!("Failed to parse view states JSON: {}", e)
    })?;
```

Later in the function, each ViewState is re-serialized individually:

```rust
// Line 3287-3291
let view_state_str = serde_json::to_string(&view_state_json)
    .map_err(|e| BridgeError::Internal {
        code: 7012,
        details: format!("Failed to serialize view state {}: {}", idx, e)
    })?;
```

### 5. Column 394 Analysis

The error at "column 394" suggests the parser encounters a null value where it expects a 2-element array. This could be:
1. A null `intensity_window` value
2. A null in another array field like `viewport_size`, `crosshair_world`, or camera vectors

## Solution Recommendations

### Option 1: Fix Frontend to Send Tuples (Quick Fix)
Change the frontend to send tuples as JSON arrays are compatible with Rust tuples:
```javascript
// This should already work, but ensure no null values
intensity_window: [intensityMin ?? 0.0, intensityMax ?? 1.0],
```

### Option 2: Add Serde Attributes (Better Long-term)
Add explicit serde attributes to handle the conversion:
```rust
#[serde(deserialize_with = "deserialize_intensity_window")]
pub intensity_window: (f32, f32),
```

### Option 3: Change Rust Type to Array
Change the Rust struct to use arrays instead of tuples:
```rust
pub intensity_window: [f32; 2],
```

### Option 4: Debug the Exact JSON
Add logging to capture the exact JSON being sent at column 394 to identify which field is null.

## Immediate Action Items

1. **Add null checks in frontend**: Ensure `intensityMin` and `intensityMax` are never null/undefined
2. **Add validation in apiService**: Validate ViewState before sending
3. **Add debug logging**: Log the exact JSON string being sent to identify the null value
4. **Consider using a custom deserializer**: Handle array-to-tuple conversion explicitly

## Code Locations to Fix

1. **Frontend validation** (MosaicView.tsx, lines 271-274):
   ```javascript
   const intensityMin = render?.intensityMin ?? defaultMin;
   const intensityMax = render?.intensityMax ?? defaultMax;
   // Add validation
   if (intensityMin == null || intensityMax == null) {
     console.error('Invalid intensity values:', { intensityMin, intensityMax });
   }
   ```

2. **API Service validation** (apiService.ts, line 787):
   ```javascript
   // Add validation before sending
   viewStates.forEach((vs, idx) => {
     if (!vs.layers || vs.layers.some(l => !l.intensity_window || l.intensity_window.includes(null))) {
       console.error(`ViewState ${idx} has invalid intensity_window`);
     }
   });
   ```

3. **Backend parsing** (lib.rs): Add better error messages to identify the exact field causing issues

## Conclusion

The error is most likely caused by:
1. Null values in intensity_window arrays from the frontend
2. Potential mismatch between JavaScript arrays and Rust tuples
3. The re-serialization step losing type information

The immediate fix is to ensure no null values are sent from the frontend and add proper validation before sending the JSON to the backend.
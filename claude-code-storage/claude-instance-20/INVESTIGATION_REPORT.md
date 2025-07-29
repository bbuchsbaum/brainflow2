# MosaicView JSON Parsing Error Investigation Report

## Error Description
The MosaicView component is failing with the error:
```
Failed to parse view states JSON: invalid type: null, expected an array of length 2 at line 1 column 403
```

## Root Cause Analysis

### 1. Type Mismatch in `threshold` Field

The core issue is a type mismatch between the frontend and backend for the `threshold` field in layer configurations:

#### Frontend (MosaicView.tsx, line 299):
```typescript
threshold: [0, 0],  // default threshold
```
The frontend is sending `threshold` as an array `[0, 0]`.

#### Backend (view_state.rs, lines 93-104):
```rust
pub struct LayerConfig {
    // ...
    /// Optional threshold range
    pub threshold: Option<ThresholdConfig>,
    // ...
}

pub struct ThresholdConfig {
    pub mode: ThresholdMode,
    pub range: (f32, f32),
}
```
The backend expects `threshold` to be either:
- `null` (represented as `None` in Rust)
- An object with `mode` and `range` fields

### 2. JSON Transformation Issue

In `apiService.ts`, the `batchRenderSlices` method transforms FrontendViewState to backend ViewState format. The transformation at line 847 sets:
```typescript
threshold: null, // No thresholding for now
```

However, the MosaicView component is creating its own layer configurations that include `threshold: [0, 0]`, which bypasses this transformation.

### 3. Data Flow Analysis

1. **MosaicView** creates FrontendViewState objects with `threshold: [0, 0]` (line 299)
2. **apiService.batchRenderSlices** receives these states and attempts to transform them
3. The transformation logic (lines 841-850) creates a new layer object but the original `threshold: [0, 0]` might be passed through
4. **Backend batch_render_slices** tries to deserialize the JSON into `render_loop::view_state::ViewState`
5. Serde fails because it can't convert an array `[0, 0]` into `Option<ThresholdConfig>`

## Solution

The fix is to ensure the frontend sends the correct format for the threshold field. In MosaicView.tsx, line 299 should be changed from:
```typescript
threshold: [0, 0],  // default threshold
```

To:
```typescript
threshold: null,  // No thresholding
```

Alternatively, if threshold support is needed, it should be sent as:
```typescript
threshold: {
  mode: 'Range', // or appropriate ThresholdMode
  range: [0, 0]
}
```

## Additional Findings

1. The error occurs at column 403, which suggests it's happening when parsing the first layer's threshold field in the JSON array
2. The apiService transformation logic appears to handle this correctly for other views but MosaicView creates its own layer format
3. There's an inconsistency between how different components create layer configurations

## Recommendations

1. **Immediate Fix**: Change MosaicView.tsx line 299 to use `threshold: null`
2. **Long-term**: Create a shared utility function for creating layer configurations that ensures consistent formatting across all components
3. **Type Safety**: Consider using TypeScript interfaces that match the Rust structures exactly to catch these mismatches at compile time
# Backend-Frontend Coordinate System Contract

## Overview

This document defines the contract between the Rust backend's view calculations and the TypeScript frontend's rendering expectations for the MosaicView and related components.

## Key Principles

1. **Backend Calculates, Frontend Trusts**: The backend's ViewRectMm calculations are authoritative
2. **Per-Pixel Vectors**: u_mm and v_mm represent world displacement per pixel step  
3. **Square Pixels Priority**: Dimensions may be adjusted to maintain square pixels
4. **Aspect Ratio Preservation**: Backend ensures complete anatomical coverage

## Data Flow

```
Backend ViewRectMm::full_extent()
├─ Calculates pixel_size for square pixels
├─ Determines actual dimensions (may differ from requested)
├─ Creates per-pixel displacement vectors: u_mm, v_mm
└─ Returns complete view geometry

Frontend MosaicView
├─ Receives ViewRectMm from backend
├─ Uses vectors directly (NO scaling)
├─ Applies dimensions as-is for canvas sizing
└─ Trusts backend's aspect ratio decisions
```

## Critical Implementation Details

### Backend Dimension Calculation (ViewRectMm::full_extent)

**Location**: `core/neuro-types/src/view_rect.rs`

The backend uses this logic to preserve square pixels:

```rust
// Choose pixel size so pixels are square
let pixel_size = (width_mm / screen_px_max[0] as f32)
    .max(height_mm / screen_px_max[1] as f32);

let dim_px = [
    (width_mm / pixel_size).ceil() as u32,  // May differ from requested
    (height_mm / pixel_size).ceil() as u32, // May differ from requested
];

// Create per-pixel displacement vectors
u_mm: vec3_scale(right_mm, pixel_size),  // Already per-pixel
v_mm: vec3_scale(down_mm, pixel_size),   // Already per-pixel
```

**Key Insight**: The vectors are already scaled by `pixel_size` and represent the world-space displacement for each pixel step.

### Frontend Integration (MosaicView)

**Location**: `ui2/src/components/views/MosaicView.tsx`

The frontend should use backend parameters directly:

```typescript
// ✅ CORRECT - Trust backend calculations
const updatedView = {
  origin_mm: referenceView.origin_mm,  // Backend-calculated world position
  u_mm: referenceView.u_mm,           // Backend-calculated per-pixel X displacement  
  v_mm: referenceView.v_mm,           // Backend-calculated per-pixel Y displacement
  dim_px: referenceView.dim_px        // Backend-calculated dimensions
};

// ❌ WRONG - DO NOT scale the vectors
const updatedView = {
  u_mm: [
    (referenceView.u_mm[0] / actualRefWidth) * cellWidth,  // Corrupts vectors
    (referenceView.u_mm[1] / actualRefWidth) * cellWidth,
    (referenceView.u_mm[2] / actualRefWidth) * cellWidth
  ],
  // ... scaling corrupts the carefully calculated geometry
};
```

## Common Pitfalls

1. **DO NOT** scale u_mm/v_mm by dimension ratios
2. **DO NOT** assume returned dimensions match requested dimensions  
3. **DO NOT** treat dimension mismatch as error condition
4. **DO** use backend dimensions for canvas sizing
5. **DO** trust backend's square pixel calculations

## Examples

### Typical MNI Brain Volume

- **Volume Dimensions**: 193×229×193 voxels
- **Anatomical Extent**: ~193mm × ~229mm
- **Frontend Request**: 512×512 pixels
- **Backend Returns**: 432×512 pixels (preserves square pixels)
- **Frontend Action**: Use 432×512 for canvas, trust u_mm/v_mm vectors

### Why This Works

The backend ensures:
- Square pixels (medical imaging requirement)
- Complete anatomical coverage
- Correct world-to-pixel transforms
- Proper aspect ratio preservation

### Canvas Integration

```typescript
// ✅ CORRECT - Use backend dimensions
<canvas
  width={viewState.views[orientation].dim_px[0]}   // Backend width
  height={viewState.views[orientation].dim_px[1]}  // Backend height
  style={{
    width: '100%',
    height: '100%',
    objectFit: 'contain' as const  // CSS handles scaling
  }}
/>

// ❌ WRONG - Using cell dimensions
<canvas
  width={cellWidth}    // Ignores backend calculations
  height={cellHeight}  // May not preserve aspect ratio
/>
```

## SliceOverride Integration

When using `sliceOverride`, the same principle applies:

```typescript
// The SliceOverride calculation uses the backend vectors directly
const normal = [
  u[1] * v[2] - u[2] * v[1],  // Cross product with backend vectors
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0]
];

// Backend vectors must not be corrupted for proper plane calculations
```

## Coordinate System Conventions

### World Space (LPI)
- **L**: Left-Posterior-Inferior coordinates
- **Standard**: Neuroimaging coordinate system
- **Units**: Millimeters

### GPU Convention
- **Y=0**: Bottom of viewport (OpenGL standard)
- **Y-axis**: Increases upward

### CPU/Image Convention  
- **Y=0**: Top of image
- **Y-axis**: Increases downward

### Y-Flip Handling
The Y-flip between GPU and CPU conventions is handled at the buffer readback boundary in the backend's `render_to_buffer()` function. This ensures consistent coordinate calculations throughout the pipeline.

## Medical Imaging Requirements

### Square Pixels
Medical imaging requires square pixels to preserve anatomical proportions. Non-square pixels would distort anatomical structures, making measurements inaccurate.

### Aspect Ratio Preservation
The backend's dimension adjustment ensures that the entire anatomical extent fits within the view while maintaining square pixels, following medical imaging best practices.

## Debugging Common Issues

### Quarter Display Problem
- **Symptom**: Only top-left quarter of slice visible
- **Cause**: Frontend scaling backend vectors by dimension ratios
- **Solution**: Remove scaling, use backend vectors directly

### Black Screen Problem
- **Symptom**: Brief flash of image, then black screen
- **Cause**: Corrupted vectors cause invalid SliceOverride calculations
- **Solution**: Ensure vectors remain unmodified from backend

### Dimension Mismatch Warnings
- **Symptom**: Console warnings about backend returning different dimensions
- **Cause**: Frontend expects 1:1 dimension mapping
- **Solution**: Treat as informational - this is expected behavior

## Implementation Checklist

- [ ] Use backend `dim_px` values for canvas dimensions
- [ ] Use backend `u_mm`/`v_mm` vectors without scaling
- [ ] Handle dimension mismatches gracefully (no error/warning)
- [ ] Apply CSS `objectFit: 'contain'` for canvas scaling
- [ ] Validate vectors for NaN/infinite values before use
- [ ] Document any deviations from this contract

## Contract Validation

To verify correct implementation:

1. **Vector Magnitude Check**: Backend vector magnitudes should remain constant
2. **Dimension Acceptance**: Frontend should accept backend dimensions without complaint
3. **Rendering Success**: >95% render success rate for valid volumes
4. **Coordinate Consistency**: Mouse clicks should map to correct anatomical positions

This contract ensures consistent, accurate medical imaging visualization across the entire application.
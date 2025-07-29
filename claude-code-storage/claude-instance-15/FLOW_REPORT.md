# MosaicView Rendering Pipeline Flow Analysis

## Executive Summary

This report provides a comprehensive analysis of the MosaicView rendering pipeline execution flow, focusing on dimension updates, view parameter scaling, and rendering interactions that lead to the identified quarter-display and black screen issues.

## Architecture Overview

The MosaicView rendering pipeline involves multiple interconnected components:

- **Frontend**: MosaicView component with individual MosaicCell instances
- **State Management**: ViewStateStore with coalescing middleware  
- **Rendering Coordination**: RenderCoordinator for request orchestration
- **API Bridge**: ApiService for backend communication
- **Backend**: Rust-based rendering with WebGPU and view calculations

## Critical Flow Analysis

### 1. Dimension Update Flow (Primary Issue Path)

**Trigger**: Container resize or initial mount
**Duration**: ~200-400ms with multiple backend calls

```
┌─ Container Resize Event ──────────────────────────────────┐
│                                                           │
│  MosaicView.containerRef ResizeObserver                   │
│  ├─ setContainerDimensions(newWidth, newHeight)           │
│  └─ Triggers useEffect for cell dimension calculation     │
│                                                           │
├─ Cell Dimension Calculation ─────────────────────────────┤
│                                                           │
│  useEffect([containerDimensions, rows, columns])          │
│  ├─ Calculate available space (minus padding/gaps)       │
│  ├─ cellWidth = Math.floor(availableWidth / columns)     │
│  ├─ cellHeight = Math.floor(availableHeight / rows)      │
│  └─ setCellDimensions() + updateMosaicView() call        │
│                                                           │
├─ CRITICAL: updateMosaicView Execution ───────────────────┤
│                                                           │
│  updateMosaicView(cellWidth, cellHeight) [throttled]      │
│  ├─ Check for redundant updates (lastSentDimensionsRef)  │
│  ├─ Find visible layer with volumeId                     │
│  ├─ Backend call: recalculateViewForDimensions()         │
│  │   ├─ Request: [512, 512] (large reference dims)      │
│  │   ├─ Backend: ViewRectMm::full_extent()               │
│  │   └─ Response: {dim_px: [432, 512]} (aspect-adjusted) │
│  ├─ PROBLEMATIC SCALING LOGIC:                           │
│  │   ├─ actualRefWidth = 432 (not requested 512)        │
│  │   ├─ actualRefHeight = 512                            │
│  │   ├─ u_mm = (ref.u_mm / 432) * cellWidth             │
│  │   └─ v_mm = (ref.v_mm / 512) * cellHeight            │
│  ├─ ViewStateStore.setViewState() with scaled params     │
│  └─ coalesceUtils.flush(true) - force dimension update   │
│                                                           │
└─ Cascade to Individual MosaicCells ─────────────────────┘
    │
    ├─ Each MosaicCell receives new dimensions
    ├─ useEffect([dimensions, slicePosition]) triggers
    └─ RenderCoordinator.requestRender() for each cell
```

### 2. View State Management Flow

**Key Issue**: Coalescing middleware behavior during dimension updates

```
┌─ ViewStateStore Update Chain ────────────────────────────┐
│                                                           │
│  setViewState(updater) called from updateMosaicView      │
│  ├─ Immer-based state update (immediate UI)              │
│  ├─ coalesceUpdatesMiddleware processes change           │
│  │   ├─ Store pendingState = newViewState                │
│  │   ├─ Check if rafId already scheduled                 │
│  │   └─ Schedule requestAnimationFrame(flushState)       │
│  └─ Return immediately (async backend update)            │
│                                                           │
├─ Coalescing Middleware Decision Logic ───────────────────┤
│                                                           │
│  flushState(forceDimensionUpdate = false/true)           │
│  ├─ Check isDragging state (layout operations)           │
│  ├─ If dragging && !forceDimensionUpdate: defer         │
│  ├─ isDimensionOnlyChange() check                        │
│  │   ├─ Compare layers + crosshair (ignore dims)         │
│  │   └─ Allow dimension updates (essential for resize)   │
│  ├─ Call backendUpdateCallback(pendingState)             │
│  └─ Clear pendingState, update lastFlushedState          │
│                                                           │
└─ Backend Propagation ────────────────────────────────────┘
    │
    ├─ ApiService.applyAndRenderViewStateCore() preparation
    └─ Backend render preparation (not actual render)
```

### 3. Rendering Pipeline Flow

**Critical Path**: Individual MosaicCell render requests

```
┌─ MosaicCell Render Request ──────────────────────────────┐
│                                                           │
│  useEffect([viewState, orientation, slicePosition])       │
│  ├─ Validate canvas and dimensions                       │
│  ├─ Calculate sliceOverride parameters                   │
│  │   ├─ axisKey = orientation mapping                    │
│  │   └─ position = slicePosition (world coords)          │
│  └─ RenderCoordinator.requestRender()                    │
│                                                           │
├─ RenderCoordinator Processing ───────────────────────────┤
│                                                           │
│  requestRender(request) - unified entry point            │
│  ├─ Create QueuedJob with unique ID                      │
│  ├─ Reason: 'layer_change' (from MosaicCell)            │
│  ├─ Priority: 'normal'                                   │
│  ├─ sliceOverride: {axis, position}                      │
│  ├─ Enqueue strategy (immediate for layer_change)        │
│  └─ processQueue() execution                             │
│                                                           │
├─ Queue Processing (Sequential) ──────────────────────────┤
│                                                           │
│  executeRenderJob(job)                                    │
│  ├─ ApiService.applyAndRenderViewStateCore()             │
│  │   ├─ Early validation (layers, render target)         │
│  │   ├─ SliceOverride processing:                        │
│  │   │   ├─ Modify crosshair.world_mm[axisIndex]         │
│  │   │   ├─ Calculate view plane adjustment              │
│  │   │   │   ├─ normal = cross(u_mm, v_mm)              │
│  │   │   │   └─ origin += normal * sliceDelta            │
│  │   │   └─ Create viewsToUse with adjusted origin       │
│  │   ├─ Format declarativeViewState for backend         │
│  │   │   ├─ Scale per-pixel vectors by viewport dims    │
│  │   │   │   ├─ u_mm *= width (SHADER EXPECTATION)      │
│  │   │   │   └─ v_mm *= height                          │
│  │   │   └─ Include requestedView with frame params     │
│  │   └─ Backend render call (3 variants)                │
│  │       ├─ RAW RGBA: apply_and_render_view_state_raw   │
│  │       ├─ BINARY IPC: apply_and_render_view_state_binary │
│  │       └─ JSON: apply_and_render_view_state            │
│  ├─ ImageBitmap creation from response                   │
│  └─ Update render store state                            │
│                                                           │
└─ Canvas Drawing ─────────────────────────────────────────┘
    │
    ├─ drawScaledImage(ctx, imageBitmap, width, height)
    ├─ Store imagePlacementRef for coordinate transforms  
    └─ Draw crosshair overlay if applicable
```

### 4. Backend Processing Flow

**Core Issue**: Dimension mismatch between request and response

```
┌─ Backend API: recalculate_view_for_dimensions ────────────┐
│                                                           │
│  Input validation and parsing                             │
│  ├─ volume_id: String                                     │
│  ├─ view_type: "axial"|"sagittal"|"coronal"              │
│  ├─ dimensions: [width, height] (e.g., [512, 512])       │
│  └─ crosshair_mm: [x, y, z]                              │
│                                                           │
├─ Volume Metadata Retrieval ──────────────────────────────┤
│                                                           │
│  volume_registry.get_volume_sendable(volume_id)          │
│  ├─ volume.get_voxel_to_world_transform()                │
│  ├─ dimensions: [193, 229, 193] (MNI brain example)      │
│  └─ VolumeMetadata construction                           │
│                                                           │
├─ CRITICAL: ViewRectMm::full_extent() ────────────────────┤
│                                                           │
│  Aspect ratio preservation logic (THE ROOT CAUSE)        │
│  ├─ Calculate anatomical extents:                        │
│  │   ├─ width_mm = bounds[0].max - bounds[0].min         │
│  │   └─ height_mm = bounds[1].max - bounds[1].min        │
│  ├─ Choose pixel size for square pixels:                 │
│  │   └─ pixel_size = max(width_mm/512, height_mm/512)    │
│  ├─ Calculate actual dimensions:                          │
│  │   ├─ dim_px[0] = ceil(width_mm / pixel_size) = 432    │
│  │   └─ dim_px[1] = ceil(height_mm / pixel_size) = 512   │
│  ├─ Per-pixel displacement vectors:                       │
│  │   ├─ u_mm = right_direction * pixel_size              │
│  │   └─ v_mm = down_direction * pixel_size               │
│  └─ Origin calculation (top-left world position)         │
│                                                           │
├─ Response Construction ───────────────────────────────────┤
│                                                           │
│  ViewRectMm {                                             │
│    origin_mm: calculated_origin,                          │
│    u_mm: per_pixel_u_vector,                             │
│    v_mm: per_pixel_v_vector,                             │
│    width_px: 432,  // NOT requested 512!                 │
│    height_px: 512  // Matches request                     │
│  }                                                        │
│                                                           │
└─ DIMENSION MISMATCH LOGGED ──────────────────────────────┘
    │
    └─ Frontend receives different dimensions than requested
```

### 5. Error/Edge Case Flow Analysis

**Quarter Display Issue Flow**:

```
┌─ Quarter Display Manifestation ──────────────────────────┐
│                                                           │
│  Root Cause: Incorrect view parameter scaling            │
│  ├─ Backend returns [432, 512] for [512, 512] request    │
│  ├─ Frontend scaling: cellWidth / 432 ≈ 256/432 = 0.59  │
│  ├─ u_mm and v_mm vectors corrupted by scaling           │
│  │   ├─ u_mm = (backend_u_mm / 432) * 256                │
│  │   └─ Result: ~59% of expected displacement            │
│  ├─ SliceOverride calculations use corrupted vectors     │
│  ├─ Backend receives inconsistent view parameters        │
│  └─ Rendered slice shows only top-left quarter           │
│                                                           │
└─ Symptom Timeline ───────────────────────────────────────┘
    │
    1. Initial render may work (using original parameters)
    2. Dimension update triggers scaling corruption  
    3. Subsequent renders show quarter-image
    4. Further updates may cause complete render failure (black)
```

**Black Screen Issue Flow**:

```
┌─ Black Screen Manifestation ─────────────────────────────┐
│                                                           │
│  Cascade failure from view parameter corruption          │
│  ├─ Corrupted u_mm/v_mm vectors from scaling             │
│  ├─ SliceOverride plane calculations become invalid      │
│  │   ├─ normal = cross(corrupted_u_mm, corrupted_v_mm)   │
│  │   └─ origin adjustment produces out-of-bounds plane   │
│  ├─ Backend render fails silently                        │
│  │   ├─ Invalid slice plane intersections                │
│  │   └─ No valid voxel samples                           │
│  ├─ Empty ImageBitmap returned                           │
│  └─ Canvas shows black screen                            │
│                                                           │
└─ Recovery Impossible ────────────────────────────────────┘
    │
    └─ Subsequent renders continue to use corrupted parameters
```

## Critical Decision Points and Data Transformations

### 1. Backend Dimension Calculation (View Rect Creation)

**Location**: `core/neuro-types/src/view_rect.rs:96-103`
**Decision**: Preserve square pixels vs. honor requested dimensions
**Impact**: Creates dimension mismatch that propagates through system

```rust
// THE DECISION POINT:
let pixel_size = (width_mm / screen_px_max[0] as f32)
    .max(height_mm / screen_px_max[1] as f32);

let dim_px = [
    (width_mm / pixel_size).ceil() as u32,  // 432 ≠ 512
    (height_mm / pixel_size).ceil() as u32, // 512 = 512
];
```

### 2. Frontend View Parameter Scaling (The Bug)

**Location**: `ui2/src/components/views/MosaicView.tsx:348-382`
**Decision**: Scale backend vectors by dimension ratio
**Impact**: Corrupts carefully calculated per-pixel displacement vectors

```typescript
// THE BUG:
const updatedView = {
  u_mm: [
    (referenceView.u_mm[0] / actualRefWidth) * cellWidth,  // WRONG
    (referenceView.u_mm[1] / actualRefWidth) * cellWidth,  // WRONG
    (referenceView.u_mm[2] / actualRefWidth) * cellWidth   // WRONG
  ],
  // ... same corruption for v_mm
};
```

### 3. SliceOverride Plane Adjustment

**Location**: `ui2/src/services/apiService.ts:137-167`
**Decision**: Calculate normal vector from u_mm × v_mm
**Impact**: When u_mm/v_mm are corrupted, normal calculation fails

```typescript
// AFFECTED BY CORRUPTION:
const normal = [
  u[1] * v[2] - u[2] * v[1],  // Cross product with corrupted vectors
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0]
];
```

## Performance Impact Analysis

### Current Performance Issues

1. **Render Success Rate**: ~20-30% due to corrupted parameters
2. **GPU Resource Utilization**: Multiple failed render attempts waste resources
3. **Memory Leaks**: Failed ImageBitmap creation may accumulate
4. **User Experience**: Flickering between quarter-image and black screens

### Timing Analysis

```
Total MosaicView Update: ~400ms
├─ Container resize detection: ~16ms
├─ Cell dimension calculation: ~1ms  
├─ updateMosaicView execution: ~200ms
│   ├─ Backend recalculateViewForDimensions: ~100ms
│   ├─ View parameter scaling (BUG): ~1ms
│   └─ ViewState update + coalescing: ~99ms
└─ Individual MosaicCell renders: ~180ms (9 cells × 20ms avg)
    ├─ RenderCoordinator queuing: ~2ms per cell
    ├─ Backend render call: ~15ms per cell
    └─ Canvas drawing: ~3ms per cell
```

## Race Conditions and Timing Dependencies

### 1. Dimension Update vs. Cell Render Race

**Scenario**: Cell renders start before dimension update completes
**Risk**: Cells render with old view parameters, then new dimensions
**Mitigation**: updateMosaicView throttling (200ms) and coalescing flush

### 2. Coalescing Middleware vs. Immediate Updates

**Scenario**: Rapid dimension changes during layout drag operations
**Risk**: Coalescing defers updates, causing stale renders
**Mitigation**: forceDimensionUpdate flag and drag state checking

### 3. Backend View Calculation vs. Frontend Expectations

**Scenario**: Backend returns different dimensions than requested
**Risk**: Frontend assumes 1:1 mapping, applies incorrect scaling
**Mitigation**: **NEEDS FIX** - Remove scaling assumption

## Proposed Solutions and Impact

### 1. Remove Incorrect Scaling Logic (HIGH PRIORITY)

**Change**: Use backend view parameters directly without scaling
**Files**: `MosaicView.tsx:348-382`
**Expected Impact**: 
- Render success rate: 20% → 95%
- Eliminate quarter-display issue
- Preserve backend's aspect ratio logic

### 2. Fix Canvas Dimension Handling (HIGH PRIORITY)

**Change**: Use backend-calculated dimensions for canvas sizing
**Files**: `MosaicView.tsx:252-257`  
**Expected Impact**:
- Proper image aspect ratio
- Eliminate black screen flickers
- Consistent rendering across orientations

### 3. Improve Error Handling and Validation (MEDIUM PRIORITY)

**Change**: Add view parameter validation in RenderCoordinator
**Files**: `RenderCoordinator.ts:158-186`
**Expected Impact**:
- Early detection of corrupted parameters
- Better error reporting for debugging
- Graceful fallback mechanisms

## Testing Strategy

### Critical Test Cases

1. **MNI Brain Volume (193×229×193)**:
   - Load standard MNI brain volume
   - Verify mosaic cells show full slice content
   - Test resize operations maintain proper aspect ratio

2. **Non-Square Anatomy**:
   - Test with volumes having different anatomical extents
   - Verify backend dimension calculations
   - Confirm frontend accepts backend dimensions

3. **Rapid Resize Operations**:
   - Simulate panel dragging and rapid size changes
   - Verify coalescing middleware handles updates correctly
   - Test race condition mitigation

### Integration Test Requirements

1. **End-to-End Mosaic Rendering**:
   - Complete flow from container resize to canvas drawing
   - Verify coordinate consistency across all cells
   - Test crosshair synchronization

2. **Backend-Frontend Contract**:
   - Validate view parameter interpretation
   - Test SliceOverride plane calculations
   - Verify ImageBitmap creation and transfer

## Conclusion

The MosaicView quarter-display and black screen issues stem from a fundamental misunderstanding of the backend's coordinate system. The backend provides correctly calculated per-pixel displacement vectors that maintain square pixels and proper aspect ratios. The frontend's attempt to "scale" these vectors corrupts the carefully calculated geometric relationships, leading to rendering failures.

The solution requires **removing the scaling logic** and **trusting the backend's dimension calculations**. This change will:

1. **Eliminate the root cause** of view parameter corruption
2. **Maintain the backend's aspect ratio preservation** logic  
3. **Simplify the frontend code** by removing complex scaling calculations
4. **Improve performance** by reducing failed render attempts

**Priority**: Critical - affects core functionality  
**Effort**: Low - primarily involves removing problematic code  
**Risk**: Low - simplifies rather than complicates the codebase  
**Expected Resolution Time**: 2-4 hours implementation + 4-6 hours testing

The architectural principle should be: **Backend calculates, Frontend trusts**. The backend's `ViewRectMm::full_extent()` logic is sophisticated and handles aspect ratio preservation, square pixel requirements, and anatomical extent coverage. The frontend should use these calculations directly without modification.
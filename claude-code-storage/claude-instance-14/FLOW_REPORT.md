# MosaicView Rendering Flow Analysis Report

## Executive Summary

The MosaicView component has several critical issues that cause incorrect rendering behavior:

1. **Shared ViewState Crosshair Position**: All cells modify the same crosshair position, causing them to render the same slice
2. **Cascading ResizeObserver Updates**: Individual cell ResizeObservers trigger re-renders on mouse movement
3. **Canvas Sizing Issues**: Direct state-based sizing causes rendering glitches
4. **Excessive Re-render Dependencies**: All cells re-render when any ViewState property changes

## Complete Execution Flow

### 1. Initial Render Flow

```
MosaicView Component Mount
├── Initialize state (rows=3, columns=3, orientation='axial')
├── Create container ResizeObserver → tracks container dimensions
├── Fetch volume bounds from API
│   └── apiService.getVolumeBounds(volumeId)
├── Calculate grid layout
│   ├── Cell dimensions: (containerWidth - padding) / columns
│   └── Total slices and pagination
└── Pre-calculate views for all cells
    └── For each slice position:
        ├── Create cache key: `${orientation}-${position}-${width}x${height}`
        └── apiService.recalculateViewForDimensions()
```

### 2. Cell Rendering Flow (Per MosaicCell)

```
MosaicCell Component
├── Initialize ResizeObserver (ISSUE: Per-cell observer)
│   └── Updates local dimensions state → triggers re-render
├── useEffect for rendering (line 112)
│   ├── Creates modified ViewState (CRITICAL ISSUE)
│   │   ├── Clones current viewState
│   │   └── Modifies crosshair.world_mm[axisIndex] = slicePosition
│   │       └── All cells share same viewState reference!
│   ├── Calls RenderCoordinator.requestRender()
│   │   ├── viewState: modifiedViewState
│   │   ├── viewType: orientation
│   │   ├── width/height: cell dimensions
│   │   └── reason: 'layer_change'
│   └── Draws result to canvas
└── Canvas element with inline styles (ISSUE)
    └── style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px` }}
```

### 3. RenderCoordinator Processing

```
RenderCoordinator.requestRender()
├── Creates QueuedJob with unique ID
├── Handles debouncing for resize operations (200ms)
├── Enqueues job (immediate for non-resize)
│   └── Collapse strategy: removes older jobs of same type
└── processQueue()
    └── executeRenderJob()
        ├── apiService.applyAndRenderViewStateCore()
        │   ├── Filters visible layers
        │   ├── Formats declarativeViewState
        │   ├── Scales view vectors for GPU
        │   └── Invokes backend render command
        └── Returns ImageBitmap
```

### 4. Backend Communication Flow

```
apiService.applyAndRenderViewStateCore()
├── Validates render state
├── Formats ViewState for backend
│   ├── Maps layers with proper field names
│   └── Scales view vectors: u_mm * width, v_mm * height
├── Choose render path:
│   ├── Raw RGBA: apply_and_render_view_state_raw
│   └── PNG: apply_and_render_view_state
└── Process response
    ├── Raw RGBA: Direct Uint8Array → ImageBitmap
    └── PNG: Decode → ImageBitmap
```

### 5. Event Propagation Issues

```
Mouse Movement Over MosaicView
├── Browser layout recalculation
├── ResizeObserver callbacks fire (ALL cells)
│   └── setDimensions() → state update → re-render
├── All cells re-render due to viewState dependency
│   └── Each cell modifies shared crosshair position
└── Last cell to render determines slice for ALL cells
```

### 6. Critical Race Condition

The root cause of all cells showing the same slice:

```javascript
// MosaicCell line 152-153
const axisIndex = orientation === 'axial' ? 2 : orientation === 'sagittal' ? 0 : 1;
modifiedViewState.crosshair.world_mm[axisIndex] = slicePosition;
```

**Timeline:**
1. Cell 1 renders: sets crosshair Z to slice 1 position
2. Cell 2 renders: sets crosshair Z to slice 2 position
3. Cell 3 renders: sets crosshair Z to slice 3 position
4. ...
5. Cell 9 renders: sets crosshair Z to slice 9 position
6. ALL cells use the last crosshair position (slice 9)!

### 7. Comparison with OrthogonalView

**OrthogonalView (Working Correctly):**
- Uses FlexibleSlicePanel → SliceView
- Single view per orientation
- Doesn't modify crosshair for rendering
- Centralized ResizeObserver in FlexibleSlicePanel
- Throttled dimension updates (30ms)
- Coalescing middleware prevents render storms

**MosaicView (Broken):**
- Multiple cells per orientation
- Each cell modifies shared crosshair
- Per-cell ResizeObservers
- No throttling or debouncing
- Direct state updates trigger cascading re-renders

### 8. Canvas Rendering Flow

```
MosaicCell Canvas Rendering
├── Calculate aspect ratios
├── Determine fit mode (width vs height)
├── Draw image with placement tracking
├── Store placement for coordinate transforms
└── Draw crosshair overlay (if visible)
    └── Uses placement info for accurate positioning
```

### 9. Coordinate Transform Flow

```
Mouse Click on MosaicCell
├── Get canvas coordinates from event
├── Check if within image bounds (using placement)
├── Transform to image coordinates
│   └── (canvasX - placement.x) / placement.width * imageWidth
├── Transform to world coordinates
│   └── CoordinateTransform.screenToWorld()
└── Update crosshair via SliceNavigationService
```

### 10. Grid Layout Resizing Cascade

```
Mouse Movement Trigger
├── Browser recalculates layout (grid CSS)
├── Container ResizeObserver fires
│   └── Updates container dimensions
├── Each cell's ResizeObserver fires
│   └── 9 separate state updates!
├── React re-renders all cells
│   └── Each render modifies crosshair
└── Visual glitches and incorrect slices
```

## Key Architectural Differences

### Successful Pattern (OrthogonalView)
1. **Centralized State Management**: Single view state per orientation
2. **Throttled Updates**: 30ms throttle prevents render storms
3. **Coalescing Middleware**: Batches rapid updates
4. **Stable References**: No modification of shared state
5. **Efficient ResizeObserver**: One observer at container level

### Failed Pattern (MosaicView)
1. **Shared State Mutation**: All cells modify same crosshair
2. **No Update Throttling**: Every resize triggers immediate render
3. **Multiple ResizeObservers**: 9+ observers firing independently
4. **Unstable Dependencies**: viewState in effect dependencies
5. **Direct State Binding**: Canvas size directly tied to state

## Root Cause Analysis

### Primary Issue: Crosshair Position Modification
The fundamental flaw is that each MosaicCell modifies the shared viewState crosshair position to render its specific slice. This creates a race condition where the last cell to render determines the slice position for all cells.

### Secondary Issues:
1. **ResizeObserver Cascade**: Individual observers per cell create a multiplication effect
2. **Canvas Sizing**: Inline styles tied to state cause layout recalculations
3. **Missing Render Coordination**: No batching or caching of slice renders
4. **Excessive Dependencies**: Re-renders triggered by unrelated state changes

## Recommended Architecture

### 1. Slice-Specific Rendering
Instead of modifying crosshair, pass slice position directly to render:
```javascript
// Add to RenderRequest interface
interface RenderRequest {
  // ... existing fields
  sliceOverride?: {
    axis: 'x' | 'y' | 'z';
    position: number;
  };
}
```

### 2. Centralized Grid Management
Move all grid logic to parent:
- Single ResizeObserver on container
- Calculate all cell dimensions at parent level
- Pass dimensions as props to cells
- Remove individual cell ResizeObservers

### 3. Render Caching
Implement slice-level caching:
- Cache rendered ImageBitmaps by slice position
- Reuse cached images when possible
- Clear cache on data changes

### 4. Stable Render Loop
Follow OrthogonalView pattern:
- Use throttled updates
- Leverage coalescing middleware
- Minimize effect dependencies

## Conclusion

The MosaicView regression is caused by a fundamental architectural mismatch where multiple cells share and modify the same global state. The solution requires decoupling slice position from crosshair position and implementing proper render coordination similar to the successful OrthogonalView pattern.
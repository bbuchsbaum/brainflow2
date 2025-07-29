# MosaicView Rendering Flow Analysis

## Executive Summary

The MosaicView component has two critical issues:
1. **View Calculation Issue**: MosaicCell uses the global view parameters without recalculating for its smaller dimensions, causing only the upper-left part of the brain to be visible.
2. **Slice Position Issue**: Modifying only the crosshair position doesn't change the actual slice being rendered - the view's origin_mm must be adjusted.

## 1. MosaicCell Rendering Process

### 1.1 Props Flow
```typescript
MosaicView → MosaicCell:
- orientation: ViewType (axial/sagittal/coronal)
- slicePosition: number (position in mm along the slice axis)
- width: number (calculated as containerWidth / columns)
- height: number (calculated as containerHeight / rows)
```

### 1.2 Render Trigger Flow
```
MosaicCell.useEffect[viewState, orientation, slicePosition, width, height]
  ↓
Creates modifiedViewState (PROBLEM: only modifies crosshair)
  ↓
renderCoordinator.requestRender({
  viewState: modifiedViewState,
  viewType: orientation,
  width, height,
  reason: 'layer_change',
  priority: 'normal'
})
  ↓
Returns ImageBitmap → Canvas drawing
```

## 2. ViewState Calculation and Modification

### 2.1 Current Implementation (INCORRECT)
```typescript
// MosaicCell lines 46-56
const modifiedViewState: ViewState = {
  ...viewState,
  crosshair: {
    ...viewState.crosshair,
    world_mm: [...viewState.crosshair.world_mm]
  }
};
const axisIndex = orientation === 'axial' ? 2 : orientation === 'sagittal' ? 0 : 1;
modifiedViewState.crosshair.world_mm[axisIndex] = slicePosition;
```

**Problems:**
- Only modifies crosshair position
- Uses global viewState.views[orientation] which has dimensions for the main view panels
- Doesn't recalculate view parameters for the smaller cell dimensions

### 2.2 What Should Happen
The MosaicCell needs to:
1. Calculate proper view parameters for its dimensions
2. Adjust the view origin to show the correct slice
3. Ensure uniform pixel size to maintain aspect ratio

## 3. RenderCoordinator Flow

### 3.1 Request Processing
```
requestRender(request)
  ↓
Create QueuedJob
  ↓
enqueueWithDebounce (if resize) OR enqueueImmediate
  ↓
processQueue()
  ↓
executeRenderJob(job)
  ↓
apiService.applyAndRenderViewStateCore(
  job.viewState,
  job.viewType,
  job.width,
  job.height
)
```

### 3.2 Key Issue in apiService
```typescript
// apiService.ts lines 151-171
declarativeViewState.requestedView = {
  type: viewType,
  origin_mm: [...view.origin_mm, 1.0],  // Uses global view origin
  u_mm: [
    view.u_mm[0] * width,  // Scales by cell width
    view.u_mm[1] * width,
    view.u_mm[2] * width,
    0.0
  ],
  v_mm: [
    view.v_mm[0] * height,  // Scales by cell height
    view.v_mm[1] * height,
    view.v_mm[2] * height,
    0.0
  ],
  width,
  height
};
```

**Problem**: The view vectors (u_mm, v_mm) from the global viewState are sized for the main panels (e.g., 512x512), not the smaller mosaic cells (e.g., 250x180).

## 4. FlexibleSlicePanel's Correct Approach

### 4.1 Dimension Update Flow
```
ResizeObserver → dimension change detected
  ↓
throttledUpdateDimensions(width, height)
  ↓
viewStateStore.updateDimensionsAndPreserveScale(viewId, [width, height])
  ↓
apiService.recalculateViewForDimensions(
  volumeId,
  viewType,
  [newWidth, newHeight],
  crosshair.world_mm
)
  ↓
Backend calculates proper view parameters
  ↓
Updates viewState with new view parameters
```

### 4.2 Backend Recalculation
The backend's `recalculateViewForDimensions` ensures:
- Full anatomical extent is visible
- Uniform pixel size (maintains aspect ratio)
- View is centered on the current position

## 5. Root Cause Analysis

### 5.1 View Dimension Mismatch
```
Global view (main panels): 512x512 pixels
MosaicCell: ~250x180 pixels (depends on grid size)

When using global view vectors with smaller dimensions:
- Only a portion of the anatomical extent is visible
- The portion shown is the upper-left because origin_mm stays the same
```

### 5.2 Slice Position Not Working
```
Current: Modifies crosshair position only
Problem: The renderer uses the view plane definition, not crosshair
Solution: Must adjust origin_mm based on slice position
```

## 6. Required Fixes

### 6.1 Calculate Per-Cell View Parameters
```typescript
// Option 1: Use backend recalculation (preferred)
const cellView = await apiService.recalculateViewForDimensions(
  volumeId,
  orientation,
  [width, height],
  [x, y, slicePosition]  // Position at the desired slice
);

// Option 2: Frontend calculation
const cellView = calculateCellView(
  orientation,
  slicePosition,
  width,
  height,
  anatomicalBounds
);
```

### 6.2 Adjust View Origin for Slice Position
```typescript
function calculateCellView(orientation, slicePosition, width, height, bounds) {
  // Calculate extent
  let widthMm, heightMm;
  switch (orientation) {
    case 'axial':
      widthMm = bounds.max[0] - bounds.min[0];
      heightMm = bounds.max[1] - bounds.min[1];
      break;
    // ... other orientations
  }
  
  // Uniform pixel size
  const pixelSize = Math.max(widthMm / width, heightMm / height);
  
  // Calculate origin based on slice position
  let origin_mm;
  switch (orientation) {
    case 'axial':
      origin_mm = [
        bounds.min[0],  // Left edge
        bounds.max[1],  // Top edge (anterior)
        slicePosition   // At the desired slice
      ];
      break;
    // ... other orientations
  }
  
  return {
    origin_mm,
    u_mm: [pixelSize, 0, 0],  // Per-pixel, not total
    v_mm: [0, -pixelSize, 0],
    dim_px: [width, height]
  };
}
```

### 6.3 Modified ViewState Creation
```typescript
const modifiedViewState: ViewState = {
  ...viewState,
  views: {
    ...viewState.views,
    [orientation]: cellView  // Use calculated view for this cell
  }
};
```

## 7. Implementation Strategy

1. **Add volume bounds tracking** to MosaicView to enable view calculations
2. **Calculate per-cell views** either via backend or frontend calculation
3. **Modify the view in ViewState**, not just the crosshair
4. **Consider caching** calculated views to avoid recalculating for every render

## 8. Performance Considerations

- Backend recalculation adds latency but ensures correctness
- Frontend calculation is faster but must match backend logic exactly
- Consider pre-calculating all cell views when grid size changes
- Cache ImageBitmaps for cells showing the same slice across renders
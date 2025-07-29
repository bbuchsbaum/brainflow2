# MosaicView Investigation Report

## Problem Summary
The MosaicView component is showing only the upper left part of the brain in each grid cell, and all cells display the same slice despite having different position labels.

## Key Findings

### 1. View Dimension Calculation Issue in MosaicCell

**Problem:** The MosaicCell component is not calculating proper view dimensions that show the full anatomical extent.

In `MosaicView.tsx`, the MosaicCell component:
- Receives fixed `width` and `height` parameters (lines 26-28, passed at line 251-252)
- These dimensions are calculated from the container size divided by grid dimensions (lines 132-133)
- However, it directly passes these dimensions to the RenderCoordinator without considering the anatomical extent

**Root Cause:** The MosaicCell is using the container pixel dimensions directly without:
1. Calculating the proper view plane parameters (origin, u_mm, v_mm) to show the full anatomical extent
2. Using the backend's `recalculateViewForDimensions` to get proper view parameters

### 2. ViewState Modification Not Working Properly

**Problem:** The slice position modification is not effective (lines 46-56 in MosaicCell).

The code attempts to modify the crosshair position:
```typescript
const modifiedViewState: ViewState = {
  ...viewState,
  crosshair: {
    ...viewState.crosshair,
    world_mm: [...viewState.crosshair.world_mm] as [number, number, number]
  }
};
// Update the appropriate axis based on orientation
const axisIndex = orientation === 'axial' ? 2 : orientation === 'sagittal' ? 0 : 1;
modifiedViewState.crosshair.world_mm[axisIndex] = slicePosition;
```

**Issues:**
1. Only modifying the crosshair position doesn't change the actual slice being rendered
2. The view's `origin_mm` needs to be adjusted to show different slices
3. The backend render expects proper view plane parameters in the `requestedView` field

### 3. Missing View Plane Calculation

**Comparison with FlexibleSlicePanel:**
- FlexibleSlicePanel uses `updateDimensionsAndPreserveScale` (line 44, 87) which calls the backend's `recalculateViewForDimensions`
- This ensures the view shows the full anatomical extent with proper scaling
- MosaicCell doesn't use this mechanism at all

**What FlexibleSlicePanel does right:**
1. Uses ResizeObserver to track dimension changes
2. Calls `updateDimensionsAndPreserveScale` which:
   - Requests backend to recalculate view parameters for new dimensions
   - Ensures uniform pixel size (maintains aspect ratio)
   - Centers the view on the current crosshair position

### 4. Backend Render Request Issues

In `apiService.ts` (lines 194-206), the render request includes:
```typescript
declarativeViewState.requestedView = {
  type: viewType,
  origin_mm: [...view.origin_mm, 1.0],
  u_mm: [
    view.u_mm[0] * width,
    view.u_mm[1] * width,
    view.u_mm[2] * width,
    0.0
  ],
  v_mm: [
    view.v_mm[0] * height,
    view.v_mm[1] * height,
    view.v_mm[2] * height,
    0.0
  ],
  width,
  height
};
```

**Problem:** MosaicCell is using the global viewState's view parameters, which are sized for the main view panels, not the smaller mosaic cells.

### 5. Coordinate Transform Issues

The `coordinates.ts` utility has `createOrthogonalViews` (lines 105-140) that properly:
- Calculates uniform pixel size: `Math.max(extentX / dimX, extentY / dimY)`
- Centers views on a given position
- Maintains square pixels

**MosaicCell should use this or similar logic to create properly sized views for each cell.**

## Root Causes

1. **No View Recalculation:** MosaicCell doesn't recalculate view parameters for its smaller dimensions
2. **Wrong View Origin:** The slice position change only modifies crosshair, not the view plane origin
3. **Aspect Ratio Issue:** Using global view parameters in smaller cells causes incorrect scaling
4. **Missing Backend Integration:** Not using `recalculateViewForDimensions` like FlexibleSlicePanel does

## Recommended Solutions

1. **Calculate Per-Cell View Parameters:**
   - Use the backend's `recalculateViewForDimensions` for each cell
   - Or implement frontend calculation similar to `createOrthogonalViews`

2. **Modify View Origin for Slice Position:**
   - Calculate new origin_mm based on slice position
   - Update the view plane to show the correct slice

3. **Maintain Proper Aspect Ratio:**
   - Calculate uniform pixel size for the cell dimensions
   - Ensure full anatomical extent is visible

4. **Create Custom ViewState per Cell:**
   - Don't just modify crosshair
   - Create a complete view specification for each cell's slice and dimensions

## Technical Details

The backend expects view parameters where:
- `origin_mm`: Top-left corner of the view in world coordinates
- `u_mm`: Per-pixel displacement vector for horizontal movement
- `v_mm`: Per-pixel displacement vector for vertical movement
- These vectors are scaled by width/height when sent to the shader

For proper rendering, each MosaicCell needs its own calculated view parameters that:
1. Show the full anatomical extent
2. Are centered on the correct slice position
3. Use uniform pixel size to maintain aspect ratio
4. Match the cell's actual pixel dimensions
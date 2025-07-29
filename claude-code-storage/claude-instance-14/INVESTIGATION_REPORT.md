# MosaicView Regression Investigation Report

## Summary
The MosaicView component has several implementation issues that cause:
1. All cells showing the same slice position
2. Grid cells resizing on mouse movement
3. Only top-left quarter of slices being shown initially

## Root Causes Identified

### 1. Shared ViewState Crosshair Position (Primary Issue)
**Location**: `MosaicView.tsx`, lines 126-154

The main issue is that all MosaicCell components are modifying and sharing the same crosshair position:
```typescript
// Line 152-153
const axisIndex = orientation === 'axial' ? 2 : orientation === 'sagittal' ? 0 : 1;
modifiedViewState.crosshair.world_mm[axisIndex] = slicePosition;
```

**Problem**: When multiple cells render, they all update the same viewState crosshair position, causing all cells to render the same slice (the last one that rendered).

### 2. ResizeObserver in MosaicCell Triggering Re-renders
**Location**: `MosaicView.tsx`, lines 58-72

Each MosaicCell has its own ResizeObserver that updates dimensions state:
```typescript
const resizeObserver = new ResizeObserver((entries) => {
  const entry = entries[0];
  if (entry) {
    const { width, height } = entry.contentRect;
    setDimensions({ width: Math.floor(width), height: Math.floor(height) });
  }
});
```

**Problem**: Mouse movement can trigger layout recalculations, which trigger ResizeObserver callbacks, causing dimension state updates and re-renders. This creates a cascade effect across all cells.

### 3. Canvas Sizing Issues
**Location**: `MosaicView.tsx`, lines 296-301

The canvas element is using inline styles that directly tie to state:
```typescript
<canvas
  ref={canvasRef}
  width={dimensions.width}
  height={dimensions.height}
  style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px` }}
  onClick={handleCanvasClick}
/>
```

**Problem**: The canvas dimensions are set both as attributes and CSS styles using the same values, which can cause rendering issues when the container size doesn't match exactly.

### 4. Dependency Array Issues
**Location**: `MosaicView.tsx`, line 277

The render effect has too many dependencies including `viewState`:
```typescript
}, [viewState, orientation, slicePosition, dimensions, renderCoordinator, cellView, isActive, isHovered, isClickSource]);
```

**Problem**: Any change to viewState (including crosshair updates from other cells) triggers re-renders of all cells.

## Key Differences from OrthogonalView

1. **OrthogonalView (SliceView)**: 
   - Uses a single view per orientation
   - Doesn't modify crosshair position for rendering
   - Renders based on current viewState without modification
   - Has stable render loop managed by coalescing middleware

2. **MosaicView**: 
   - Creates modified viewStates for each cell
   - Updates crosshair position per cell (causing conflicts)
   - Each cell manages its own dimensions and rendering
   - No coordination between cells

## Recommended Fixes

### 1. Fix Crosshair Position Modification
Instead of modifying the viewState crosshair, the slice position should be passed directly to the render call or the view should be calculated with the correct slice position without modifying the global state.

### 2. Stabilize ResizeObserver
- Move ResizeObserver to the grid container level
- Calculate cell dimensions at the parent level and pass down as props
- Remove individual cell ResizeObservers

### 3. Fix Canvas Sizing
- Remove inline styles or use CSS-only sizing
- Let the canvas scale to fit its container using CSS
- Only set canvas buffer dimensions as attributes

### 4. Optimize Re-render Dependencies
- Remove viewState from cell render dependencies
- Pass only necessary slice-specific data as props
- Use memoization for expensive calculations

### 5. Coordinate Rendering
- Implement a MosaicRenderCoordinator similar to RenderCoordinator
- Batch render requests for all visible cells
- Cache rendered slices to avoid re-rendering on hover

## Testing Notes

The issue can be reproduced by:
1. Loading a volume
2. Opening mosaic view
3. Observing that all cells show the same slice
4. Moving mouse over cells and seeing grid resize

The fix should ensure:
- Each cell shows a different slice position
- Grid remains stable during mouse movements
- Full slice is visible (not just top-left quarter)
- Performance is acceptable with 9+ cells
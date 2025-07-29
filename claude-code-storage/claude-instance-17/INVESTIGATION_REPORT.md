# MosaicView Component Investigation Report

## Executive Summary

The MosaicView component has been significantly refactored from its original implementation, introducing changes to navigation logic and slice position calculations that appear to be causing both the page navigation issues and the MosaicCell rendering failures.

## Issues Identified

### 1. Page Navigation Not Working Properly

#### Root Cause Analysis

The new implementation has changed from a page-based navigation model to a continuous slice window model:

**Original Implementation (backup file):**
```typescript
// Page-based navigation
const [currentPage, setCurrentPage] = useState(0);
const startSliceIndex = currentPage * gridSize;
const endSliceIndex = Math.min(startSliceIndex + gridSize, totalSlices);

// Navigation buttons
<button onClick={() => handlePageChange(currentPage - 1)}>← Prev</button>
<button onClick={() => handlePageChange(currentPage + 1)}>Next →</button>
```

**Current Implementation:**
```typescript
// Continuous slice window
const [firstSliceIdx, setFirstSliceIdx] = useState(0);
const firstSliceIdxMax = Math.max(0, allSlices.length - gridSize);

// Navigation buttons now increment by gridSize
const handlePageChange = (delta: number) => {
  setFirstSliceIdx(idx => clamp(idx + delta * gridSize, 0, firstSliceIdxMax));
};
```

**Issue:** The UI still displays "Slice X / Y" instead of "Page X of Y", causing confusion. The prev/next buttons are technically working but the visual feedback doesn't match the user's mental model of page navigation.

### 2. MosaicCell Rendering Failures

#### Root Cause Analysis

Multiple factors contribute to the rendering failures:

**a) Backend Dimension Validation:**
The MosaicCell now validates against backend dimensions before rendering:
```typescript
const backendDimensions = viewState.views[orientation]?.dim_px;
if (!backendDimensions || backendDimensions[0] <= 0 || backendDimensions[1] <= 0) {
  console.error('[MosaicCell] Invalid backend dimensions:', backendDimensions);
  return;
}
```

**b) Canvas Size Mismatch:**
The canvas element is set to backend dimensions, not the cell dimensions passed from parent:
```typescript
<canvas
  ref={canvasRef}
  width={viewState.views[orientation].dim_px[0]}  // Backend dimension
  height={viewState.views[orientation].dim_px[1]} // Backend dimension
  style={{
    width: '100%',
    height: '100%',
    objectFit: 'contain'
  }}
/>
```
This creates a mismatch between the requested render size and the actual canvas size.

**c) View State Update Race Condition:**
The mosaic view updates a single shared view state that all cells use:
```typescript
// Single view update function - comment explains the issue:
// "The key insight: all mosaic cells share the same view state (e.g., viewState.views.axial)
// but show different slices via sliceOverride."
```

This can cause race conditions where cells try to render before the view state is properly initialized.

### 3. Edge Cases Around Slice Range Boundaries

#### Analysis

The slice range calculation has potential edge cases:

**a) Slice Position Generation:**
```typescript
const makeAscending = (min: number, max: number, step: number) => {
  const safeStep = Math.abs(step) || 1;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const list: number[] = [];
  for (let v = lo; v <= hi; v += safeStep) list.push(v);
  return list;
};
```
This assumes positive steps and may not handle negative slice ranges correctly.

**b) Crosshair Position Checking:**
```typescript
// Only show crosshair if it's within this slice's range
if (Math.abs(crosshairSlicePos - slicePosition) < sliceThickness / 2) {
  // Draw crosshair
}
```
The hardcoded slice thickness of 2.0mm may not match actual slice spacing.

## Specific Problems in Current Implementation

### 1. Architectural Change Without UI Update
- Backend uses a window-based approach for performance
- UI still shows page-based terminology
- User expects page navigation but gets slice window sliding

### 2. Dimension Management Issues
- Parent calculates cell dimensions based on available space
- Backend calculates view dimensions independently  
- Canvas uses backend dimensions but is styled to fit cell dimensions
- This creates multiple sources of truth for dimensions

### 3. Missing Error Handling
- No fallback when backend dimensions are invalid
- No retry logic for failed renders
- Silent failures in some code paths

### 4. SliceOverride Implementation
The sliceOverride mechanism modifies both the crosshair position AND the view plane origin:
```typescript
if (sliceOverride && viewType) {
  // Modifies crosshair position
  newWorldMm[axisIndex] = sliceOverride.position;
  
  // ALSO modifies view plane origin
  const newOrigin = [
    currentView.origin_mm[0] + normal[0] * sliceDelta,
    currentView.origin_mm[1] + normal[1] * sliceDelta,
    currentView.origin_mm[2] + normal[2] * sliceDelta
  ];
}
```
This double modification might cause rendering issues at slice boundaries.

## Recommendations

### Immediate Fixes

1. **Fix Navigation Display:**
   - Update UI to show "Slices X-Y of Z" instead of "Slice X / Y"
   - Or revert to page-based navigation model

2. **Fix Canvas Dimension Mismatch:**
   - Either use cell dimensions for canvas size
   - Or ensure render request matches backend dimensions

3. **Add Proper Error Recovery:**
   - Retry render on failure
   - Show placeholder image on persistent failures
   - Log more detailed error context

### Longer Term Improvements

1. **Simplify Dimension Management:**
   - Single source of truth for dimensions
   - Clear separation between display size and render size

2. **Improve SliceOverride:**
   - Only modify crosshair position, not view origin
   - Let backend handle view plane calculations

3. **Better State Management:**
   - Consider per-cell view states for mosaic
   - Or implement proper view state caching

## Conclusion

The MosaicView refactoring introduced a more sophisticated sliding window approach but didn't fully update the UI metaphors or handle edge cases properly. The dimension mismatch between parent-calculated cell sizes and backend-calculated view sizes is likely the primary cause of rendering failures.

The navigation appears broken because it's working differently than users expect - it's sliding a window over slices rather than paging through groups, but the UI still suggests page-based navigation.
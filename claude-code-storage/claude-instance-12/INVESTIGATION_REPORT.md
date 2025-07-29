# Investigation Report: MosaicView Issues

## Executive Summary

This report investigates three main issues with the MosaicView component:
1. **Slices are left-aligned despite centering attempts**
2. **Cells don't grow/resize responsively when app resizes**
3. **Crosshair positioning on mouse click is not implemented**

## Issue 1: Slices Left-Aligned Despite Centering

### Root Cause Analysis

The MosaicCell component (lines 195-227) appears to have proper flexbox centering setup:
```jsx
<div className="relative w-full h-full flex items-center justify-center overflow-hidden rounded">
  <canvas
    ref={canvasRef}
    width={width}
    height={height}
    style={{ width: `${width}px`, height: `${height}px` }}
  />
</div>
```

However, the canvas element has **fixed inline styles** that override the flexbox centering:
```jsx
style={{ width: `${width}px`, height: `${height}px` }}
```

This forces the canvas to be exactly the specified size, preventing flexbox from centering it within the container. The canvas is drawing the image with aspect ratio preservation (lines 102-127), but the canvas itself remains at full cell size, causing the appearance of left-alignment.

### Comparison with SliceView

SliceView (lines 553-563) uses a different approach:
```jsx
<div className="w-full h-full flex items-center justify-center">
  <canvas
    ref={canvasRef}
    width={canvasWidth || validWidth}
    height={canvasHeight || validHeight}
    className={`block border border-gray-300 cursor-crosshair ${isDragging ? 'border-blue-500 border-2' : ''}`}
    // No inline style forcing width/height
  />
</div>
```

SliceView doesn't force the canvas size with inline styles, allowing the flexbox centering to work properly.

## Issue 2: Non-Responsive Cell Sizing

### Current Implementation Problems

1. **Fixed Cell Dimensions** (lines 273-274):
   ```javascript
   const cellWidth = Math.floor((containerWidth - 40 - (columns - 1) * 8) / columns);
   const cellHeight = Math.floor((containerHeight - 100 - (rows - 1) * 8) / rows);
   ```
   These are calculated once based on initial container dimensions and never update.

2. **Static Canvas Size**:
   - Canvas dimensions are fixed at creation time
   - No ResizeObserver or responsive mechanism to update when container resizes

3. **Pre-calculated Views** (lines 308-351):
   - Views are calculated once for specific dimensions
   - Cached based on fixed dimensions
   - No mechanism to recalculate when container resizes

### FlexibleOrthogonalView's Responsive Approach

FlexibleOrthogonalView and FlexibleSlicePanel implement proper responsive sizing:

1. **ResizeObserver** (FlexibleSlicePanel lines 103-147):
   ```javascript
   const resizeObserver = new ResizeObserver((entries) => {
     const entry = entries[0];
     if (entry) {
       const { width, height } = entry.contentRect;
       // Update dimensions and trigger re-render
       throttledUpdateDimensions(clampedWidth, clampedHeight);
     }
   });
   ```

2. **Throttled Updates** (lines 29-56):
   - Dimensions are updated with throttling to prevent excessive re-renders
   - Backend is notified to recalculate views for new dimensions

3. **Dynamic View Recalculation**:
   - Uses `updateDimensionsAndPreserveScale` to maintain aspect ratio
   - Backend recalculates the view plane for new dimensions

## Issue 3: Missing Mouse Click Handling for Crosshair

### Current Implementation

MosaicCell has a simple onClick handler on the outer div (line 199):
```jsx
onClick={onClick}
```

This calls `handleSliceClick` (lines 363-372) which only updates the slice position, not the exact click location:
```javascript
const handleSliceClick = (slicePosition: number) => {
  const currentCrosshair = [...viewState.crosshair.world_mm];
  const axisIndex = orientation === 'axial' ? 2 : orientation === 'sagittal' ? 0 : 1;
  currentCrosshair[axisIndex] = slicePosition;
  sliceNavService.setWorldPosition(currentCrosshair[0], currentCrosshair[1], currentCrosshair[2]);
};
```

**Problems:**
- Click is on the cell div, not the canvas
- No coordinate transformation from mouse position to world coordinates
- Only updates the slice axis, not the exact click position

### SliceView's Proper Implementation

SliceView implements proper mouse click handling (lines 209-260):

1. **Canvas Click Handler**:
   ```javascript
   onClick={handleMouseClick}  // On the canvas element
   ```

2. **Coordinate Transformation**:
   ```javascript
   // Convert click to canvas coordinates
   const canvasX = (event.clientX - rect.left) * scaleX;
   const canvasY = (event.clientY - rect.top) * scaleY;
   
   // Transform to image coordinates
   const imageX = (canvasX - placement.x) / placement.width * placement.imageWidth;
   const imageY = (canvasY - placement.y) / placement.height * placement.imageHeight;
   
   // Transform to world coordinates
   const worldCoord = CoordinateTransform.screenToWorld(imageX, imageY, viewPlane);
   ```

3. **Crosshair Update**:
   ```javascript
   await setCrosshair(worldCoord, true);
   ```

## Crosshair Display Requirements

Current implementation shows crosshair with different alpha values:
- **Active/Hovered cells**: alpha = 1.0 (opaque)
- **Other cells**: alpha = 0.2 (semi-transparent)

This is implemented in MosaicCell (lines 162-163):
```javascript
ctx.globalAlpha = isActive || isHovered ? 1.0 : 0.2;
```

## Recommendations

### 1. Fix Canvas Centering
- Remove fixed inline styles from canvas element
- Let canvas size be determined by the image content
- Use CSS classes for proper flexbox centering

### 2. Implement Responsive Sizing
- Add ResizeObserver to MosaicView container
- Recalculate cell dimensions on resize
- Update canvas dimensions dynamically
- Invalidate view cache and recalculate views for new dimensions

### 3. Implement Proper Mouse Click Handling
- Move click handler from cell div to canvas element
- Implement coordinate transformation pipeline:
  - Mouse position → Canvas coordinates
  - Canvas coordinates → Image coordinates  
  - Image coordinates → World coordinates
- Update crosshair to exact click position, not just slice position

### 4. Consider Performance Optimizations
- Implement view caching with dimension-aware keys
- Use throttled resize updates
- Consider lazy loading for off-screen cells
- Implement view pooling for better performance

## Technical Dependencies

The fixes will require:
1. **CoordinateTransform** utility for proper coordinate transformations
2. **ResizeObserver** for responsive behavior
3. **Throttling/debouncing** utilities for performance
4. **Backend API** calls to recalculate views on resize
5. **View caching** mechanism that's dimension-aware
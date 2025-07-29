# Implementation Plan: Fix MosaicView Issues

## Overview

This plan addresses three critical issues in the MosaicView component:
1. Canvas centering failure due to fixed inline styles
2. Non-responsive cell sizing when app resizes
3. Missing mouse click handling for precise crosshair positioning

The solution follows patterns established in FlexibleOrthogonalView, ensuring consistency across the codebase.

## Phase 1: Fix Canvas Centering (Immediate Fix)

### Root Cause
Canvas elements have fixed inline styles that override flexbox centering:
```jsx
style={{ width: `${width}px`, height: `${height}px` }}
```

### Solution Steps

#### 1.1 Update MosaicCell Canvas Rendering
**File**: `ui2/src/components/views/MosaicView.tsx` (lines 210-215)

Remove inline styles and let canvas size be determined by content:
```tsx
// Current (BROKEN):
<canvas
  ref={canvasRef}
  width={width}
  height={height}
  style={{ width: `${width}px`, height: `${height}px` }}
  onClick={onCanvasClick}
/>

// Fixed:
<canvas
  ref={canvasRef}
  width={width}
  height={height}
  className="block cursor-crosshair"
  onClick={onCanvasClick}
/>
```

#### 1.2 Update Canvas Drawing Logic
**File**: `ui2/src/components/views/MosaicView.tsx` (lines 102-127)

Modify to calculate proper canvas size based on image aspect ratio:
```tsx
// Add after getting aspect ratio (line 119)
const imageAspect = bitmap.width / bitmap.height;
const cellAspect = width / height;

let drawWidth: number;
let drawHeight: number;
let offsetX = 0;
let offsetY = 0;

if (imageAspect > cellAspect) {
  // Image is wider - fit to width
  drawWidth = width;
  drawHeight = width / imageAspect;
  offsetY = (height - drawHeight) / 2;
} else {
  // Image is taller - fit to height
  drawHeight = height;
  drawWidth = height * imageAspect;
  offsetX = (width - drawWidth) / 2;
}

// Update canvas actual size to match drawn content
if (canvasRef.current.width !== drawWidth || canvasRef.current.height !== drawHeight) {
  canvasRef.current.width = drawWidth;
  canvasRef.current.height = drawHeight;
}

// Clear and draw (remove the existing offsetX/offsetY calculation)
ctx.clearRect(0, 0, drawWidth, drawHeight);
ctx.drawImage(bitmap, 0, 0, drawWidth, drawHeight);
```

#### 1.3 Store Image Placement for Click Handling
Add state to track image placement within the cell:
```tsx
// Add to MosaicCell component (after line 195)
const imagePlacementRef = useRef<{
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
} | null>(null);

// Update in drawImage function (after drawing)
imagePlacementRef.current = {
  x: 0,
  y: 0,
  width: drawWidth,
  height: drawHeight,
  imageWidth: bitmap.width,
  imageHeight: bitmap.height
};
```

## Phase 2: Implement Responsive Cell Sizing

### 2.1 Add ResizeObserver to MosaicView
**File**: `ui2/src/components/views/MosaicView.tsx`

#### Add container ref and dimension state (after line 264):
```tsx
const containerRef = useRef<HTMLDivElement>(null);
const [actualDimensions, setActualDimensions] = useState({
  width: containerWidth || 800,
  height: containerHeight || 600
});
```

#### Implement ResizeObserver (after line 271):
```tsx
// Add ResizeObserver effect
useEffect(() => {
  if (!containerRef.current) return;

  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry) {
      const { width, height } = entry.contentRect;
      // Only update if change is significant (>1px)
      if (Math.abs(width - actualDimensions.width) > 1 || 
          Math.abs(height - actualDimensions.height) > 1) {
        setActualDimensions({ width, height });
      }
    }
  });

  resizeObserver.observe(containerRef.current);
  return () => resizeObserver.disconnect();
}, [actualDimensions.width, actualDimensions.height]);
```

#### Update cell dimension calculation (replace lines 273-274):
```tsx
// Use actualDimensions instead of props
const cellWidth = useMemo(() => 
  Math.floor((actualDimensions.width - 40 - (columns - 1) * 8) / columns),
  [actualDimensions.width, columns]
);

const cellHeight = useMemo(() =>
  Math.floor((actualDimensions.height - 100 - (rows - 1) * 8) / rows),
  [actualDimensions.height, rows]
);
```

### 2.2 Update View Calculation Effect
**File**: `ui2/src/components/views/MosaicView.tsx` (lines 308-351)

Add dimension change detection:
```tsx
// Add a dimension version tracker
const [dimensionVersion, setDimensionVersion] = useState(0);

// Update when dimensions change
useEffect(() => {
  setDimensionVersion(v => v + 1);
}, [cellWidth, cellHeight]);

// Update the view calculation effect dependencies
useEffect(() => {
  // ... existing code ...
  
  // Clear cache when dimensions change
  if (dimensionVersion > 0) {
    cellViewCache.current.clear();
  }
  
  // ... rest of existing code ...
}, [
  primaryLayer, 
  volumeBounds, 
  orientation, 
  slicePositions, 
  cellWidth, 
  cellHeight,
  dimensionVersion // Add this
]);
```

### 2.3 Add Throttled Update Mechanism
**File**: `ui2/src/components/views/MosaicView.tsx`

Add throttling utility (after imports):
```tsx
import { throttle } from 'lodash-es';

// After component declaration
const throttledRecalculateViews = useMemo(
  () => throttle(async (
    positions: number[],
    width: number,
    height: number
  ) => {
    // Recalculate all views for new dimensions
    const newViews = new Map<string, ViewPlane>();
    
    for (const position of positions) {
      const cacheKey = `${orientation}-${position}-${width}x${height}`;
      
      try {
        const view = await apiService.recalculateViewForDimensions(
          primaryLayer.volumeId,
          orientation as ViewType,
          [width, height],
          position
        );
        newViews.set(cacheKey, view);
      } catch (error) {
        console.error(`Failed to calculate view for position ${position}:`, error);
      }
    }
    
    cellViewCache.current = newViews;
    setCellViews(newViews);
  }, 100),
  [orientation, primaryLayer]
);
```

## Phase 3: Implement Mouse Click Handling

### 3.1 Add Canvas Click Handler
**File**: `ui2/src/components/views/MosaicView.tsx`

#### Import coordinate transform utility:
```tsx
import { CoordinateTransform } from '@/utils/coordinates';
```

#### Update MosaicCell to handle canvas clicks (replace onClick prop):
```tsx
// Add new prop to MosaicCell
interface MosaicCellProps {
  // ... existing props ...
  onCanvasClick?: (worldCoord: [number, number, number]) => void;
}

// Inside MosaicCell component, add click handler:
const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
  if (!imagePlacementRef.current || !view || !onCanvasClick) return;

  const canvas = canvasRef.current;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const placement = imagePlacementRef.current;

  // Transform mouse coordinates to canvas space
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  const canvasX = (event.clientX - rect.left) * scaleX;
  const canvasY = (event.clientY - rect.top) * scaleY;

  // Check if click is within image bounds
  if (canvasX < placement.x || canvasX > placement.x + placement.width ||
      canvasY < placement.y || canvasY > placement.y + placement.height) {
    return;
  }

  // Transform to image coordinates
  const imageX = (canvasX - placement.x) / placement.width * placement.imageWidth;
  const imageY = (canvasY - placement.y) / placement.height * placement.imageHeight;

  // Transform to world coordinates
  const worldCoord = CoordinateTransform.screenToWorld(imageX, imageY, view);
  
  onCanvasClick(worldCoord);
}, [view, onCanvasClick]);
```

#### Update canvas element:
```tsx
<canvas
  ref={canvasRef}
  width={width}
  height={height}
  className="block cursor-crosshair"
  onClick={handleCanvasClick}
/>
```

### 3.2 Update Parent Click Handler
**File**: `ui2/src/components/views/MosaicView.tsx` (lines 363-372)

Replace `handleSliceClick` with proper world coordinate handler:
```tsx
const handleCellClick = useCallback(async (
  worldCoord: [number, number, number],
  cellIndex: number
) => {
  // Update active cell
  setActiveCellIndex(cellIndex);
  
  // Set exact crosshair position
  await sliceNavService.setWorldPosition(
    worldCoord[0], 
    worldCoord[1], 
    worldCoord[2]
  );
}, [sliceNavService]);
```

### 3.3 Update MosaicCell Usage
Update the MosaicCell rendering to use new handler:
```tsx
<MosaicCell
  key={`${rowIdx}-${colIdx}`}
  // ... existing props ...
  onCanvasClick={(worldCoord) => handleCellClick(worldCoord, cellIndex)}
  isActive={cellIndex === activeCellIndex}
  isHovered={cellIndex === hoveredCellIndex}
/>
```

## Phase 4: Crosshair Alpha Enhancement

### 4.1 Update Crosshair Rendering Logic
**File**: `ui2/src/components/views/MosaicView.tsx` (lines 162-163)

The current implementation already handles alpha correctly:
```tsx
ctx.globalAlpha = isActive || isHovered ? 1.0 : 0.2;
```

Ensure this is maintained with the new click handling by properly tracking active cell state.

## Implementation Order & Testing

### Order of Implementation:
1. **Phase 1** - Canvas Centering (30 minutes)
   - Test: Slices should appear centered in cells
   - Verify with different aspect ratios

2. **Phase 3** - Mouse Click Handling (45 minutes)
   - Test: Clicking on anatomy updates crosshair precisely
   - Verify coordinate transformations are accurate

3. **Phase 2** - Responsive Sizing (1 hour)
   - Test: Resize app window, cells should resize
   - Verify views recalculate properly

4. **Phase 4** - Alpha verification (15 minutes)
   - Test: Click cell, verify alpha changes
   - Ensure smooth hover transitions

### Testing Checklist:
- [ ] Canvas images center properly in cells
- [ ] Clicking on specific anatomy positions crosshair correctly
- [ ] Resizing window causes cells to resize proportionally
- [ ] View quality maintained during resize
- [ ] Crosshair alpha shows 1.0 in active cell, 0.2 in others
- [ ] No performance degradation with resize observer
- [ ] Memory usage stable (no leaks from observers)

## Performance Considerations

1. **Throttle resize calculations** to 100ms to prevent overwhelming the backend
2. **Cache view calculations** with dimension-aware keys
3. **Use ResizeObserver** disconnect in cleanup to prevent memory leaks
4. **Batch view recalculations** when multiple cells need updates
5. **Consider lazy loading** for off-screen cells in large grids

## Error Handling

Add proper error boundaries for:
- Failed view calculations during resize
- Invalid coordinate transformations
- ResizeObserver compatibility issues
- Canvas rendering failures

## Future Enhancements

1. **View pooling**: Reuse view objects to reduce memory allocation
2. **Progressive rendering**: Load visible cells first, then off-screen
3. **Zoom support**: Add mouse wheel zoom like SliceView
4. **Drag support**: Enable crosshair dragging within cells
5. **Keyboard navigation**: Arrow keys to move between cells

## Dependencies & Imports Needed

```tsx
// Add to imports in MosaicView.tsx
import { throttle } from 'lodash-es';
import { CoordinateTransform } from '@/utils/coordinates';
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
```

## Files Requiring Changes

1. **Primary File**: `ui2/src/components/views/MosaicView.tsx`
   - All phases require changes to this file
   - Most changes are in the MosaicCell component and parent MosaicView

2. **No other files need modification** - all functionality is self-contained

This plan provides a complete solution following the patterns established in FlexibleOrthogonalView while maintaining the unique grid-based nature of MosaicView.
# MosaicView Image Centering and Crosshair Implementation Plan

## Overview

This plan addresses two critical issues in MosaicView:
1. **Image Centering**: Images are not centered within cells despite correct aspect ratios
2. **Crosshair Rendering**: Missing crosshair functionality with brightness differentiation

## Phase 1: Fix Image Centering

### 1.1 Update Canvas Wrapper Styling

**File**: `/ui2/src/components/views/MosaicView.tsx`

**Current Code (Line 160)**:
```tsx
<div className="absolute inset-0 overflow-hidden rounded">
```

**Updated Code**:
```tsx
<div className="absolute inset-0 overflow-hidden rounded flex items-center justify-center">
```

**Rationale**: 
- Adds flexbox centering consistent with SliceView implementation
- `flex` creates a flex container
- `items-center` centers vertically (align-items: center)
- `justify-center` centers horizontally (justify-content: center)
- Maintains existing `absolute inset-0` for full cell coverage
- Preserves `overflow-hidden rounded` for rounded corners

### 1.2 Verify Canvas Sizing

Ensure the canvas element maintains its intrinsic size and doesn't stretch:
- Canvas should use actual pixel dimensions in width/height attributes
- Style width/height should match to prevent scaling artifacts
- The flex container will center the canvas without distorting it

## Phase 2: Implement Crosshair Rendering

### 2.1 Add Crosshair Rendering Function to MosaicCell

**File**: `/ui2/src/components/views/MosaicView.tsx`

Add the following function inside the `MosaicCell` component (after line 145):

```tsx
// Render crosshair on the canvas
const renderCrosshair = useCallback(() => {
  const canvas = canvasRef.current;
  const placement = imagePlacementRef.current;
  
  // Validation checks
  if (!canvas || !placement || !viewState.crosshair.visible || !cellView) {
    return;
  }
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  // Transform crosshair world coordinate to screen space
  const screenCoord = CoordinateTransform.worldToScreen(
    viewState.crosshair.world_mm,
    cellView
  );
  
  if (!screenCoord) return;
  
  const [screenX, screenY] = screenCoord;
  
  // Transform to canvas coordinates accounting for image placement
  const scaleX = placement.width / placement.imageWidth;
  const scaleY = placement.height / placement.imageHeight;
  const canvasX = placement.x + screenX * scaleX;
  const canvasY = placement.y + screenY * scaleY;
  
  // Check if crosshair is within the image bounds
  if (canvasX < placement.x || canvasX > placement.x + placement.width ||
      canvasY < placement.y || canvasY > placement.y + placement.height) {
    return;
  }
  
  // Draw crosshair with brightness based on active state
  ctx.save();
  
  // Determine alpha based on whether this cell is active
  const alpha = isActive ? 1.0 : 0.2;
  ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`; // Green with variable alpha
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]); // Dashed line pattern
  
  // Draw horizontal line
  ctx.beginPath();
  ctx.moveTo(placement.x, canvasY);
  ctx.lineTo(placement.x + placement.width, canvasY);
  ctx.stroke();
  
  // Draw vertical line
  ctx.beginPath();
  ctx.moveTo(canvasX, placement.y);
  ctx.lineTo(canvasX, placement.y + placement.height);
  ctx.stroke();
  
  ctx.restore();
}, [viewState.crosshair, cellView, isActive]);
```

### 2.2 Add isActive Prop to MosaicCell

**File**: `/ui2/src/components/views/MosaicView.tsx`

Update the `MosaicCell` interface (around line 18):

```tsx
interface MosaicCellProps {
  orientation: 'axial' | 'sagittal' | 'coronal';
  cellIndex: number;
  width: number;
  height: number;
  viewState: ViewState;
  cellView: ViewPlane | null;
  isActive: boolean; // New prop for crosshair brightness
}
```

### 2.3 Integrate Crosshair Rendering

Update the `renderSlice` function to call `renderCrosshair` after drawing the image.

**Current Code (around lines 112-134)**:
```tsx
// Draw the image with calculated dimensions
ctx.clearRect(0, 0, canvas.width, canvas.height);
ctx.drawImage(imageBitmap, drawX, drawY, drawWidth, drawHeight);

// Store image placement for coordinate calculations
imagePlacementRef.current = {
  x: drawX,
  y: drawY,
  width: drawWidth,
  height: drawHeight,
  imageWidth: imageBitmap.width,
  imageHeight: imageBitmap.height
};
```

**Updated Code**:
```tsx
// Draw the image with calculated dimensions
ctx.clearRect(0, 0, canvas.width, canvas.height);
ctx.drawImage(imageBitmap, drawX, drawY, drawWidth, drawHeight);

// Store image placement for coordinate calculations
imagePlacementRef.current = {
  x: drawX,
  y: drawY,
  width: drawWidth,
  height: drawHeight,
  imageWidth: imageBitmap.width,
  imageHeight: imageBitmap.height
};

// Render crosshair after image
renderCrosshair();
```

### 2.4 Track Active Cell State

Add state management for tracking which cell is active (hovered or selected).

**File**: `/ui2/src/components/views/MosaicView.tsx`

Add to the main `MosaicView` component (after line 185):

```tsx
// Track active cell for crosshair brightness
const [activeCell, setActiveCell] = useState<number | null>(null);
```

### 2.5 Add Mouse Event Handlers

Update `MosaicCell` to handle mouse enter/leave events:

**Add to MosaicCell component** (update the canvas wrapper div around line 160):

```tsx
<div 
  className="absolute inset-0 overflow-hidden rounded flex items-center justify-center"
  onMouseEnter={() => onMouseEnter?.(cellIndex)}
  onMouseLeave={() => onMouseLeave?.()}
>
```

**Update MosaicCell interface**:
```tsx
interface MosaicCellProps {
  // ... existing props
  onMouseEnter?: (cellIndex: number) => void;
  onMouseLeave?: () => void;
}
```

### 2.6 Pass Active State to Cells

Update the `MosaicCell` instantiation in the grid (around line 342):

```tsx
<MosaicCell
  key={`${rowIndex}-${colIndex}`}
  orientation={orientation}
  cellIndex={cellIndex}
  width={cellWidth}
  height={cellHeight}
  viewState={viewState}
  cellView={cellViewCache[cacheKey] || null}
  isActive={activeCell === cellIndex}
  onMouseEnter={setActiveCell}
  onMouseLeave={() => setActiveCell(null)}
/>
```

### 2.7 Add Crosshair Re-render on State Changes

Add effect to re-render crosshair when visibility or position changes:

**In MosaicCell component**:
```tsx
// Re-render crosshair when crosshair state changes
useEffect(() => {
  if (imagePlacementRef.current) {
    renderCrosshair();
  }
}, [viewState.crosshair, renderCrosshair]);
```

## Phase 3: Enhance SliceView Crosshair Brightness

### 3.1 Update SliceView Crosshair Rendering

**File**: `/ui2/src/components/views/SliceView.tsx`

Update the `renderCrosshairImpl` function to support variable brightness:

**Current Code (around line 123)**:
```tsx
ctx.strokeStyle = '#00ff00';
```

**Updated Code**:
```tsx
// Check if this view is active (focused or hovered)
const isActive = document.activeElement === canvasRef.current || isHovered;
const alpha = isActive ? 1.0 : 0.2;
ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`;
```

### 3.2 Add Hover State Tracking

Add state to track hover in SliceView:

```tsx
const [isHovered, setIsHovered] = useState(false);
```

Update mouse event handlers:
```tsx
const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
  setIsHovered(true);
  // ... existing code
};

const handleMouseLeave = () => {
  setIsHovered(false);
  // ... existing code
};
```

## Phase 4: Testing and Edge Cases

### 4.1 Testing Checklist

1. **Image Centering**:
   - Verify images center correctly in cells of various sizes
   - Test with images of different aspect ratios
   - Ensure no distortion or stretching occurs
   - Check that rounded corners are preserved

2. **Crosshair Rendering**:
   - Verify crosshair appears at correct position
   - Test brightness changes on hover/focus
   - Ensure crosshair respects image bounds
   - Check crosshair updates when position changes
   - Verify crosshair hides when visibility is false

3. **Performance**:
   - Monitor rendering performance with many cells
   - Ensure no excessive re-renders
   - Check memory usage with large grids

### 4.2 Edge Cases to Handle

1. **Coordinate Edge Cases**:
   - Crosshair at image boundaries
   - Crosshair outside current slice plane
   - Invalid or null coordinates

2. **Rendering Edge Cases**:
   - Canvas not ready
   - Image not loaded
   - Zero-sized cells
   - Rapid mouse movements

3. **State Synchronization**:
   - Multiple MosaicView instances
   - Crosshair updates from other views
   - View state changes during render

## Implementation Order

1. **Phase 1**: Fix image centering (simple CSS change)
2. **Phase 2**: Implement MosaicView crosshairs with brightness
3. **Phase 3**: Update SliceView crosshair brightness
4. **Phase 4**: Comprehensive testing

## Files to Modify

1. **Primary Changes**:
   - `/ui2/src/components/views/MosaicView.tsx` - Main implementation
   - `/ui2/src/components/views/SliceView.tsx` - Crosshair brightness update

2. **No Changes Required** (Already correct):
   - `/ui2/src/utils/coordinates.ts` - Coordinate transforms work correctly
   - `/ui2/src/stores/viewStateStore.ts` - State management is fine
   - `/ui2/src/services/RenderCoordinator.ts` - Rendering pipeline works

## Success Criteria

1. MosaicView images are centered within their cells
2. Crosshairs render correctly on all MosaicView cells
3. Active (hovered/selected) cells show bright crosshairs (alpha=1.0)
4. Inactive cells show dim crosshairs (alpha=0.2)
5. SliceView also implements differential crosshair brightness
6. No performance degradation
7. All existing functionality remains intact

## Notes

- The coordinate transformation system is already correct and consistent
- Image placement tracking is already implemented but unused for crosshairs
- The render coordinator and backend integration work correctly
- Focus on the presentation layer fixes only
# MosaicView Investigation Report

## Executive Summary

This investigation examines why MosaicView images are not centered despite having correct aspect ratios, lacks crosshair display functionality, and compares its implementation with FlexibleOrthogonalView to identify the root causes and missing features.

## Key Findings

### 1. Image Centering Issue in MosaicView

**Problem**: Images in MosaicView are not centered within their cells despite correct aspect ratio calculations.

**Root Cause**: The MosaicCell component is missing proper centering styles for its canvas element.

**Current Implementation (MosaicView.tsx, lines 159-167)**:
```tsx
{/* Canvas wrapper with overflow hidden for rounded corners */}
<div className="absolute inset-0 overflow-hidden rounded">
  <canvas
    ref={canvasRef}
    width={width}
    height={height}
    style={{ width: `${width}px`, height: `${height}px` }}
  />
</div>
```

**FlexibleOrthogonalView/SliceView Implementation (SliceView.tsx, lines 552-563)**:
```tsx
{/* Canvas wrapper for centering */}
<div className="w-full h-full flex items-center justify-center">
  <canvas
    ref={canvasRef}
    width={canvasWidth || validWidth}
    height={canvasHeight || validHeight}
    className={`block border border-gray-300 cursor-crosshair ${isDragging ? 'border-blue-500 border-2' : ''}`}
    onClick={handleMouseClick}
    onMouseMove={handleMouseMove}
    onMouseLeave={handleMouseLeave}
  />
</div>
```

**Key Difference**: SliceView uses `flex items-center justify-center` to center the canvas within its container, while MosaicView uses `absolute inset-0` which stretches the canvas to fill the entire cell without centering.

### 2. Missing Crosshair Functionality

**Problem**: MosaicView has no crosshair drawing functionality.

**Analysis of SliceView Crosshair Implementation**:

1. **Crosshair State Management** (SliceView.tsx, lines 79-136):
   - SliceView has a dedicated `renderCrosshairImpl` function
   - Uses `CoordinateTransform.worldToScreen` to convert world coordinates to screen space
   - Accounts for image placement within the canvas
   - Draws crosshairs with green color (#00ff00) and dashed lines

2. **Image Placement Tracking** (SliceView.tsx, lines 47-59):
   - SliceView maintains `imagePlacementRef` to track where the image is drawn within the canvas
   - This is crucial for accurate crosshair positioning

3. **Crosshair Rendering Logic**:
   ```tsx
   // Transform crosshair world coordinate to screen space
   const screenCoord = CoordinateTransform.worldToScreen(
     currentViewState.crosshair.world_mm,
     currentViewPlane
   );
   
   // Draw crosshair with proper scaling
   const scaleX = placement.width / placement.imageWidth;
   const scaleY = placement.height / placement.imageHeight;
   const canvasX = placement.x + screenX * scaleX;
   const canvasY = placement.y + screenY * scaleY;
   ```

**MosaicView's Missing Components**:
- No crosshair rendering function
- No crosshair visibility checks
- No coordinate transformation for crosshair position
- Image placement is tracked but not used for crosshair rendering

### 3. Crosshair Brightness Requirements

**Requirement**: Crosshairs should be brighter on selected/hovered slice and dimmer (alpha=0.2) on others.

**Current SliceView Implementation**:
- Uses fixed color `#00ff00` (bright green) for all crosshairs
- No differentiation between active and inactive slices

**Required Enhancement for MosaicView**:
```tsx
// In MosaicCell component
const crosshairAlpha = isActive ? 1.0 : 0.2;
ctx.strokeStyle = `rgba(0, 255, 0, ${crosshairAlpha})`;
```

### 4. Architecture Differences

**FlexibleOrthogonalView Structure**:
```
FlexibleOrthogonalView
  └── FlexibleSlicePanel (handles ResizeObserver)
      └── SliceView (handles rendering & interactions)
```

**MosaicView Structure**:
```
MosaicView
  └── MosaicCell (direct canvas rendering)
```

**Key Architectural Differences**:
1. SliceView is a fully-featured component with comprehensive event handling
2. MosaicCell is a simplified component focused only on rendering
3. SliceView maintains complex state for image placement and coordinate transforms
4. MosaicCell lacks the infrastructure for crosshair rendering

### 5. Coordinate System Consistency

Both views use the same coordinate transformation utilities (`CoordinateTransform` class), ensuring consistent coordinate handling across the application. The issue is not with coordinate calculations but with missing implementation in MosaicView.

## Recommendations

### 1. Fix Image Centering
Replace the canvas wrapper div in MosaicCell (line 160) with:
```tsx
<div className="absolute inset-0 overflow-hidden rounded flex items-center justify-center">
```

### 2. Implement Crosshair Rendering
Add the following to MosaicCell:
- Port `renderCrosshairImpl` function from SliceView
- Call crosshair rendering after image drawing
- Use `isActive` prop to control crosshair opacity

### 3. Track Image Placement
Ensure `imagePlacementRef` is properly used for crosshair coordinate transformation.

### 4. Add Mouse Interaction
Consider adding mouse hover support to show coordinates and highlight the active cell.

## Code Snippets for Implementation

### Crosshair Rendering Function for MosaicCell
```tsx
const renderCrosshair = () => {
  const canvas = canvasRef.current;
  if (!canvas || !viewState.crosshair.visible || !imagePlacementRef.current) return;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  // Get the view plane for this cell
  const currentViewPlane = cellView || viewState.views[orientation];
  
  // Transform crosshair world coordinate to screen space
  const screenCoord = CoordinateTransform.worldToScreen(
    viewState.crosshair.world_mm,
    currentViewPlane
  );
  
  if (screenCoord) {
    const [screenX, screenY] = screenCoord;
    const placement = imagePlacementRef.current;
    
    // Transform to canvas coordinates
    const scaleX = placement.width / placement.imageWidth;
    const scaleY = placement.height / placement.imageHeight;
    const canvasX = placement.x + screenX * scaleX;
    const canvasY = placement.y + screenY * scaleY;
    
    // Check bounds
    if (canvasX >= placement.x && canvasX <= placement.x + placement.width &&
        canvasY >= placement.y && canvasY <= placement.y + placement.height) {
      
      ctx.save();
      // Use different opacity for active vs inactive cells
      const alpha = isActive ? 1.0 : 0.2;
      ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      
      // Draw crosshair lines
      ctx.beginPath();
      ctx.moveTo(placement.x, canvasY);
      ctx.lineTo(placement.x + placement.width, canvasY);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(canvasX, placement.y);
      ctx.lineTo(canvasX, placement.y + placement.height);
      ctx.stroke();
      
      ctx.restore();
    }
  }
};
```

## Conclusion

The MosaicView implementation lacks two critical features present in SliceView:
1. Proper CSS flexbox centering for the canvas element
2. Crosshair rendering functionality with coordinate transformation

These issues can be resolved by:
1. Adding flexbox centering styles to the canvas wrapper
2. Porting the crosshair rendering logic from SliceView to MosaicCell
3. Implementing differential crosshair opacity based on the `isActive` prop

The coordinate system and aspect ratio calculations are correct; the issues are purely in the rendering and display layer.
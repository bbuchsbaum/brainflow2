# Brainflow2 Rendering Flow Report

## 1. Image Centering in FlexibleOrthogonalView/SliceView

### Component Hierarchy
```
FlexibleOrthogonalView
  └── Allotment (split panes)
      └── FlexibleSlicePanel (ResizeObserver)
          └── SliceView (canvas rendering)
```

### Centering Flow

#### 1.1 FlexibleSlicePanel ResizeObserver Flow
```typescript
// FlexibleSlicePanel.tsx:103-147
useLayoutEffect(() => {
  const resizeObserver = new ResizeObserver((entries) => {
    const { width, height } = entry.contentRect;
    // Clamp dimensions to valid range
    const [clampedWidth, clampedHeight] = clampDimensions(width, height);
    
    // Update local state
    setDimensions({ width: clampedWidth, height: clampedHeight });
    
    // Trigger throttled backend update
    throttledUpdateDimensions(clampedWidth, clampedHeight);
  });
});
```

#### 1.2 SliceView Canvas Centering (SUCCESSFUL)
```typescript
// SliceView.tsx:552-563
// Canvas wrapper with flexbox centering
<div className="w-full h-full flex items-center justify-center">
  <canvas
    ref={canvasRef}
    width={canvasWidth}
    height={canvasHeight}
    className="block border border-gray-300 cursor-crosshair"
  />
</div>
```

**Key CSS Classes:**
- `flex`: Creates flexbox container
- `items-center`: Centers vertically (align-items: center)
- `justify-center`: Centers horizontally (justify-content: center)

#### 1.3 Image Drawing with Aspect Preservation
```typescript
// SliceView.tsx:301-409 (redrawCanvasImpl)
const imageAspectRatio = imageWidth / imageHeight;
const canvasAspectRatio = canvas.width / canvas.height;

if (imageAspectRatio > canvasAspectRatio) {
  // Image wider than canvas - fit to width
  drawWidth = canvas.width;
  drawHeight = drawWidth / imageAspectRatio;
  drawX = 0;
  drawY = (canvas.height - drawHeight) / 2; // Center vertically
} else {
  // Image taller than canvas - fit to height
  drawHeight = canvas.height;
  drawWidth = drawHeight * imageAspectRatio;
  drawX = (canvas.width - drawWidth) / 2; // Center horizontally
  drawY = 0;
}

// Store placement for crosshair calculations
imagePlacementRef.current = {
  x: drawX, y: drawY,
  width: drawWidth, height: drawHeight,
  imageWidth, imageHeight
};
```

### MosaicView Centering (BROKEN)

#### Current Implementation (Missing Centering)
```typescript
// MosaicView.tsx:159-167
<div className="absolute inset-0 overflow-hidden rounded">
  <canvas
    ref={canvasRef}
    width={width}
    height={height}
    style={{ width: `${width}px`, height: `${height}px` }}
  />
</div>
```

**Issue:** Uses `absolute inset-0` which stretches canvas to fill container instead of centering it.

## 2. Crosshair Rendering Flow

### State → Canvas Flow

#### 2.1 ViewState Store Management
```typescript
// viewStateStore.ts
interface ViewState {
  crosshair: {
    world_mm: [number, number, number], // World coordinates
    visible: boolean
  }
}

// Crosshair update flow
setCrosshair: async (position, updateViews = false) => {
  // Wait for pending resizes
  await Promise.all(resizePromises);
  
  // Update state
  state.viewState.crosshair.world_mm = position;
  state.viewState.crosshair.visible = true;
  
  // Update view origins if requested
  if (updateViews) {
    // Recalculate slice positions for each view
  }
}
```

#### 2.2 SliceView Crosshair Rendering
```typescript
// SliceView.tsx:79-136 (renderCrosshairImpl)
const renderCrosshairImpl = () => {
  // 1. Get current state
  const currentViewState = useViewStateStore.getState().viewState;
  const currentViewPlane = currentViewState.views[viewId];
  
  // 2. Transform world to screen coordinates
  const screenCoord = CoordinateTransform.worldToScreen(
    currentViewState.crosshair.world_mm,
    currentViewPlane
  );
  
  // 3. Apply image placement transform
  const placement = imagePlacementRef.current;
  const scaleX = placement.width / placement.imageWidth;
  const scaleY = placement.height / placement.imageHeight;
  const canvasX = placement.x + screenX * scaleX;
  const canvasY = placement.y + screenY * scaleY;
  
  // 4. Draw crosshair lines
  ctx.strokeStyle = '#00ff00'; // Fixed bright green
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  
  // Horizontal line
  ctx.moveTo(placement.x, canvasY);
  ctx.lineTo(placement.x + placement.width, canvasY);
  
  // Vertical line
  ctx.moveTo(canvasX, placement.y);
  ctx.lineTo(canvasX, placement.y + placement.height);
};
```

#### 2.3 Coordinate Transformation
```typescript
// utils/coordinates.ts:34-89
static worldToScreen(world_mm, plane, tolerance = 0.5) {
  // 1. Calculate delta from origin
  const deltaX = worldX - originX;
  const deltaY = worldY - originY;
  const deltaZ = worldZ - originZ;
  
  // 2. Check if point is on plane (within tolerance)
  const normal = crossProduct(plane.u_mm, plane.v_mm);
  const distance = Math.abs(deltaX * normal[0] + ...);
  if (distance > tolerance) return null;
  
  // 3. Solve for screen coordinates using determinant
  const det = uX * vY - uY * vX;
  const x = (deltaX * vY - deltaY * vX) / det;
  const y = (deltaY * uX - deltaX * uY) / det;
  
  return [x, y];
}
```

### MosaicView Missing Crosshair Implementation

MosaicView has NO crosshair rendering functionality:
- No `renderCrosshair` function
- No coordinate transformation logic
- No visibility checks
- Image placement is tracked but unused

## 3. MosaicView Current Rendering Flow

### 3.1 View Calculation per Cell
```typescript
// MosaicView.tsx:259-302
// Pre-calculate views for all visible cells
for (const position of slicePositions) {
  // Calculate crosshair for this slice
  const cellCrosshair = [...viewState.crosshair.world_mm];
  cellCrosshair[axisIndex] = position;
  
  // Request backend to calculate view
  const view = await apiService.recalculateViewForDimensions(
    primaryLayer.volumeId,
    orientation,
    [cellWidth, cellHeight],
    cellCrosshair
  );
  
  cellViewCache[cacheKey] = view;
}
```

### 3.2 MosaicCell Rendering
```typescript
// MosaicView.tsx:57-145
const renderSlice = async () => {
  // Create modified viewState with cell-specific view
  const modifiedViewState = {
    ...viewState,
    views: { [orientation]: cellView }
  };
  
  // Request render through coordinator
  const imageBitmap = await renderCoordinator.requestRender({
    viewState: modifiedViewState,
    viewType: orientation,
    width, height,
    reason: 'layer_change'
  });
  
  // Draw with aspect preservation
  ctx.drawImage(imageBitmap, drawX, drawY, drawWidth, drawHeight);
  
  // Store placement (but never used for crosshairs)
  imagePlacementRef.current = { x: drawX, y: drawY, ... };
};
```

### 3.3 RenderCoordinator Flow
```typescript
// RenderCoordinator.ts:45-69
async requestRender(request: RenderRequest) {
  const job = {
    ...request,
    id: `job_${++this.jobIdCounter}`,
    timestamp: performance.now()
  };
  
  // Debounce resize operations
  if (job.reason === 'resize') {
    this.enqueueWithDebounce(job);
  } else {
    this.enqueueImmediate(job);
  }
  
  this.processQueue();
}

// RenderCoordinator.ts:154-181
private async executeRenderJob(job) {
  // Backend creates per-view render target
  const result = await apiService.applyAndRenderViewStateCore(
    job.viewState,
    job.viewType,
    job.width,
    job.height
  );
  
  return result; // ImageBitmap
}
```

## 4. Event Handling for Hover/Selection

### 4.1 Mouse Events → Crosshair Updates

#### SliceView Mouse Click Flow
```typescript
// SliceView.tsx:209-260
const handleMouseClick = async (event) => {
  // 1. Get canvas coordinates
  const rect = canvas.getBoundingClientRect();
  const canvasX = (event.clientX - rect.left) * scaleX;
  const canvasY = (event.clientY - rect.top) * scaleY;
  
  // 2. Check if within image bounds
  if (canvasX < placement.x || canvasX > placement.x + placement.width) return;
  
  // 3. Transform to image coordinates
  const imageX = (canvasX - placement.x) / placement.width * placement.imageWidth;
  const imageY = (canvasY - placement.y) / placement.height * placement.imageHeight;
  
  // 4. Transform to world coordinates
  const worldCoord = CoordinateTransform.screenToWorld(imageX, imageY, viewPlane);
  
  // 5. Update crosshair position
  await setCrosshair(worldCoord, true);
};
```

#### Mouse Move → Status Bar Updates
```typescript
// SliceView.tsx:266-291
const handleMouseMove = (event) => {
  // Calculate world coordinates
  const worldCoord = CoordinateTransform.screenToWorld(viewX, viewY, viewPlane);
  
  // Emit event for StatusBar
  eventBus.emit('mouse.worldCoordinate', { 
    world_mm: worldCoord, 
    viewType: viewId 
  });
};

const handleMouseLeave = () => {
  eventBus.emit('mouse.leave', { viewType: viewId });
};
```

### 4.2 Event Bus Architecture
```typescript
// EventBus.ts
interface EventMap {
  'crosshair.updated': { world_mm: [number, number, number] };
  'mouse.worldCoordinate': { world_mm: [number, number, number]; viewType: ViewType };
  'mouse.leave': { viewType: ViewType };
  // ... other events
}

// Event emission
eventBus.emit('mouse.worldCoordinate', data);

// Event subscription (in components)
useEvent('mouse.worldCoordinate', (data) => {
  // Update status bar
});
```

### 4.3 Crosshair Brightness Control (NOT IMPLEMENTED)

Current implementation uses fixed color:
```typescript
ctx.strokeStyle = '#00ff00'; // Always bright green
```

Required implementation for brightness based on active view:
```typescript
// Proposed implementation
const isActive = (viewType === activeViewType);
const alpha = isActive ? 1.0 : 0.2;
ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`;
```

## 5. Critical Issues & Solutions

### Issue 1: MosaicView Image Not Centered
**Root Cause:** Canvas wrapper uses `absolute inset-0` instead of flexbox centering.

**Solution:**
```typescript
// Replace line 160 in MosaicView.tsx
<div className="absolute inset-0 overflow-hidden rounded flex items-center justify-center">
```

### Issue 2: MosaicView Missing Crosshairs
**Root Cause:** No crosshair rendering implementation.

**Solution:** Port `renderCrosshairImpl` from SliceView to MosaicCell, using stored `imagePlacementRef` for coordinate transformation.

### Issue 3: No Crosshair Brightness Differentiation
**Root Cause:** Fixed color value in crosshair rendering.

**Solution:** Add `isActive` prop to components and vary alpha based on active state.

### Issue 4: Coordinate System Consistency
**Current State:** Both views use same `CoordinateTransform` utilities, ensuring consistency.

**Key Insight:** The issue is purely in the rendering layer, not in coordinate calculations.

## 6. Data Flow Summary

### Successful Flow (SliceView)
1. **ResizeObserver** → Updates dimensions → Triggers re-render
2. **ViewState** → World coordinates → `CoordinateTransform.worldToScreen`
3. **Image Placement** → Stored during draw → Used for crosshair transform
4. **Canvas Drawing** → Centered via flexbox → Crosshair overlaid
5. **Mouse Events** → World coordinates → Update crosshair state

### Broken Flow (MosaicView)
1. **View Calculation** → Pre-computed per cell ✓
2. **Image Rendering** → Aspect preserved ✓
3. **Canvas Centering** → Missing flexbox ✗
4. **Crosshair Rendering** → Not implemented ✗
5. **Mouse Interaction** → Only click, no hover ✗

## 7. Performance Considerations

### Render Coordination
- Resize operations debounced at 200ms
- Render jobs queued and collapsed
- Per-view render targets created by backend
- Coalescing middleware batches state updates

### Optimization Opportunities
1. MosaicView pre-calculates all cell views (good for static display)
2. Could implement viewport culling for large grids
3. Crosshair rendering should be immediate (no backend round-trip)
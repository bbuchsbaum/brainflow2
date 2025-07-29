# Flow Report: Brainflow2 Execution Paths

## 1. FlexibleOrthogonalView's Responsive Resizing Flow

### ResizeObserver → Dimension Updates → Backend Recalculation → Re-rendering

#### 1.1 Initial Trigger: ResizeObserver Detection
```
FlexibleSlicePanel (line 103-147)
└── ResizeObserver callback triggered
    ├── Captures entry.contentRect {width, height}
    ├── Clamps dimensions via clampDimensions()
    └── Updates local state: setDimensions()
```

#### 1.2 Throttled Dimension Update
```
FlexibleSlicePanel.throttledUpdateDimensions (line 29-56)
├── Throttled at 30ms for smooth resizing
├── Checks if dimensions actually changed (>1px delta)
├── Calls viewStateStore.updateDimensionsAndPreserveScale()
│   └── async operation - waits for backend
└── Forces immediate render via coalesceUtils.flush(true)
```

#### 1.3 Backend Recalculation Path
```
viewStateStore.updateDimensionsAndPreserveScale (line 275-444)
├── Validates dimensions (non-zero, positive)
├── Checks for loaded volumes/layers
├── Primary path: Backend recalculation
│   ├── apiService.recalculateViewForDimensions()
│   │   └── Sends: volumeId, viewType, [width, height], crosshair
│   └── Updates store with backend-calculated ViewPlane
└── Fallback path: Frontend calculation
    ├── Gets volume bounds from apiService
    ├── Calculates uniform pixel size: Math.max(widthMm/width, heightMm/height)
    └── Recalculates origin_mm, u_mm, v_mm vectors
```

#### 1.4 Coalescing and Backend Communication
```
coalesceUpdatesMiddleware (flushState function)
├── Checks if dragging (skips flush if true, unless forced)
├── Calls backendUpdateCallback with ViewState
│   └── ApiService.applyAndRenderViewStateCore()
│       ├── Validates render target ready
│       ├── Filters visible layers
│       ├── Scales view vectors by dimensions
│       └── Invokes backend render command
└── Updates lastFlushedState
```

#### 1.5 Render Completion
```
RenderCoordinator.executeRenderJob()
├── Calls apiService.applyAndRenderViewStateCore()
├── Backend creates per-view render target
├── Returns ImageBitmap
└── Updates render store state

SliceView.handleRenderComplete (line 141-187)
├── Receives 'render.complete' event
├── Stores ImageBitmap in lastImageRef
├── Calls redrawCanvas()
│   ├── Calculates aspect-preserving placement
│   ├── Draws image to canvas
│   └── Updates imagePlacementRef for coordinate transforms
└── Redraws crosshair on top
```

### Key Optimizations in Resize Flow:
1. **Throttling**: 30ms throttle prevents overwhelming backend
2. **Dimension validation**: Prevents unnecessary updates for sub-pixel changes
3. **Drag detection**: Defers backend updates during active resizing
4. **Force flush on drag end**: Ensures final dimensions are rendered
5. **Aspect preservation**: Maintains square pixels via uniform pixel size

---

## 2. MosaicView's Current Fixed Dimension Flow

### Why MosaicView Doesn't Respond to Resizing

#### 2.1 Fixed Dimension Calculation (One-Time)
```
MosaicView (line 273-274)
├── cellWidth = Math.floor((containerWidth - 40 - (columns - 1) * 8) / columns)
├── cellHeight = Math.floor((containerHeight - 100 - (rows - 1) * 8) / rows)
└── These are calculated ONCE from props, never updated
```

#### 2.2 Static View Pre-calculation
```
MosaicView.useEffect (line 308-351)
├── Triggered by: primaryLayer, volumeBounds, orientation, slicePositions, cellWidth, cellHeight
├── For each slice position:
│   ├── Creates cache key: `${orientation}-${position}-${cellWidth}x${cellHeight}`
│   ├── Calls apiService.recalculateViewForDimensions()
│   └── Stores in cellViewCache
└── Problem: cellWidth/cellHeight are static, so cache never invalidates on resize
```

#### 2.3 Missing ResizeObserver
```
MosaicView component
├── No ResizeObserver implementation
├── No container ref for size tracking
├── Props (containerWidth, containerHeight) are optional with defaults
└── No mechanism to update dimensions after mount
```

#### 2.4 Canvas Fixed Sizing
```
MosaicCell (line 210-215)
├── Canvas element has inline styles
│   └── style={{ width: `${width}px`, height: `${height}px` }}
├── Prevents flexbox centering from working
└── Canvas always renders at full cell size
```

### Comparison with FlexibleOrthogonalView's Responsive Design:

**FlexibleOrthogonalView** uses:
- Allotment component for resizable panes
- FlexibleSlicePanel with ResizeObserver
- Dynamic dimension updates to backend
- No fixed inline styles on canvas

**MosaicView** lacks:
- ResizeObserver for container tracking
- Dynamic cell dimension recalculation
- Backend notification of size changes
- Flexible canvas sizing

---

## 3. Mouse Click Handling Flow

### 3.1 SliceView's Complete Click → Crosshair Flow

```
SliceView.handleMouseClick (line 209-260)
├── Canvas element onClick handler
├── Get canvas bounding rect
├── Calculate scale factors: canvas.width / rect.width
├── Transform client coords → canvas coords
│   ├── canvasX = (clientX - rect.left) * scaleX
│   └── canvasY = (clientY - rect.top) * scaleY
├── Check if click within image bounds (imagePlacementRef)
├── Transform canvas → image coordinates
│   ├── imageX = (canvasX - placement.x) / placement.width * placement.imageWidth
│   └── imageY = (canvasY - placement.y) / placement.height * placement.imageHeight
├── Transform image → world coordinates
│   └── worldCoord = CoordinateTransform.screenToWorld(imageX, imageY, viewPlane)
└── Update crosshair
    └── await setCrosshair(worldCoord, true)
```

#### Coordinate Transform Details:
```
CoordinateTransform.screenToWorld (line 13-28)
├── Inputs: x, y (screen pixels), viewPlane
├── Extracts: origin_mm, u_mm, v_mm from viewPlane
└── Calculates: world = origin + x*u + y*v
    ├── worldX = originX + x * uX + y * vX
    ├── worldY = originY + x * uY + y * vY
    └── worldZ = originZ + x * uZ + y * vZ
```

### 3.2 MosaicCell's Incomplete Click Flow

```
MosaicCell (line 195-202)
├── Click handler on outer div (not canvas!)
├── onClick={() => handleSliceClick(slicePosition)}
└── Only passes the slice position value

MosaicView.handleSliceClick (line 363-372)
├── Gets current crosshair from viewState
├── Updates only the axis for current orientation
│   ├── axial: updates Z (index 2)
│   ├── sagittal: updates X (index 0)
│   └── coronal: updates Y (index 1)
└── Calls sliceNavService.setWorldPosition()
```

**Problems with MosaicCell click handling:**
1. Click is on div container, not canvas
2. No mouse position captured
3. No coordinate transformation
4. Only updates slice axis, not exact click position
5. Can't click on specific anatomical features

---

## 4. Crosshair Position Update Flow

### 4.1 From User Click to Crosshair Render

#### Step 1: Crosshair Update in Store
```
viewStateStore.setCrosshair (line 150-249)
├── Waits for pending resizes to complete
├── Updates viewState.crosshair.world_mm
├── If updateViews = true:
│   ├── Calculates normal vector for each view
│   ├── Updates origin_mm to show slice at crosshair
│   └── Notifies backend via updateFrameForSynchronizedView()
└── Triggers coalescing middleware
```

#### Step 2: Coalesced Backend Update
```
coalesceUpdatesMiddleware
├── Queues state update
├── Schedules via requestAnimationFrame
└── flushState()
    ├── Checks if dragging (may defer)
    ├── Calls backendUpdateCallback
    └── ApiService.applyAndRenderViewStateCore()
```

#### Step 3: Backend Render with Crosshair
```
ApiService.applyAndRenderViewStateCore
├── Includes crosshair in declarativeViewState
├── Backend renders with crosshair position
└── Returns ImageBitmap
```

#### Step 4: Frontend Crosshair Overlay
```
SliceView.renderCrosshairImpl (line 79-138)
├── Transforms world → screen coordinates
│   └── CoordinateTransform.worldToScreen()
├── Accounts for image placement scaling
├── Draws crosshair lines within image bounds
└── Uses green color (#00ff00) with dashed lines

MosaicCell crosshair rendering (line 140-183)
├── Similar transformation pipeline
├── Different alpha values:
│   ├── Active/hovered cells: alpha = 1.0
│   └── Other cells: alpha = 0.2
└── Ensures crosshair visibility across grid
```

### 4.2 Crosshair Synchronization

```
SliceNavigationService.updateSlicePosition (line 105-123)
├── Called by slice sliders
├── Updates specific axis based on viewType
├── Calls setCrosshair with immediate flag
└── Ensures responsive slider interaction

ViewState synchronization
├── All views share same crosshair.world_mm
├── Each view's origin updated to show crosshair
├── Backend ensures consistent rendering
└── Frontend overlays provide immediate feedback
```

---

## Summary of Key Differences

### Responsive vs Fixed Design

**FlexibleOrthogonalView** implements a complete responsive pipeline:
- ResizeObserver → Store Update → Backend Recalc → Re-render

**MosaicView** uses static dimensions:
- Initial calculation → Fixed forever → No resize response

### Click Handling Sophistication

**SliceView** provides pixel-perfect anatomical targeting:
- Canvas click → Multi-stage coordinate transform → Exact world position

**MosaicCell** only allows slice selection:
- Div click → Slice position only → No in-slice targeting

### Architectural Patterns

The codebase shows two distinct approaches:
1. **Modern responsive pattern** (FlexibleOrthogonalView): Event-driven, reactive, backend-synchronized
2. **Legacy static pattern** (MosaicView): Pre-calculated, fixed dimensions, limited interaction

The investigation report's recommendations align with bringing MosaicView up to the standards set by FlexibleOrthogonalView's implementation.
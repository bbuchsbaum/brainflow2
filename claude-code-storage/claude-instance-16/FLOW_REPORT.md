# MosaicView Slice Navigation Flow Analysis Report

## Executive Summary

This report provides a comprehensive analysis of the execution flow for MosaicView's slice navigation system, identifying critical failure points, circular dependencies, and performance bottlenecks that cause navigation controls to malfunction. The analysis reveals multiple interconnected issues across UI rendering, state management, and backend communication pathways.

## Critical Flow Failures Identified

### 1. **SliceSlider Interface Mismatch - FATAL**
**Impact**: Complete slider functionality breakdown
**Root Cause**: Interface incompatibility between MosaicView usage and SliceSlider component

**Execution Flow:**
```
MosaicView.tsx:668-677 → SliceSlider props mismatch → Slider non-functional
├── MosaicView passes: min, max, step, value, onChange, label, showValue
└── SliceSlider expects: viewType, value, min, max, step, disabled, onChange
    ❌ Missing required viewType prop
    ❌ Extra props (label, showValue) not in interface
```

**Code Analysis:**
```typescript
// MosaicView usage (INCORRECT):
<SliceSlider
  min={0}
  max={Math.max(0, totalPages - 1)}
  step={1}
  value={currentPage}
  onChange={handleSliderChange}
  label={`Navigate Pages (${totalSlices} total slices)`}  // ❌ Not in interface
  showValue={false}  // ❌ Not in interface
/>

// Actual SliceSlider interface:
interface SliceSliderProps {
  viewType: ViewType;  // ❌ Missing in MosaicView
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}
```

### 2. **CSS Layout Clipping - SEVERE**
**Impact**: Navigation controls invisible unless window is narrow
**Root Cause**: Flexbox layout with fixed control height assumption

**Execution Flow:**
```
Container Resize → Cell Dimension Calculation → Layout Rendering
├── containerDimensions.height (dynamic)
├── controlsHeight = 100 (FIXED CONSTANT - Line 439)
├── availableHeight = height - padding - gaps - controlsHeight
└── Grid takes flex-1 (grows to fill space)
    ❌ Controls positioned at bottom may overflow container
    ❌ No dynamic measurement of actual control dimensions
```

**Problem Chain:**
1. `controlsHeight = 100` hardcoded (MosaicView.tsx:439)
2. Grid uses `flex-1` class (expands to fill available space)
3. Controls positioned at bottom with fixed space allocation
4. When container is tall, grid expands beyond visible area
5. Controls pushed off-screen or clipped

### 3. **Infinite Loop in Page Updates - CRITICAL**
**Impact**: Excessive re-renders, performance degradation, potential browser freeze
**Root Cause**: Circular dependency in useEffect

**Execution Flow:**
```
Crosshair Change → useEffect Trigger → Page Update → State Change → useEffect Trigger (LOOP)
                     ↑______________________________________________|
```

**Code Analysis:**
```typescript
// MosaicView.tsx:525-534 - PROBLEMATIC DEPENDENCY ARRAY
useEffect(() => {
  const actualMin = Math.min(sliceRange.min, sliceRange.max);
  const positiveStep = Math.abs(sliceRange.step);
  const currentSliceIndex = Math.floor((sliceRange.current - actualMin) / positiveStep);
  const newPage = Math.floor(currentSliceIndex / gridSize);
  if (newPage !== currentPage && newPage >= 0 && newPage < totalPages) {
    setCurrentPage(newPage);  // ← Triggers re-render
  }
}, [sliceRange.current, sliceRange.min, sliceRange.max, sliceRange.step, gridSize, totalPages, currentPage]);
//                                                                                                      ^^^^^^^^^^^
//                                                                                              CIRCULAR DEPENDENCY
```

## Complete Execution Flow Analysis

### 4. **UI Rendering Flow**

#### 4.1 Container Resize Path
```
ResizeObserver (MosaicView.tsx:408) → containerDimensions update
├── Width/Height measurement
├── Cell dimension calculation (lines 433-463)
│   ├── padding = 32
│   ├── gap = 8
│   ├── controlsHeight = 100 (HARDCODED)
│   ├── availableWidth = width - padding - totalGapsX
│   ├── availableHeight = height - padding - totalGapsY - controlsHeight
│   ├── cellWidth = availableWidth / columns
│   └── cellHeight = availableHeight / rows
├── setCellDimensions trigger
└── updateMosaicView call (throttled 200ms)
    ├── lastSentDimensionsRef comparison
    ├── Layer validation
    ├── Backend API call: recalculateViewForDimensions
    ├── ViewState update via useViewStateStore
    └── coalesceUtils.flush(true)
```

#### 4.2 Navigation Controls Visibility Flow
```
Container Layout (flex flex-col h-full)
├── Header (fixed height)
├── Grid (flex-1 - expands to fill)
│   └── Takes: height - header - controls - padding
└── Navigation Controls (fixed at bottom)
    ├── Position depends on available space
    ├── May be clipped if grid overflows
    └── No dynamic height measurement
```

### 5. **User Interaction Flow**

#### 5.1 Prev/Next Button Click Path
```
Button Click → handlePageChange(currentPage ± 1)
├── Boundary check: newPage >= 0 && newPage < totalPages
├── setCurrentPage(newPage) if valid
├── React re-render triggered
├── slicePositions recalculation (useMemo)
│   ├── startSliceIndex = currentPage * gridSize
│   ├── endSliceIndex = min(startSliceIndex + gridSize, totalSlices)
│   └── Generate positions: actualMin + (i * positiveStep)
└── MosaicCell re-renders with new slice positions
    ├── Each cell gets new slicePosition prop
    ├── useEffect triggers in MosaicCell (line 105)
    ├── renderSlice() called for each cell
    ├── RenderCoordinator.requestRender() called
    ├── Backend render with sliceOverride
    └── Canvas update with new image
```

#### 5.2 Slider Interaction Flow (BROKEN)
```
Slider Change → handleSliderChange(value)
├── newPage = Math.floor(value)
├── handlePageChange(newPage)
└── ❌ FAILS due to interface mismatch
    ├── SliceSlider expects viewType prop (missing)
    ├── SliceSlider ignores unknown props (label, showValue)
    └── onChange may not fire correctly
```

#### 5.3 Slice Cell Click Flow
```
Canvas Click → handleCanvasClick (MosaicCell:67)
├── Canvas coordinate calculation
├── Image bounds checking (imagePlacementRef)
├── Image coordinate transformation
├── Screen to world coordinate conversion (CoordinateTransform.screenToWorld)
├── onCrosshairClick() callback
├── useViewStateStore.setCrosshair() call
└── Crosshair state propagation
    ├── ViewStateStore.setCrosshair (lines 150-249)
    ├── Resize wait (pending resize check)
    ├── State update with coalescing
    ├── View plane origin updates for all orientations
    ├── Backend API calls for each view (fire-and-forget)
    └── Re-render cascade across all components
```

### 6. **State Synchronization Flow**

#### 6.1 ViewState Update Cascade
```
State Change → Coalescing Middleware → Backend Sync → Re-render
├── coalescedSet() call (coalesceUpdatesMiddleware.ts:167)
├── Immediate UI update (set(updater))
├── pendingState storage
├── requestAnimationFrame scheduling
├── flushState() execution
│   ├── Drag state check (layoutDragStore)
│   ├── Backend callback execution
│   └── lastFlushedState update
└── Component re-renders
    ├── MosaicView re-render
    ├── MosaicCell re-renders (each cell)
    ├── Navigation controls re-render
    └── Potential infinite loop if circular dependencies exist
```

#### 6.2 SliceNavigationService Integration
```
getSliceRange() Call → Layer Store Query → Metadata Lookup
├── useLayerStore.getState().layers access
├── Bottom layer identification (layers[0])
├── Layer metadata retrieval (getLayerMetadata)
├── World bounds extraction
├── View type axis mapping:
│   ├── axial: Z-axis (worldBounds min/max[2])
│   ├── sagittal: X-axis (worldBounds min/max[0])
│   └── coronal: Y-axis (worldBounds min/max[1])
├── Current position from viewState.crosshair.world_mm
└── SliceRange object construction
    ├── min: worldBounds.min[axis]
    ├── max: worldBounds.max[axis]
    ├── step: 1 (hardcoded)
    └── current: crosshair position for axis
```

### 7. **Page Calculation and Slice Position Generation**

#### 7.1 Page Calculation Path
```
Slice Range → Total Slices → Total Pages → Current Page
├── actualRange = abs(sliceRange.max - sliceRange.min)
├── totalSlices = floor(actualRange / abs(sliceRange.step)) + 1
├── totalPages = ceil(totalSlices / gridSize)
├── Current slice index calculation:
│   ├── actualMin = min(sliceRange.min, sliceRange.max)
│   ├── positiveStep = abs(sliceRange.step)
│   ├── currentSliceIndex = floor((sliceRange.current - actualMin) / positiveStep)
│   └── newPage = floor(currentSliceIndex / gridSize)
└── Page validation and update
```

#### 7.2 Slice Position Generation (useMemo)
```
Page Change → Position Array Generation
├── startSliceIndex = currentPage * gridSize
├── endSliceIndex = min(startSliceIndex + gridSize, totalSlices)
├── Loop: i from startSliceIndex to endSliceIndex
│   ├── slicePosition = actualMin + (i * positiveStep)
│   ├── Boundary check: slicePosition <= actualMax
│   └── positions.push(slicePosition)
└── positions array returned
    ├── Used for MosaicCell rendering
    ├── Each position triggers individual render
    └── Potential performance bottleneck for large grids
```

### 8. **Re-render Cycles and Performance Issues**

#### 8.1 Excessive Render Trigger Points
```
Multiple Render Triggers → Performance Degradation
├── Container resize (ResizeObserver)
├── Page navigation (setCurrentPage)
├── Crosshair updates (setCrosshair)
├── Layer changes (useLayerStore)
├── Orientation changes (handleOrientationChange)
├── Cell clicks (handleSliceClick)
└── Each trigger causes:
    ├── MosaicView re-render
    ├── All MosaicCell re-renders (rows * columns)
    ├── Backend API calls (potentially throttled)
    ├── Canvas redraws
    └── State synchronization overhead
```

#### 8.2 Throttling and Debouncing Issues
```
Update Throttling → Potential Race Conditions
├── updateMosaicView throttled (200ms)
├── RenderCoordinator debouncing (200ms for resize)
├── Coalescing middleware (requestAnimationFrame)
└── Race conditions between:
    ├── Multiple throttled updates
    ├── State changes during throttle periods
    ├── Backend responses arriving out of order
    └── UI updates not matching backend state
```

### 9. **Backend Communication Flow**

#### 9.1 Render Request Path
```
MosaicCell.renderSlice() → RenderCoordinator → Backend API
├── renderCoordinator.requestRender() call
├── RenderRequest object creation:
│   ├── viewState: current ViewState
│   ├── viewType: orientation
│   ├── width/height: backendDimensions
│   ├── reason: 'layer_change'
│   ├── priority: 'normal'
│   └── sliceOverride: { axis, position }
├── Queue management (RenderCoordinator:52-73)
├── Job processing (executeRenderJob)
│   ├── View parameter validation
│   ├── apiService.applyAndRenderViewStateCore()
│   ├── Backend render target creation
│   └── ImageBitmap response
└── Canvas rendering (drawScaledImage)
    ├── Aspect ratio preservation
    ├── Image placement calculation
    └── Crosshair overlay drawing
```

#### 9.2 Dimension Update Path
```
Resize → Backend Recalculation → View State Update
├── apiService.recalculateViewForDimensions() call
├── Backend ViewRectMm::full_extent() calculation
├── Square pixel preservation
├── Anatomical extent coverage
├── View plane parameter calculation:
│   ├── origin_mm: world position
│   ├── u_mm: per-pixel X displacement
│   ├── v_mm: per-pixel Y displacement
│   └── dim_px: backend-calculated dimensions
├── ViewState store update
└── Render cascade trigger
```

## Critical Failure Points Summary

### 1. **Immediate Failures** (Prevent basic functionality)
- **SliceSlider Interface Mismatch**: Navigation slider completely non-functional
- **CSS Layout Clipping**: Controls invisible in many container sizes
- **Infinite Loop Risk**: currentPage dependency causing potential re-render loops

### 2. **Performance Degradation Points**
- **Excessive Cell Renders**: Each mosaic cell triggers individual backend calls
- **Throttling Race Conditions**: Multiple throttled updates competing
- **State Sync Overhead**: Coalescing middleware with complex dependency chains

### 3. **State Synchronization Issues**
- **Circular Dependencies**: useEffect with currentPage in dependency array
- **Race Conditions**: Backend responses vs. UI state updates
- **Metadata Timing**: SliceNavigationService depends on layer metadata availability

### 4. **Layout and Positioning Problems**
- **Fixed Control Height**: Hardcoded 100px doesn't match actual control dimensions
- **Flexbox Overflow**: Grid expansion pushing controls off-screen
- **No Responsive Handling**: Fixed layout assumptions break on different container sizes

## Recommended Fix Priority

### **CRITICAL (Fix First)**
1. **Remove SliceSlider Interface Mismatch**
   - Create generic slider or fix SliceSlider to accept MosaicView props
   - Add missing viewType prop or make it optional

2. **Fix Infinite Loop Dependency**
   - Remove currentPage from useEffect dependency array
   - Prevent circular state updates

3. **Dynamic Control Height Calculation**
   - Replace hardcoded controlsHeight with dynamic measurement
   - Use ref and ResizeObserver for actual control dimensions

### **HIGH (Fix Second)**
1. **Optimize Render Performance**
   - Reduce individual cell render calls
   - Implement better throttling coordination
   - Add render request deduplication

2. **Fix Layout Overflow**
   - Implement proper responsive design
   - Add overflow handling for navigation controls
   - Ensure controls always visible

### **MEDIUM (Enhance)**
1. **State Synchronization Improvements**
   - Better error handling for async operations
   - Improved race condition management
   - Enhanced debugging for state updates

This comprehensive flow analysis reveals that the MosaicView navigation system suffers from multiple interconnected issues that compound to create a poor user experience. The fixes must be implemented in the recommended priority order to restore basic functionality before addressing performance and enhancement concerns.
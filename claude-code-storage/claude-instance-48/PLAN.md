# COMPREHENSIVE PLAN TO FIX MOSAICVIEW RENDERING ISSUE

## EXECUTIVE SUMMARY

**Problem**: MosaicView displays only the upper left quarter of images (appears way zoomed in) while SliceView renders perfectly. This is caused by MosaicRenderService incorrectly modifying view plane dimensions, forcing the backend to render as if looking through a small viewport.

**Root Cause**: MosaicRenderService modifies `ViewPlane.dim_px` to mosaic cell dimensions (256x256) instead of trusting the backend's natural view setup like SliceView does. This creates an incorrect "viewport" effect where only a fraction of the image is visible.

**Solution**: Make MosaicView trust the backend's view setup completely, just like SliceView, and only change the slice position for each cell.

---

## ROOT CAUSE ANALYSIS

### Primary Issue: Incorrect ViewPlane Dimension Modification

**Location**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/MosaicRenderService.ts:390`

```typescript
// ❌ PROBLEM: Forces small viewport dimensions 
dim_px: [width, height] as [number, number]  // [256, 256]
```

**Impact**: 
- Backend receives ViewPlane with 256x256 dimensions
- Backend renders as if viewing through a 256px viewport into a much larger image
- Only upper-left quarter is visible in the rendered result
- Creates "zoomed in" appearance

### Why SliceView Works Correctly

**SliceView Architecture**:
1. Uses natural ViewState from backend without modification
2. Backend creates appropriately sized ViewPlane based on view requirements
3. Frontend receives full image that fills the available space
4. Canvas scaling happens in frontend, not backend

**MosaicView Problem**:
1. Modifies ViewPlane dimensions to cell size (256x256)
2. Backend thinks it's rendering for a 256px viewport
3. Backend applies inappropriate scaling/framing
4. Results in cropped/zoomed view

### Secondary Issues

1. **Resource Exhaustion**: Missing ImageBitmap cleanup accelerates GPU memory depletion
2. **Cascade Failures**: Promise.all architecture causes grid-wide failures  
3. **Complex View Modifications**: Unnecessary coordinate system manipulation

---

## IMPLEMENTATION PLAN

### PHASE 1: CORE ARCHITECTURE FIX (HIGH PRIORITY)

**Objective**: Make MosaicView trust backend view setup like SliceView

#### 1.1 Simplify View State Creation

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/MosaicRenderService.ts`

**Problem Lines 284-420**: `createSliceViewState()` method over-engineers the view setup

**Solution**: Replace complex view plane modification with minimal slice position update

**Changes**:
1. **Lines 286-420**: Replace entire `createSliceViewState()` method:

```typescript
private async createSliceViewState(
  baseViewState: ViewState,
  axis: 'axial' | 'sagittal' | 'coronal',
  sliceIndex: number,
  width: number,
  height: number
): Promise<ViewState> {
  // Get visible layers for bounds calculation
  const visibleLayers = baseViewState.layers.filter(l => l.visible && l.opacity > 0);
  if (visibleLayers.length === 0) {
    return baseViewState;
  }

  // Calculate combined bounds (keep existing logic)
  let combinedBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };
  
  for (const layer of visibleLayers) {
    if (layer.volumeId) {
      try {
        const bounds = await this.apiService.getVolumeBounds(layer.volumeId);
        combinedBounds.min[0] = Math.min(combinedBounds.min[0], bounds.min[0]);
        combinedBounds.min[1] = Math.min(combinedBounds.min[1], bounds.min[1]);
        combinedBounds.min[2] = Math.min(combinedBounds.min[2], bounds.min[2]);
        combinedBounds.max[0] = Math.max(combinedBounds.max[0], bounds.max[0]);
        combinedBounds.max[1] = Math.max(combinedBounds.max[1], bounds.max[1]);
        combinedBounds.max[2] = Math.max(combinedBounds.max[2], bounds.max[2]);
      } catch (error) {
        console.warn(`Failed to get bounds for volume ${layer.volumeId}:`, error);
      }
    }
  }

  // Use default bounds if needed
  if (!isFinite(combinedBounds.min[0])) {
    combinedBounds = {
      min: [-96, -132, -78],
      max: [96, 96, 114]
    };
  }

  // Calculate slice position (keep existing logic)
  let sliceMin: number, sliceMax: number;
  switch (axis) {
    case 'axial':
      sliceMin = combinedBounds.min[2];
      sliceMax = combinedBounds.max[2];
      break;
    case 'sagittal':
      sliceMin = combinedBounds.min[0];
      sliceMax = combinedBounds.max[0];
      break;
    case 'coronal':
      sliceMin = combinedBounds.min[1];
      sliceMax = combinedBounds.max[1];
      break;
  }

  const sliceRange = sliceMax - sliceMin;
  const totalSlices = Math.ceil(sliceRange);
  const slicePosition_mm = sliceMin + (sliceIndex * (sliceRange / totalSlices));

  // ✅ CRITICAL FIX: Create a completely new ViewState with only the crosshair modified
  // DO NOT modify the ViewPlane at all - let backend handle all framing naturally
  const modifiedViewState: ViewState = {
    ...baseViewState,
    crosshair: {
      world_mm: (() => {
        // Create crosshair at the slice position
        const crosshair: [number, number, number] = [...baseViewState.crosshair.world_mm];
        switch (axis) {
          case 'axial':
            crosshair[2] = slicePosition_mm;
            break;
          case 'sagittal':
            crosshair[0] = slicePosition_mm;
            break;
          case 'coronal':
            crosshair[1] = slicePosition_mm;
            break;
        }
        return crosshair;
      })(),
      visible: false // Let cells draw crosshairs themselves
    }
  };

  console.log(`[MosaicRenderService] Simple slice setup for ${axis} slice ${sliceIndex}:`, {
    slicePosition_mm,
    crosshair: modifiedViewState.crosshair.world_mm,
    preservedViews: 'unchanged - backend handles framing'
  });

  return modifiedViewState;
}
```

**Impact**: 
- Eliminates ViewPlane dimension modification completely
- Trusts backend to create proper view framing like SliceView
- Only modifies crosshair position to slice location
- Removes source of "zoomed in" appearance

#### 1.2 Update Rendering Pipeline

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/MosaicRenderService.ts`

**Lines 85-92**: Update render call to pass backend dimensions

```typescript
// ✅ Let backend use natural dimensions, not forced mosaic cell size
const imageBitmap = await this.apiService.applyAndRenderViewState(
  modifiedViewState,
  axis,
  // Remove width/height - let backend use natural ViewPlane dimensions
  undefined,
  undefined
);
```

### PHASE 2: RESOURCE MANAGEMENT IMPROVEMENTS (MEDIUM PRIORITY)

**Objective**: Fix memory leaks and cascade failures identified in investigation

#### 2.1 Already Fixed: ImageBitmap Lifecycle Management

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicCell.tsx`

✅ **Good News**: Lines 278-295 already implement proper ImageBitmap cleanup:

```typescript
const handleImageReceived = useCallback((imageBitmap: ImageBitmap) => {
  // Dispose previous bitmap to prevent memory leaks
  if (lastImageRef.current) {
    lastImageRef.current.close();  // ✅ Already implemented
    resourceMonitor.current.deallocate();
  }
  // ...
}, [tag]);
```

**Status**: No changes needed - proper cleanup already exists

#### 2.2 Improve Sequential Rendering  

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/MosaicRenderService.ts`

✅ **Good News**: Lines 133-178 already implement batched rendering instead of Promise.all:

```typescript
// Process batches sequentially, but items within each batch in parallel
for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
  const batch = batches[batchIndex];
  // Process batch with controlled concurrency
  const batchResults = await Promise.all(batchPromises); // ✅ Already batched
}
```

**Status**: Architecture already improved from original Promise.all cascade issue

### PHASE 3: DEFENSIVE PROGRAMMING (LOW PRIORITY)

**Objective**: Add safeguards for edge cases

#### 3.1 Add Dimension Validation

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/services/MosaicRenderService.ts`

**Add after line 86**: Validate that we received a proper ImageBitmap

```typescript
// Validate the rendered result
if (!imageBitmap) {
  throw new Error('Backend returned null ImageBitmap');
}

if (imageBitmap.width === 0 || imageBitmap.height === 0) {
  throw new Error(`Backend returned invalid ImageBitmap dimensions: ${imageBitmap.width}x${imageBitmap.height}`);
}

console.log(`[MosaicRenderService] Received valid ImageBitmap: ${imageBitmap.width}x${imageBitmap.height} for ${cellId}`);
```

#### 3.2 Add Error Boundaries for Individual Cells

**File**: `/Users/bbuchsbaum/code/brainflow2/ui2/src/components/views/MosaicViewPromise.tsx`

**Add around line 270**: Wrap each MosaicCell in an error boundary

```typescript
import { ErrorBoundary } from 'react-error-boundary';

// In the render method, wrap MosaicCell:
<ErrorBoundary
  key={cellId}
  fallback={<div className="flex items-center justify-center h-full text-red-500">Cell Error</div>}
  onError={(error) => console.error(`MosaicCell ${cellId} error:`, error)}
>
  <MosaicCell
    width={cellSize.width}
    height={cellSize.height}
    tag={cellId}
    sliceIndex={sliceIndex}
    axis={sliceAxis}
    onCrosshairClick={handleCrosshairClick}
  />
</ErrorBoundary>
```

### PHASE 4: VERIFICATION & TESTING

**Objective**: Comprehensive validation of fixes

#### 4.1 Visual Verification

**Expected Results**:
- ✅ MosaicView cells show full brain slices (not cropped)
- ✅ Images appear at correct scale (same as SliceView)  
- ✅ All 16 cells in 4x4 grid display properly
- ✅ No "upper left quarter" cropping
- ✅ Images maintain proper aspect ratio

#### 4.2 Technical Validation

**Console Checks**:
1. No "Backend returned invalid ImageBitmap dimensions" errors
2. All cells receive properly sized ImageBitmaps
3. No cascade failures in batch processing
4. Crosshairs display correctly on relevant slices

**DOM Inspection**:
1. All mosaic cell canvases have non-zero content
2. ImageBitmap dimensions match expected backend output
3. Resource monitor shows proper cleanup

#### 4.3 Performance Validation

**Memory Monitoring**:
- ImageBitmap count remains stable during navigation
- No continuous memory growth
- Proper cleanup on component unmount

**Rendering Performance**:
- Batched rendering completes successfully
- No individual cell failures cause grid-wide issues
- Smooth navigation between mosaic pages

---

## IMPLEMENTATION SEQUENCE

```
Phase 1: Core Fix (Blocking)
├── 1.1 Simplify createSliceViewState() method
├── 1.2 Update render pipeline to use natural dimensions  
└── Test: Verify cells show full images, not cropped

Phase 2: Resource Management (Already Done)
├── 2.1 ✅ ImageBitmap cleanup already implemented
└── 2.2 ✅ Batched rendering already implemented

Phase 3: Defensive Programming (Enhancement)  
├── 3.1 Add ImageBitmap validation
├── 3.2 Add error boundaries per cell
└── Test: Verify graceful error handling

Phase 4: Final Validation
├── 4.1 Visual verification of correct scaling
├── 4.2 Technical validation of rendering pipeline
└── 4.3 Performance validation of memory management
```

## RISK MITIGATION

### Potential Issues & Solutions

1. **Backend API expects specific parameters**
   - **Risk**: `applyAndRenderViewState` might require width/height
   - **Solution**: Check API signature; pass natural dimensions if required
   - **Test**: Monitor backend logs for parameter validation errors

2. **Natural dimensions too large for mosaic cells**
   - **Risk**: Backend renders huge images that don't fit in 256x256 cells
   - **Solution**: Frontend scaling in MosaicCell already handles this
   - **Verification**: MosaicCell uses canvas scaling for display

3. **Crosshair calculations need ViewPlane dimensions**
   - **Risk**: Crosshair positioning might break with natural dimensions
   - **Solution**: MosaicCell already calculates crosshairs from actual ViewPlane
   - **Code**: Lines 74-105 in MosaicCell use `viewState.views[axis]`

## SUCCESS CRITERIA

### Primary Success (Phase 1)
1. ✅ MosaicView displays full brain images (not upper-left quarter)
2. ✅ Images appear at same scale/quality as SliceView
3. ✅ All 16 cells in grid render successfully
4. ✅ No cropping or "zoomed in" appearance

### Secondary Success (Phase 3)
1. ✅ Graceful error handling for individual cell failures  
2. ✅ Stable memory usage with proper ImageBitmap cleanup
3. ✅ Crosshairs display correctly on all relevant slices
4. ✅ Smooth performance during mosaic navigation

## TECHNICAL INSIGHT

**Key Understanding**: The "upper left quarter" issue is a classic viewport rendering problem. When MosaicRenderService forces `dim_px: [256, 256]` on the ViewPlane, it tells the backend to render as if looking through a 256px square viewport into a much larger image space. The backend correctly renders what it thinks is requested - a 256px view of the data - but this creates the appearance of being "zoomed in" because only a fraction of the full extent is visible.

**Solution Elegance**: By eliminating ViewPlane modification and trusting the backend's natural view setup (like SliceView does), we get properly framed images that the frontend can then scale to fit mosaic cells. This separates concerns correctly: backend handles image framing, frontend handles display scaling.

**Backward Compatibility**: This change makes MosaicView work more like SliceView, which is actually an improvement in architectural consistency. The fix aligns with the project's principle of "heavy computation in Rust backend, lightweight frontend display."

---

## QUICK START

**For immediate fix**, make these two changes to MosaicRenderService.ts:

1. **Line 390**: Remove dimension override:
```typescript
// ❌ Remove this line:
// dim_px: [width, height] as [number, number]

// ✅ Don't modify dim_px at all - use original ViewPlane
```

2. **Lines 87-92**: Let backend use natural dimensions:
```typescript
const imageBitmap = await this.apiService.applyAndRenderViewState(
  modifiedViewState,
  axis
  // Remove width, height parameters
);
```

This should immediately resolve the "upper left quarter" cropping issue.
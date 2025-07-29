# MosaicView Fix Implementation Plan

## Overview

This plan addresses the critical issues identified in the MosaicView component:
1. Page navigation buttons appearing broken (but actually working differently than expected)
2. MosaicCell rendering failures due to dimension mismatches
3. Missing error handling and edge case coverage
4. Architectural improvements for better performance and maintainability

## Phase 1: Immediate Fixes (Priority: Critical)

### 1.1 Fix Navigation UI/UX Mismatch

**Problem**: The navigation uses a sliding window approach but the UI suggests page-based navigation.

**Files to modify**:
- `/ui2/src/components/views/MosaicView.tsx` (lines 666-684, 570-573, 628-636)

**Changes**:
1. Update the status text from "Slice X / Y" to "Slices X-Y of Z":
   ```typescript
   // Line 631-632: Update the display text
   <span className="text-xs text-gray-400">
     Slices {firstSliceIdx + 1}-{Math.min(firstSliceIdx + gridSize, allSlices.length)} of {allSlices.length}
   </span>
   ```

2. Alternatively, revert to true page-based navigation:
   ```typescript
   // Replace firstSliceIdx with currentPage
   const [currentPage, setCurrentPage] = useState(0);
   const totalPages = Math.ceil(allSlices.length / gridSize);
   const startIdx = currentPage * gridSize;
   const endIdx = Math.min(startIdx + gridSize, allSlices.length);
   const slicePositions = allSlices.slice(startIdx, endIdx);
   
   // Update handlePageChange to use pages
   const handlePageChange = (delta: number) => {
     setCurrentPage(page => clamp(page + delta, 0, totalPages - 1));
   };
   ```

### 1.2 Fix Canvas Dimension Mismatch

**Problem**: Canvas uses backend dimensions but is styled to fit cell dimensions, causing rendering failures.

**Files to modify**:
- `/ui2/src/components/views/MosaicView.tsx` (MosaicCell component, lines 249-259)
- `/ui2/src/services/RenderCoordinator.ts` (if dimension validation exists)

**Changes**:
1. Use consistent dimensions for canvas and render request:
   ```typescript
   // In MosaicCell (around line 119)
   const renderDimensions = [
     Math.min(dimensions.width, backendDimensions[0]),
     Math.min(dimensions.height, backendDimensions[1])
   ];
   
   // Update canvas element (lines 249-259)
   <canvas
     ref={canvasRef}
     width={renderDimensions[0]}
     height={renderDimensions[1]}
     style={{
       width: `${dimensions.width}px`,
       height: `${dimensions.height}px`,
       objectFit: 'contain'
     }}
   />
   
   // Update render request
   const imageBitmap = await renderCoordinator.requestRender({
     viewState: viewState,
     viewType: orientation,
     width: renderDimensions[0],
     height: renderDimensions[1],
     // ... rest of params
   });
   ```

### 1.3 Add Proper Error Recovery

**Problem**: Silent failures with no retry mechanism.

**Files to modify**:
- `/ui2/src/components/views/MosaicView.tsx` (MosaicCell component, lines 106-230)

**Changes**:
1. Add retry logic and better error states:
   ```typescript
   // Add retry state
   const [retryCount, setRetryCount] = useState(0);
   const MAX_RETRIES = 3;
   
   // Modify renderSlice function
   const renderSlice = useCallback(async () => {
     try {
       // Existing validation checks...
       if (!canvasRef.current) {
         setError('Canvas not ready');
         if (retryCount < MAX_RETRIES) {
           setTimeout(() => {
             setRetryCount(count => count + 1);
           }, 100 * (retryCount + 1));
         }
         return;
       }
       
       // ... rest of render logic
       
       // On success, reset retry count
       setRetryCount(0);
       setError(null);
     } catch (err) {
       const errorMsg = err instanceof Error ? err.message : 'Unknown error';
       console.error(`[MosaicCell] Render failed (attempt ${retryCount + 1}):`, errorMsg);
       setError(errorMsg);
       
       if (retryCount < MAX_RETRIES) {
         setTimeout(() => {
           setRetryCount(count => count + 1);
         }, 500 * (retryCount + 1));
       }
     }
   }, [/* deps */, retryCount]);
   
   // Trigger retry when retryCount changes
   useEffect(() => {
     if (retryCount > 0) {
       renderSlice();
     }
   }, [retryCount]);
   ```

## Phase 2: Core Issues (Priority: High)

### 2.1 Fix Slice Range Edge Cases

**Problem**: makeAscending function assumes positive steps and may not handle edge cases correctly.

**Files to modify**:
- `/ui2/src/components/views/MosaicView.tsx` (lines 509-522)

**Changes**:
1. Improve makeAscending to handle all cases:
   ```typescript
   const makeAscending = (min: number, max: number, step: number) => {
     if (step === 0) {
       console.warn('[MosaicView] Step is 0, using default step of 1');
       step = 1;
     }
     
     const list: number[] = [];
     const safeMin = Math.min(min, max);
     const safeMax = Math.max(min, max);
     const safeStep = Math.abs(step);
     
     // Always generate in ascending order
     for (let v = safeMin; v <= safeMax; v += safeStep) {
       list.push(v);
     }
     
     // If original range was descending, reverse the list
     if (min > max) {
       list.reverse();
     }
     
     return list;
   };
   ```

### 2.2 Improve SliceOverride Implementation

**Problem**: Double modification of both crosshair and view origin causes inconsistencies.

**Files to modify**:
- `/ui2/src/services/apiService.ts` (sliceOverride handling in applyAndRenderViewStateCore)

**Changes**:
1. Simplify to only modify crosshair position:
   ```typescript
   // In applyAndRenderViewStateCore
   if (sliceOverride && viewType) {
     const axisIndex = sliceOverride.axis === 'x' ? 0 : 
                       sliceOverride.axis === 'y' ? 1 : 2;
     const newWorldMm = [...viewState.crosshair.world_mm];
     newWorldMm[axisIndex] = sliceOverride.position;
     
     // Only update crosshair, let backend calculate view origin
     modifiedViewState = {
       ...viewState,
       crosshair: {
         ...viewState.crosshair,
         world_mm: newWorldMm
       }
     };
   }
   ```

### 2.3 Add View Caching

**Problem**: Each MosaicCell independently calculates views, causing performance issues.

**Files to modify**:
- Create new file: `/ui2/src/hooks/useMosaicViewCache.ts`
- `/ui2/src/components/views/MosaicView.tsx` (integrate cache)

**Changes**:
1. Create view cache hook:
   ```typescript
   // useMosaicViewCache.ts
   export function useMosaicViewCache(orientation: ViewType, volumeId: string) {
     const cacheRef = useRef<Map<number, CachedView>>(new Map());
     
     const getCachedView = useCallback((slicePosition: number) => {
       const key = slicePosition;
       return cacheRef.current.get(key);
     }, []);
     
     const setCachedView = useCallback((slicePosition: number, view: ViewState) => {
       cacheRef.current.set(slicePosition, {
         view,
         timestamp: Date.now()
       });
       
       // Limit cache size
       if (cacheRef.current.size > 100) {
         const oldestKey = Array.from(cacheRef.current.entries())
           .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
         cacheRef.current.delete(oldestKey);
       }
     }, []);
     
     const clearCache = useCallback(() => {
       cacheRef.current.clear();
     }, []);
     
     // Clear cache when volume or orientation changes
     useEffect(() => {
       clearCache();
     }, [orientation, volumeId]);
     
     return { getCachedView, setCachedView, clearCache };
   }
   ```

## Phase 3: Architecture Improvements (Priority: Medium)

### 3.1 Implement Per-Cell View States

**Problem**: All cells share a single view state causing race conditions.

**Files to modify**:
- `/ui2/src/stores/viewStateStore.ts` (add mosaic-specific state)
- `/ui2/src/components/views/MosaicView.tsx` (use per-cell states)

**Changes**:
1. Add mosaic view state to store:
   ```typescript
   // In viewStateStore
   interface ViewStateStore {
     // ... existing fields
     mosaicViews: Map<string, OrthogonalView>; // key: "orientation-slicePosition"
     setMosaicView: (key: string, view: OrthogonalView) => void;
     getMosaicView: (key: string) => OrthogonalView | undefined;
   }
   ```

### 3.2 Batch Backend Requests

**Problem**: Multiple cells making independent backend requests.

**Files to modify**:
- `/ui2/src/services/RenderCoordinator.ts` (add batching logic)

**Changes**:
1. Add request batching:
   ```typescript
   // In RenderCoordinator
   private batchQueue: Map<string, BatchedRequest[]> = new Map();
   private batchTimer: NodeJS.Timeout | null = null;
   
   public requestBatchedRender(params: RenderRequestParams): Promise<ImageBitmap | null> {
     const batchKey = `${params.viewType}-${params.width}x${params.height}`;
     
     return new Promise((resolve, reject) => {
       if (!this.batchQueue.has(batchKey)) {
         this.batchQueue.set(batchKey, []);
       }
       
       this.batchQueue.get(batchKey)!.push({
         params,
         resolve,
         reject
       });
       
       if (!this.batchTimer) {
         this.batchTimer = setTimeout(() => {
           this.processBatches();
         }, 16); // Next frame
       }
     });
   }
   ```

## Phase 4: Testing and Validation (Priority: High)

### 4.1 Add E2E Tests for MosaicView

**Files to create**:
- `/e2e/tests/mosaic-view.spec.ts`

**Tests to implement**:
1. Navigation functionality
2. Slice rendering at boundaries
3. Error recovery
4. Performance with large grids
5. Dimension handling

### 4.2 Add Unit Tests

**Files to create**:
- `/ui2/src/components/views/__tests__/MosaicView.test.tsx`
- `/ui2/src/components/views/__tests__/MosaicCell.test.tsx`

**Tests to implement**:
1. makeAscending edge cases
2. Dimension calculations
3. Error state handling
4. Navigation state updates

## Implementation Order

1. **Day 1**: Phase 1.1, 1.2, 1.3 - Fix immediate user-facing issues
2. **Day 2**: Phase 2.1, 2.2 - Fix core logic issues
3. **Day 3**: Phase 2.3, 3.1 - Add caching and improve architecture
4. **Day 4**: Phase 3.2, 4.1, 4.2 - Optimize performance and add tests

## Success Metrics

1. **Navigation**: Clear page indication, working prev/next buttons
2. **Rendering**: All mosaic cells render without errors
3. **Performance**: <100ms to navigate between pages
4. **Reliability**: Automatic retry on transient failures
5. **Testing**: >90% code coverage for modified components

## Risk Mitigation

1. **Backup Current Implementation**: Keep MosaicView.backup.tsx as reference
2. **Feature Flag**: Add toggle for old vs new navigation behavior
3. **Gradual Rollout**: Test with small grids before large ones
4. **Performance Monitoring**: Add metrics for render times and cache hits

## Notes

- The window-based navigation is actually more efficient for large datasets
- Consider keeping it but improving the UI to make it clear
- The dimension mismatch is the primary cause of rendering failures
- View caching will significantly improve performance for large grids
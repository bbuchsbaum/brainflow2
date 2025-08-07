# MosaicView Rendering Fix Plan

## Executive Summary

This plan addresses the critical MosaicView rendering failure where only 3 out of 12 slices render successfully before cascading failure occurs. The root cause is a **resource exhaustion cascade failure** caused by concurrent rendering bottlenecks, missing ImageBitmap cleanup, and Promise.all fail-fast behavior.

## Problem Analysis Summary

### Primary Issues Identified
1. **Promise.all Cascade Failure**: Single render failure cancels all remaining renders
2. **Backend Resource Contention**: 16 simultaneous renders competing for mutex-protected RenderLoopService
3. **ImageBitmap Memory Leaks**: Missing `.close()` calls accelerate GPU resource exhaustion
4. **Event Routing Race Conditions**: Tag-based filtering unreliable under concurrent load
5. **No Error Boundaries**: Individual cell failures kill entire grid

### Why 3 Slices Succeed Before Failure
- **Cold Start**: Initial renders succeed with available GPU resources
- **Resource Depletion**: ImageBitmap accumulation exhausts GPU memory (~256KB per cell)
- **Limit Breach**: 4th render hits browser GPU context limits
- **Cascade Trigger**: Promise.all rejects all remaining 12 renders on first failure

---

## Phase 1: Critical Fixes (Highest Priority)

### 1.1 Replace Promise.all with Sequential Rendering

**Impact**: Eliminates cascade failures, allows partial success
**Files**: `/ui2/src/services/MosaicRenderService.ts`

**Changes**:
- Replace `Promise.all()` in `renderMosaicGrid()` (lines 148-154)
- Implement sequential processing with individual error handling
- Add configurable concurrency limits

**Implementation**:
```typescript
// Replace lines 148-154 in MosaicRenderService.ts
async renderMosaicGrid(requests: MosaicRenderRequest[]): Promise<void> {
    console.log(`[MosaicRenderService] Starting sequential rendering of ${requests.length} cells`);
    
    const results = { successful: 0, failed: 0, errors: [] };
    
    for (const request of requests) {
        try {
            await this.renderMosaicCell(request);
            results.successful++;
            console.log(`[MosaicRenderService] Cell ${request.cellId} rendered successfully (${results.successful}/${requests.length})`);
        } catch (error) {
            results.failed++;
            results.errors.push({ cellId: request.cellId, error });
            console.error(`[MosaicRenderService] Cell ${request.cellId} failed:`, error);
            // Continue with remaining cells instead of aborting
        }
    }
    
    console.log(`[MosaicRenderService] Batch complete: ${results.successful} successful, ${results.failed} failed`);
    
    if (results.failed > 0) {
        console.warn('[MosaicRenderService] Some cells failed to render:', results.errors);
        // Don't throw - allow partial success
    }
}
```

### 1.2 Implement ImageBitmap Lifecycle Management

**Impact**: Prevents GPU memory exhaustion, enables sustained rendering
**Files**: 
- `/ui2/src/components/views/MosaicCell.tsx` (lines 331-333)
- `/ui2/src/hooks/useRenderCanvas.ts` (lines 104-121)

**Changes**:
1. **Fix MosaicCell ImageBitmap handling**:
```typescript
// Replace lines 331-333 in MosaicCell.tsx
const handleImageReceived = useCallback((imageBitmap: ImageBitmap) => {
    // Dispose previous bitmap to prevent memory leaks
    if (lastImageRef.current) {
        lastImageRef.current.close();
        console.debug(`[MosaicCell ${tag}] Disposed previous ImageBitmap`);
    }
    lastImageRef.current = imageBitmap;
}, [tag]);

// Add cleanup effect
useEffect(() => {
    return () => {
        if (lastImageRef.current) {
            lastImageRef.current.close();
            lastImageRef.current = null;
            console.debug(`[MosaicCell ${tag}] Cleaned up ImageBitmap on unmount`);
        }
    };
}, [tag]);
```

2. **Fix useRenderCanvas ImageBitmap handling**:
```typescript
// Replace lines 104-121 in useRenderCanvas.ts
if (data.imageBitmap && canvasRef.current) {
    console.log(`[useRenderCanvas${tag ? ` ${tag}` : ''}] Drawing image to canvas`);
    setIsLoading(false);
    setError(null);
    
    // Dispose previous bitmap before storing new one
    if (lastImageRef.current) {
        lastImageRef.current.close();
        console.debug(`[useRenderCanvas${tag ? ` ${tag}` : ''}] Disposed previous ImageBitmap`);
    }
    
    // Store the image for redrawing
    lastImageRef.current = data.imageBitmap;
    
    // Draw the image
    const result = redrawCanvas();
    console.log(`[useRenderCanvas${tag ? ` ${tag}` : ''}] Draw result:`, result ? 'success' : 'failed');
}

// Add cleanup effect
useEffect(() => {
    return () => {
        if (lastImageRef.current) {
            lastImageRef.current.close();
            lastImageRef.current = null;
        }
    };
}, []);
```

### 1.3 Add Error Boundaries per MosaicCell

**Impact**: Isolates failures to individual cells, prevents grid-wide crashes
**Files**: 
- `/ui2/src/components/views/MosaicCellErrorBoundary.tsx` (new file)
- `/ui2/src/components/views/MosaicViewPromise.tsx` (wrap cells)

**Implementation**:
1. **Create MosaicCellErrorBoundary.tsx**:
```typescript
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    cellId: string;
    sliceIndex: number;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class MosaicCellErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error(`[MosaicCellErrorBoundary] ${this.props.cellId} crashed:`, error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center h-full bg-gray-100 border border-gray-300 text-gray-600">
                    <div className="text-sm font-medium">Slice {this.props.sliceIndex}</div>
                    <div className="text-xs">Render Error</div>
                </div>
            );
        }

        return this.props.children;
    }
}
```

2. **Update MosaicViewPromise.tsx to wrap cells**:
```typescript
// In the render section where cells are created
{sliceIndices.map((sliceIndex, i) => (
    <div key={cellIds[i]} className="mosaic-cell">
        <MosaicCellErrorBoundary cellId={cellIds[i]} sliceIndex={sliceIndex}>
            <MosaicCell
                width={cellSize.width}
                height={cellSize.height}
                tag={cellIds[i]}
                sliceIndex={sliceIndex}
                axis={sliceAxis}
                onCrosshairClick={handleCrosshairClick}
            />
        </MosaicCellErrorBoundary>
    </div>
))}
```

---

## Phase 2: Performance Improvements (High Priority)

### 2.1 Implement Resource Throttling

**Impact**: Prevents backend resource exhaustion, enables larger grids
**Files**: `/ui2/src/services/MosaicRenderService.ts`

**Implementation**:
```typescript
// Add at class level
private static readonly MAX_CONCURRENT_RENDERS = 4;
private renderingSemaphore: number = 0;

// Replace renderMosaicGrid with batched processing
async renderMosaicGrid(requests: MosaicRenderRequest[]): Promise<void> {
    console.log(`[MosaicRenderService] Starting batched rendering: ${requests.length} requests, max concurrent: ${MosaicRenderService.MAX_CONCURRENT_RENDERS}`);
    
    const batches = this.createBatches(requests, MosaicRenderService.MAX_CONCURRENT_RENDERS);
    const results = { successful: 0, failed: 0, errors: [] };
    
    for (const batch of batches) {
        console.log(`[MosaicRenderService] Processing batch of ${batch.length} renders`);
        
        // Process batch with controlled concurrency
        const batchPromises = batch.map(async (request) => {
            try {
                await this.renderMosaicCell(request);
                results.successful++;
                return { success: true, cellId: request.cellId };
            } catch (error) {
                results.failed++;
                results.errors.push({ cellId: request.cellId, error });
                return { success: false, cellId: request.cellId, error };
            }
        });
        
        await Promise.all(batchPromises);
        console.log(`[MosaicRenderService] Batch complete. Running total: ${results.successful} successful, ${results.failed} failed`);
    }
    
    console.log(`[MosaicRenderService] All batches complete: ${results.successful}/${requests.length} successful`);
}

private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }
    return batches;
}
```

### 2.2 Add Resource Monitoring and Cleanup Thresholds

**Impact**: Proactive resource management, prevents exhaustion
**Files**: 
- `/ui2/src/utils/ResourceMonitor.ts` (new file)
- `/ui2/src/services/MosaicRenderService.ts`

**Implementation**:
1. **Create ResourceMonitor.ts**:
```typescript
export class ResourceMonitor {
    private static instance: ResourceMonitor | null = null;
    private allocatedBitmaps = 0;
    private readonly MAX_BITMAPS = 8; // Conservative browser limit
    private readonly CLEANUP_THRESHOLD = 6; // Trigger cleanup before hitting limit
    
    static getInstance(): ResourceMonitor {
        if (!ResourceMonitor.instance) {
            ResourceMonitor.instance = new ResourceMonitor();
        }
        return ResourceMonitor.instance;
    }
    
    allocate(): boolean {
        if (this.allocatedBitmaps >= this.MAX_BITMAPS) {
            console.warn(`[ResourceMonitor] Max bitmaps (${this.MAX_BITMAPS}) reached, rejecting allocation`);
            return false;
        }
        
        this.allocatedBitmaps++;
        console.debug(`[ResourceMonitor] Bitmap allocated (${this.allocatedBitmaps}/${this.MAX_BITMAPS})`);
        
        if (this.allocatedBitmaps >= this.CLEANUP_THRESHOLD) {
            this.requestCleanup();
        }
        
        return true;
    }
    
    deallocate(): void {
        if (this.allocatedBitmaps > 0) {
            this.allocatedBitmaps--;
            console.debug(`[ResourceMonitor] Bitmap deallocated (${this.allocatedBitmaps}/${this.MAX_BITMAPS})`);
        }
    }
    
    private requestCleanup(): void {
        console.log('[ResourceMonitor] Requesting garbage collection');
        if (typeof window !== 'undefined' && 'gc' in window) {
            (window as any).gc();
        }
    }
    
    getStatus() {
        return {
            allocated: this.allocatedBitmaps,
            max: this.MAX_BITMAPS,
            available: this.MAX_BITMAPS - this.allocatedBitmaps,
            utilizationPercent: (this.allocatedBitmaps / this.MAX_BITMAPS) * 100
        };
    }
}
```

2. **Integrate with ImageBitmap handling**:
```typescript
// In useRenderCanvas.ts and MosaicCell.tsx, add resource monitoring
import { ResourceMonitor } from '@/utils/ResourceMonitor';

const resourceMonitor = ResourceMonitor.getInstance();

// Before creating/storing new ImageBitmap
if (!resourceMonitor.allocate()) {
    setError('GPU resources exhausted');
    return;
}

// Store the image
if (lastImageRef.current) {
    lastImageRef.current.close();
    resourceMonitor.deallocate();
}
lastImageRef.current = data.imageBitmap;
```

---

## Phase 3: Architecture Improvements (Medium Priority)

### 3.1 Improve Event System Reliability

**Impact**: Reduces race conditions, improves event delivery
**Files**: `/ui2/src/hooks/useRenderCanvas.ts`

**Changes**:
- Add event deduplication
- Implement retry mechanism for lost events
- Add event sequence tracking

### 3.2 Add Graceful Degradation

**Impact**: Better user experience during resource constraints
**Files**: `/ui2/src/components/views/MosaicViewPromise.tsx`

**Implementation**:
- Detect resource exhaustion patterns
- Automatically reduce grid size (4x4 → 3x3 → 2x2)
- Show user notification of degradation

### 3.3 Enhanced Error Reporting and Recovery

**Impact**: Better debugging and user feedback
**Files**: Multiple components

**Features**:
- Detailed error categorization (GPU, Network, Backend)
- Retry buttons for individual failed cells
- Resource status display for developers

---

## Phase 4: Testing Strategy

### 4.1 Unit Tests
- **MosaicRenderService**: Sequential rendering logic
- **ResourceMonitor**: Allocation/deallocation tracking
- **ImageBitmap cleanup**: Proper disposal verification

### 4.2 Integration Tests
- **12-cell mosaic rendering**: All cells should render successfully
- **Resource exhaustion recovery**: Handling of GPU limits
- **Error boundary isolation**: Individual cell failures

### 4.3 Performance Tests
- **Memory usage monitoring**: ImageBitmap lifecycle
- **Render timing**: Sequential vs parallel performance
- **Browser compatibility**: Different GPU context limits

---

## Implementation Order and Dependencies

### Phase 1 (Critical - Fix Now)
1. **Sequential Rendering** (1.1) - No dependencies
2. **ImageBitmap Cleanup** (1.2) - No dependencies  
3. **Error Boundaries** (1.3) - Depends on 1.1

### Phase 2 (High Priority - Next Sprint)
1. **Resource Throttling** (2.1) - Depends on Phase 1 completion
2. **Resource Monitoring** (2.2) - Can be parallel with 2.1

### Phase 3 (Medium Priority - Future Sprint)
1. **Event System** (3.1) - Can be parallel with Phase 2
2. **Graceful Degradation** (3.2) - Depends on 2.2
3. **Enhanced Errors** (3.3) - Can be parallel

### Phase 4 (Testing - Throughout)
- Continuous testing during each phase
- Full integration testing after Phase 2

---

## Backward Compatibility

### Protected Components
- **SliceView**: No changes required - already has proper ImageBitmap cleanup
- **FlexibleOrthogonalView**: No changes required - uses sequential rendering
- **Existing render events**: All event structures remain unchanged

### API Compatibility
- All existing Tauri commands unchanged
- ViewState structure unchanged
- Event bus interface unchanged

---

## Success Criteria

### Phase 1 Success
- ✅ 12-cell mosaic renders all slices (may be slow)
- ✅ No cascade failures on individual cell errors
- ✅ No ImageBitmap memory leaks
- ✅ Individual cells can fail without killing grid

### Phase 2 Success  
- ✅ 16-cell (4x4) mosaic renders reliably
- ✅ Resource usage stays within browser limits
- ✅ Render performance acceptable (< 5s for full grid)

### Phase 3 Success
- ✅ Handles any grid size gracefully
- ✅ Clear error messages and recovery options
- ✅ Automatic degradation under resource pressure

---

## Risk Assessment

### High Risk
- **Backend mutex contention**: May require Rust changes if throttling insufficient
- **Browser GPU limits**: May vary significantly between browsers/hardware

### Medium Risk  
- **Event system changes**: Could affect other components using event bus
- **Resource monitoring accuracy**: Browser APIs may not provide perfect visibility

### Low Risk
- **ImageBitmap cleanup**: Well-established pattern from SliceView
- **Sequential rendering**: Simple, proven approach

---

## Files to be Modified

### Core Fixes (Phase 1)
1. `/ui2/src/services/MosaicRenderService.ts` - Sequential rendering, error handling
2. `/ui2/src/components/views/MosaicCell.tsx` - ImageBitmap cleanup
3. `/ui2/src/hooks/useRenderCanvas.ts` - ImageBitmap lifecycle  
4. `/ui2/src/components/views/MosaicCellErrorBoundary.tsx` - **NEW FILE**
5. `/ui2/src/components/views/MosaicViewPromise.tsx` - Error boundary integration

### Performance Improvements (Phase 2)
6. `/ui2/src/utils/ResourceMonitor.ts` - **NEW FILE**
7. `/ui2/src/services/MosaicRenderService.ts` - Resource throttling (additional changes)

### Architecture Enhancements (Phase 3)
8. `/ui2/src/hooks/useRenderCanvas.ts` - Event system improvements
9. `/ui2/src/components/views/MosaicViewPromise.tsx` - Graceful degradation
10. Various components - Enhanced error reporting

---

## Conclusion

This plan prioritizes fixing the root causes of the MosaicView rendering failure through a phased approach. Phase 1 addresses the critical cascade failures and resource leaks that prevent any reliable rendering. Phase 2 adds performance optimizations to handle larger grids. Phase 3 adds architectural improvements for a production-quality experience.

The sequential rendering approach in Phase 1 will immediately solve the "3 successful + 13 failed" pattern by eliminating Promise.all cascade failures, while proper ImageBitmap cleanup will prevent GPU resource exhaustion that causes the failures in the first place.

Expected outcome: After Phase 1, users will see 12/12 slices render successfully (though sequentially). After Phase 2, rendering will be both reliable and performant for any grid size within browser limits.
# MosaicView Rendering Failure - Comprehensive Fix Plan

## Executive Summary

**Problem**: MosaicView displays only the first 2 slices correctly, then shows "Failed to Draw Image" errors and all panels go black due to a cascading resource exhaustion failure.

**Root Cause**: Resource exhaustion cascade failure caused by:
1. Missing ImageBitmap lifecycle management (memory leaks)
2. Promise.all cascade failure pattern (one failure kills entire grid)
3. Concurrent resource exhaustion (16 simultaneous renders exceed browser limits)
4. No error boundaries (failures propagate to entire grid)

**Solution Strategy**: Implement proper resource management, replace cascade-prone Promise.all with resilient patterns, add error boundaries, and implement resource throttling.

## Root Cause Analysis

### Primary Issues
1. **ImageBitmap Memory Leaks** - MosaicCell doesn't dispose ImageBitmaps with `.close()`
2. **Promise.all Cascade Failure** - Single render failure cancels entire 16-cell grid
3. **Resource Exhaustion** - 16 concurrent WebGPU contexts exceed browser limits (4-8)
4. **Missing Error Isolation** - No boundaries to contain individual cell failures

### Evidence
- **Success Pattern**: First 2 slices render (resources available)
- **Failure Pattern**: Slice 3+ fails (GPU memory/context limits reached)
- **Cascade Pattern**: Promise.all immediately cancels remaining 13 renders
- **Result**: Grid goes black with no recovery mechanism

## Implementation Plan

### Phase 1: Critical Fixes (Immediate - Day 1)

#### 1.1 Fix ImageBitmap Memory Leaks
**Priority**: Critical
**Files**: `/ui2/src/components/views/MosaicCell.tsx`
**Risk**: Low (following established pattern from SliceView)

**Current Code** (Line 322):
```typescript
const handleImageReceived = useCallback((imageBitmap: ImageBitmap) => {
  lastImageRef.current = imageBitmap;  // ❌ NO CLEANUP
}, []);
```

**Fixed Code**:
```typescript
const handleImageReceived = useCallback((imageBitmap: ImageBitmap) => {
  // Dispose of previous bitmap to prevent GPU memory leaks
  if (lastImageRef.current) {
    lastImageRef.current.close();
    console.debug(`[MosaicCell ${cellId}] Disposed previous ImageBitmap`);
  }
  lastImageRef.current = imageBitmap;
}, [cellId]);
```

**Additional Changes**:
- Add cleanup in useEffect unmount:
```typescript
useEffect(() => {
  return () => {
    // Cleanup on unmount
    if (lastImageRef.current) {
      lastImageRef.current.close();
      lastImageRef.current = null;
    }
  };
}, []);
```

#### 1.2 Replace Promise.all with Promise.allSettled
**Priority**: Critical  
**Files**: `/ui2/src/services/MosaicRenderService.ts`
**Risk**: Low (backward compatible change)

**Current Code** (Lines 91-98):
```typescript
async renderMosaicGrid(requests: MosaicRenderRequest[]): Promise<void> {
  // Render cells in parallel for better performance
  const renderPromises = requests.map(request => 
    this.renderMosaicCell(request)
  );
  
  await Promise.all(renderPromises);  // ❌ CRITICAL FLAW
}
```

**Fixed Code**:
```typescript
async renderMosaicGrid(requests: MosaicRenderRequest[]): Promise<void> {
  // Render cells in parallel with error isolation
  const renderPromises = requests.map(request => 
    this.renderMosaicCell(request)
  );
  
  const results = await Promise.allSettled(renderPromises);
  
  // Log failures but don't block successful renders
  const failures = results.filter(r => r.status === 'rejected').length;
  if (failures > 0) {
    console.warn(`[MosaicRenderService] ${failures}/${requests.length} cell renders failed, but successful cells displayed`);
  }
}
```

#### 1.3 Add Basic Error Recovery in MosaicCell
**Priority**: High
**Files**: `/ui2/src/components/views/MosaicCell.tsx`
**Risk**: Low (defensive programming)

**Add Error State Management**:
```typescript
const [renderError, setRenderError] = useState<string | null>(null);
const [retryCount, setRetryCount] = useState(0);
const MAX_RETRIES = 2;

const handleRenderError = useCallback((error: any) => {
  console.error(`[MosaicCell ${cellId}] Render error:`, error);
  setRenderError('Render failed');
  
  // Implement simple retry logic
  if (retryCount < MAX_RETRIES) {
    setTimeout(() => {
      console.log(`[MosaicCell ${cellId}] Retrying render (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      setRetryCount(prev => prev + 1);
      setRenderError(null);
      // Trigger re-render by updating render key
      setRenderKey(prev => prev + 1);
    }, 1000 * (retryCount + 1)); // Exponential backoff
  }
}, [cellId, retryCount]);
```

**Add Error Display**:
```typescript
if (renderError && retryCount >= MAX_RETRIES) {
  return (
    <div className="mosaic-cell-error">
      <div className="error-icon">⚠️</div>
      <div className="error-text">{renderError}</div>
      <button 
        onClick={() => {
          setRetryCount(0);
          setRenderError(null);
          setRenderKey(prev => prev + 1);
        }}
        className="retry-button"
      >
        Retry
      </button>
    </div>
  );
}
```

### Phase 2: Resource Management (Day 2-3)

#### 2.1 Implement Resource Throttling
**Priority**: High
**Files**: `/ui2/src/services/MosaicRenderService.ts`
**Risk**: Medium (changes concurrency behavior)

**Add Throttling Class**:
```typescript
class RenderThrottle {
  private activeRenders = 0;
  private readonly maxConcurrent: number;
  
  constructor(maxConcurrent = Math.min(navigator.hardwareConcurrency || 4, 4)) {
    this.maxConcurrent = maxConcurrent;
  }
  
  async acquire(): Promise<void> {
    while (this.activeRenders >= this.maxConcurrent) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.activeRenders++;
  }
  
  release(): void {
    this.activeRenders--;
  }
  
  get stats() {
    return {
      active: this.activeRenders,
      max: this.maxConcurrent,
      utilization: this.activeRenders / this.maxConcurrent
    };
  }
}
```

**Update MosaicRenderService**:
```typescript
export class MosaicRenderService {
  private renderThrottle = new RenderThrottle();
  
  async renderMosaicCell(request: MosaicRenderRequest): Promise<void> {
    await this.renderThrottle.acquire();
    
    try {
      console.debug(`[MosaicRenderService] Starting render for cell ${request.cellId} (${this.renderThrottle.stats.active}/${this.renderThrottle.stats.max} active)`);
      
      // Existing render logic
      const imageBitmap = await this.apiService.applyAndRenderViewStateCore(
        request.viewState,
        request.sliceIndex
      );
      
      this.eventBus.emit('render.complete', {
        cellId: request.cellId,
        imageBitmap,
        tag: request.tag
      });
      
    } catch (error) {
      console.error(`[MosaicRenderService] Render failed for cell ${request.cellId}:`, error);
      
      this.eventBus.emit('render.error', {
        cellId: request.cellId,
        error,
        tag: request.tag
      });
      
      throw error; // Re-throw for Promise.allSettled
    } finally {
      this.renderThrottle.release();
    }
  }
}
```

#### 2.2 Add Resource Monitoring
**Priority**: Medium
**Files**: `/ui2/src/components/views/MosaicCell.tsx`
**Risk**: Low (monitoring only)

**Add Memory Monitoring**:
```typescript
const memoryMonitor = useRef({
  allocatedBitmaps: 0,
  totalMemoryMB: 0,
  peakMemoryMB: 0
});

const handleImageReceived = useCallback((imageBitmap: ImageBitmap) => {
  // Dispose previous bitmap
  if (lastImageRef.current) {
    const prevSize = lastImageRef.current.width * lastImageRef.current.height * 4;
    lastImageRef.current.close();
    memoryMonitor.current.allocatedBitmaps--;
    memoryMonitor.current.totalMemoryMB -= prevSize / (1024 * 1024);
  }
  
  // Track new bitmap
  lastImageRef.current = imageBitmap;
  const newSize = imageBitmap.width * imageBitmap.height * 4;
  memoryMonitor.current.allocatedBitmaps++;
  memoryMonitor.current.totalMemoryMB += newSize / (1024 * 1024);
  memoryMonitor.current.peakMemoryMB = Math.max(
    memoryMonitor.current.peakMemoryMB,
    memoryMonitor.current.totalMemoryMB
  );
  
  // Warning thresholds
  if (memoryMonitor.current.allocatedBitmaps > 10) {
    console.warn(`[MosaicCell ${cellId}] High ImageBitmap count: ${memoryMonitor.current.allocatedBitmaps}`);
  }
  if (memoryMonitor.current.totalMemoryMB > 50) {
    console.warn(`[MosaicCell ${cellId}] High GPU memory usage: ${memoryMonitor.current.totalMemoryMB.toFixed(1)}MB`);
  }
}, [cellId]);
```

#### 2.3 Implement Sequential Rendering Option
**Priority**: Medium
**Files**: `/ui2/src/services/MosaicRenderService.ts`
**Risk**: Medium (performance trade-off)

**Add Rendering Strategy**:
```typescript
type RenderStrategy = 'parallel' | 'sequential' | 'batched';

export class MosaicRenderService {
  private renderStrategy: RenderStrategy = 'batched'; // Default to safest option
  
  async renderMosaicGrid(requests: MosaicRenderRequest[]): Promise<void> {
    switch (this.renderStrategy) {
      case 'sequential':
        return this.renderSequential(requests);
      case 'batched':
        return this.renderBatched(requests);
      case 'parallel':
      default:
        return this.renderParallel(requests);
    }
  }
  
  private async renderSequential(requests: MosaicRenderRequest[]): Promise<void> {
    console.debug(`[MosaicRenderService] Sequential rendering ${requests.length} cells`);
    
    for (const request of requests) {
      try {
        await this.renderMosaicCell(request);
      } catch (error) {
        console.warn(`[MosaicRenderService] Cell ${request.cellId} failed, continuing:`, error);
      }
    }
  }
  
  private async renderBatched(requests: MosaicRenderRequest[], batchSize = 4): Promise<void> {
    console.debug(`[MosaicRenderService] Batched rendering ${requests.length} cells (batch size: ${batchSize})`);
    
    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map(request => this.renderMosaicCell(request))
      );
      
      const failures = results.filter(r => r.status === 'rejected').length;
      if (failures > 0) {
        console.warn(`[MosaicRenderService] Batch ${Math.floor(i/batchSize) + 1}: ${failures}/${batch.length} failed`);
      }
    }
  }
  
  private async renderParallel(requests: MosaicRenderRequest[]): Promise<void> {
    console.debug(`[MosaicRenderService] Parallel rendering ${requests.length} cells`);
    
    const results = await Promise.allSettled(
      requests.map(request => this.renderMosaicCell(request))
    );
    
    const failures = results.filter(r => r.status === 'rejected').length;
    if (failures > 0) {
      console.warn(`[MosaicRenderService] ${failures}/${requests.length} cell renders failed`);
    }
  }
}
```

### Phase 3: Error Boundaries and UI Improvements (Day 4-5)

#### 3.1 Add React Error Boundaries
**Priority**: High
**Files**: `/ui2/src/components/views/MosaicViewPromise.tsx`, `/ui2/src/components/error/MosaicErrorBoundary.tsx` (new)
**Risk**: Low (defensive programming)

**Create MosaicErrorBoundary Component**:
```typescript
// /ui2/src/components/error/MosaicErrorBoundary.tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  cellId?: string;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class MosaicErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[MosaicErrorBoundary] Cell ${this.props.cellId || 'unknown'} error:`, error);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      return (
        <div className="mosaic-cell-error-boundary">
          <div className="error-icon">💥</div>
          <div className="error-title">Render Error</div>
          <div className="error-detail">Cell {this.props.cellId} failed to render</div>
          <button 
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="retry-button"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

**Update MosaicViewPromise to use Error Boundaries**:
```typescript
// Wrap each MosaicCell with error boundary
{sliceIndices.map((sliceIndex, index) => {
  const cellId = `cell-${index}`;
  return (
    <MosaicErrorBoundary 
      key={cellId} 
      cellId={cellId}
      onError={(error) => {
        console.error(`[MosaicView] Cell ${cellId} boundary caught:`, error);
        // Could implement error reporting here
      }}
    >
      <MosaicCell
        key={`${cellId}-${sliceIndex}-${renderKey}`}
        cellId={cellId}
        sliceIndex={sliceIndex}
        cellSize={cellSize}
        onImageReceived={(imageBitmap) => handleImageReceived(index, imageBitmap)}
        tag={`mosaic-${viewId}-${index}`}
      />
    </MosaicErrorBoundary>
  );
})}
```

#### 3.2 Add Resource Exhaustion Detection
**Priority**: Medium
**Files**: `/ui2/src/services/MosaicRenderService.ts`
**Risk**: Low (monitoring and adaptation)

**Add Resource Detection**:
```typescript
class ResourceMonitor {
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  
  recordSuccess(): void {
    this.successCount++;
    if (this.successCount > 10) {
      // Reset failure count after sustained success
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }
  
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
  }
  
  shouldThrottle(): boolean {
    // Throttle if we've had recent failures
    const recentFailure = Date.now() - this.lastFailureTime < 5000; // 5 seconds
    const highFailureRate = this.failureCount > 3;
    
    return recentFailure && highFailureRate;
  }
  
  getRecommendedStrategy(): RenderStrategy {
    if (this.failureCount === 0) return 'parallel';
    if (this.failureCount <= 2) return 'batched';
    return 'sequential';
  }
  
  get stats() {
    return {
      failures: this.failureCount,
      successes: this.successCount,
      failureRate: this.failureCount / (this.failureCount + this.successCount),
      lastFailure: this.lastFailureTime
    };
  }
}
```

**Update MosaicRenderService with Adaptive Strategy**:
```typescript
export class MosaicRenderService {
  private resourceMonitor = new ResourceMonitor();
  
  async renderMosaicGrid(requests: MosaicRenderRequest[]): Promise<void> {
    // Adapt strategy based on recent performance
    const strategy = this.resourceMonitor.getRecommendedStrategy();
    if (strategy !== this.renderStrategy) {
      console.log(`[MosaicRenderService] Adapting strategy: ${this.renderStrategy} → ${strategy}`);
      this.renderStrategy = strategy;
    }
    
    // Add pre-render resource check
    if (this.resourceMonitor.shouldThrottle()) {
      console.warn('[MosaicRenderService] Resource exhaustion detected, throttling renders');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    const startTime = Date.now();
    
    try {
      await this.renderMosaicGridInternal(requests);
      this.resourceMonitor.recordSuccess();
      
      console.debug(`[MosaicRenderService] Grid render completed in ${Date.now() - startTime}ms using ${strategy} strategy`);
      
    } catch (error) {
      this.resourceMonitor.recordFailure();
      console.error(`[MosaicRenderService] Grid render failed after ${Date.now() - startTime}ms:`, error);
      throw error;
    }
  }
}
```

### Phase 4: Performance Optimization (Week 2)

#### 4.1 Add Canvas Context Reuse
**Priority**: Low
**Files**: `/ui2/src/components/views/MosaicCell.tsx`
**Risk**: Medium (canvas management changes)

**Implement Context Pooling**:
```typescript
// Canvas context reuse to reduce overhead
const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null);

const getCanvasContext = useCallback((): CanvasRenderingContext2D | null => {
  if (!canvasRef.current) return null;
  
  if (!canvasContextRef.current) {
    canvasContextRef.current = canvasRef.current.getContext('2d', {
      alpha: false, // Performance optimization
      desynchronized: true // Allow async canvas updates
    });
  }
  
  return canvasContextRef.current;
}, []);

const redrawCanvas = useCallback(() => {
  if (!lastImageRef.current) return;
  
  const ctx = getCanvasContext();
  if (!ctx) return;
  
  try {
    // Clear and redraw
    ctx.clearRect(0, 0, cellSize.width, cellSize.height);
    ctx.drawImage(lastImageRef.current, 0, 0);
  } catch (error) {
    console.error(`[MosaicCell ${cellId}] Canvas redraw failed:`, error);
    setError('Canvas draw failed');
  }
}, [cellId, cellSize, getCanvasContext]);
```

#### 4.2 Add Virtualization Support
**Priority**: Low
**Files**: `/ui2/src/components/views/MosaicViewPromise.tsx`
**Risk**: High (major architectural change)

**Note**: This is a future enhancement that would implement virtual scrolling for large grids to reduce memory pressure.

## Testing Strategy

### Phase 1 Testing
1. **Unit Tests**: Test ImageBitmap cleanup in isolation
2. **Integration Tests**: Verify Promise.allSettled handles failures correctly
3. **Manual Testing**: Load 4x4 mosaic grid and verify all cells render
4. **Memory Testing**: Monitor GPU memory usage with browser dev tools

### Phase 2 Testing  
1. **Resource Tests**: Test with artificially limited WebGPU contexts
2. **Concurrent Tests**: Verify throttling works under load
3. **Performance Tests**: Compare sequential vs batched vs parallel strategies
4. **Monitoring Tests**: Verify resource monitoring detects exhaustion

### Phase 3 Testing
1. **Error Boundary Tests**: Simulate errors and verify isolation
2. **Recovery Tests**: Test retry mechanisms and error recovery
3. **UI Tests**: Verify error states display correctly
4. **Stress Tests**: Test with 8x8 grids to verify scalability

### Testing Commands
```bash
# Run all tests
pnpm --filter ui2 test:unit

# Run specific mosaic tests
pnpm --filter ui2 test:unit -- --grep "MosaicView"

# Run E2E tests for mosaic functionality
cd e2e && ./run-e2e.sh --grep "mosaic"

# Memory leak testing
cargo tauri dev
# Open browser dev tools → Performance → Memory tab
# Load mosaic view repeatedly and check for memory growth
```

## Risk Assessment

### Low Risk Changes
- ImageBitmap.close() calls (following established pattern)
- Promise.allSettled replacement (backward compatible)
- Error boundaries (defensive programming)
- Resource monitoring (logging only)

### Medium Risk Changes  
- Resource throttling (changes concurrency behavior)
- Sequential rendering (performance implications)
- Canvas context reuse (rendering behavior changes)

### High Risk Changes
- Event system modifications (timing-sensitive)
- Major architectural changes (virtualization)

### Rollback Strategy
1. **Git branches**: Each phase in separate feature branch
2. **Feature flags**: Add runtime toggle for new vs old behavior
3. **Monitoring**: Add metrics to detect regressions
4. **Staged rollout**: Test with subset of users first

```typescript
// Feature flag example
const USE_NEW_MOSAIC_RENDERING = process.env.NODE_ENV === 'development' || 
  localStorage.getItem('enableNewMosaicRendering') === 'true';

if (USE_NEW_MOSAIC_RENDERING) {
  // New rendering pipeline
} else {
  // Legacy rendering pipeline
}
```

## Code Changes Summary

### Files Modified
1. `/ui2/src/components/views/MosaicCell.tsx` - Add ImageBitmap cleanup, error handling
2. `/ui2/src/services/MosaicRenderService.ts` - Replace Promise.all, add throttling
3. `/ui2/src/components/views/MosaicViewPromise.tsx` - Add error boundaries
4. `/ui2/src/components/error/MosaicErrorBoundary.tsx` - New error boundary component
5. `/ui2/src/hooks/useRenderCanvas.ts` - Enhanced error handling (minor)

### Files Added
- `/ui2/src/components/error/MosaicErrorBoundary.tsx`
- `/ui2/src/utils/ResourceMonitor.ts` (optional utility)
- `/ui2/src/utils/RenderThrottle.ts` (optional utility)

### Configuration Changes
- Add feature flags for gradual rollout
- Add monitoring/logging configuration
- Update test configurations for new components

## Implementation Timeline

### Week 1
- **Day 1**: Phase 1 critical fixes (ImageBitmap cleanup, Promise.allSettled)
- **Day 2**: Phase 2 resource management (throttling, monitoring)  
- **Day 3**: Testing and validation of Phases 1-2
- **Day 4**: Phase 3 error boundaries and UI improvements
- **Day 5**: Comprehensive testing and documentation

### Week 2  
- **Days 1-3**: Phase 4 performance optimizations (optional)
- **Days 4-5**: Final testing, deployment preparation, rollback planning

## Success Criteria

### Functional Requirements
✅ All 16 mosaic cells render successfully  
✅ No "Failed to Draw Image" errors under normal conditions  
✅ Individual cell failures don't affect other cells  
✅ Grid remains functional after individual failures  
✅ Memory usage remains stable over multiple render cycles  

### Performance Requirements
✅ Initial render completes within 5 seconds  
✅ GPU memory usage < 100MB for 4x4 grid  
✅ No memory leaks after repeated rendering  
✅ Graceful degradation under resource pressure  

### Reliability Requirements  
✅ Error recovery mechanisms function correctly  
✅ Resource monitoring detects exhaustion conditions  
✅ Retry mechanisms restore functionality after temporary failures  
✅ System remains stable under stress testing  

## Monitoring and Metrics

### Key Metrics to Track
1. **Render Success Rate**: % of mosaic cells that render successfully
2. **Memory Usage**: GPU memory allocated for ImageBitmaps
3. **Resource Exhaustion Events**: Frequency of resource limit hits
4. **Error Recovery**: Success rate of retry mechanisms
5. **Performance**: Time to render full mosaic grid

### Monitoring Implementation
```typescript
// Add to MosaicRenderService
private metrics = {
  renderAttempts: 0,
  renderSuccesses: 0,
  renderFailures: 0,
  resourceExhaustionEvents: 0,
  averageRenderTime: 0,
  peakMemoryUsage: 0
};

private recordMetric(type: string, value?: number) {
  switch (type) {
    case 'render-attempt':
      this.metrics.renderAttempts++;
      break;
    case 'render-success':
      this.metrics.renderSuccesses++;
      break;
    case 'render-failure':
      this.metrics.renderFailures++;
      break;
    case 'resource-exhaustion':
      this.metrics.resourceExhaustionEvents++;
      break;
  }
  
  // Log metrics periodically
  if (this.metrics.renderAttempts % 50 === 0) {
    console.log('[MosaicRenderService] Metrics:', this.metrics);
  }
}
```

## Conclusion

This comprehensive plan addresses the root causes of the MosaicView rendering failure through a phased approach that prioritizes critical fixes while building toward a more robust and scalable solution. The implementation follows established patterns from the working SliceView component and includes comprehensive testing and monitoring to ensure reliability.

The key insight is that the failure is a resource management problem in the frontend, not a backend rendering issue. By implementing proper ImageBitmap lifecycle management, replacing cascade-prone Promise.all patterns, and adding appropriate error boundaries and throttling, we can transform the MosaicView from a fragile component into a robust, production-ready feature.

**Expected Outcome**: After implementation, users will see all 16 mosaic cells render reliably, with graceful handling of any individual failures, stable memory usage, and no more black panels or cascade failures.

---

**Plan Created**: 2025-08-06  
**Estimated Implementation**: 5-10 days  
**Priority**: Critical (blocking core functionality)  
**Confidence Level**: High (based on clear evidence and established patterns)
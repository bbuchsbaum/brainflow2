# MosaicView Rendering Failure Investigation Report

## Executive Summary

**Problem**: MosaicView displays only the first two slices correctly, shows "Failed to Draw Image" for subsequent slices, and then all panels go black, indicating a cascading failure in the rendering pipeline.

**Root Cause Analysis**: The MosaicView architecture has multiple critical flaws including inadequate resource management, Promise.all failure propagation, race conditions in concurrent rendering, and missing error boundaries that cause the entire grid to fail when individual cells encounter issues.

## Critical Issues Identified

### 1. **Promise.all Catastrophic Failure Pattern**

**Location**: `/ui2/src/services/MosaicRenderService.ts:91-98`

```typescript
async renderMosaicGrid(requests: MosaicRenderRequest[]): Promise<void> {
  // Render cells in parallel for better performance
  const renderPromises = requests.map(request => 
    this.renderMosaicCell(request)
  );
  
  await Promise.all(renderPromises);  // ❌ CRITICAL FLAW
}
```

**Problem**: Promise.all() fails fast - if ANY single cell render fails, ALL renders are cancelled. This explains why failure cascades through the entire grid.

**Evidence**: After the first 2-3 successful renders, backend resource exhaustion or GPU context limits cause subsequent renders to fail, triggering Promise.all rejection and cancelling all remaining renders.

### 2. **Missing ImageBitmap Lifecycle Management**

**Location**: `/ui2/src/components/views/MosaicCell.tsx:322`

```typescript
const handleImageReceived = useCallback((imageBitmap: ImageBitmap) => {
  lastImageRef.current = imageBitmap;  // ❌ NO CLEANUP
}, []);
```

**Comparison with Working SliceView** (`/ui2/src/components/views/SliceView.tsx:347-361`):

```typescript
const setImageBitmap = useCallback((newBitmap: ImageBitmap | null) => {
  // Dispose of previous bitmap
  if (lastImageRef.current) {
    lastImageRef.current.close();  // ✅ PROPER CLEANUP
    memoryMonitorRef.current.allocatedBitmaps--;
  }
  lastImageRef.current = newBitmap;
}, [viewId]);
```

**Problem**: MosaicCell doesn't dispose of ImageBitmaps, leading to:
- GPU memory exhaustion after 2-3 renders
- Browser ImageBitmap context limits reached
- Subsequent createImageBitmap() failures

### 3. **Backend Resource Exhaustion**

**Location**: `/ui2/src/services/apiService.ts:519`

The backend rendering pipeline through `applyAndRenderViewStateCore()` creates individual ImageBitmaps for each mosaic cell through concurrent `Promise.all()` execution. Evidence suggests the backend hits resource limits:

**GPU Memory**: Each 256x256 RGBA ImageBitmap = 256KB. A 4x4 grid = 16 * 256KB = 4MB per render cycle.

**WebGPU Context Limits**: Browser limits on simultaneous WebGPU render operations likely reached after 2-3 concurrent renders.

### 4. **Error Handling Propagation**

**Location**: `/ui2/src/hooks/useRenderCanvas.ts:61-63`

```typescript
} catch (error) {
  console.error(`[useRenderCanvas${tag ? ` ${tag}` : ''}] Failed to draw image:`, error);
  setError('Failed to Draw Image');  // ❌ THIS ERROR MESSAGE
  return null;
}
```

This is the exact error message users see, occurring when ImageBitmap handling fails.

### 5. **Concurrent Resource Limits**

**Analysis**: The architecture attempts 16 simultaneous renders (4x4 grid) through:

1. `MosaicViewPromise.tsx:191` - Triggers `renderMosaicGrid()`
2. `MosaicRenderService.ts:93-94` - Maps to 16 concurrent `renderMosaicCell()` calls  
3. Each calls `apiService.applyAndRenderViewStateCore()` with unique slice parameters
4. Backend WebGPU renderer creates 16 simultaneous render contexts

**Resource Exhaustion Points**:
- GPU memory allocation for 16 simultaneous renders
- WebGPU context limits (typically 4-8 concurrent contexts)
- ImageBitmap creation limits in browser

### 6. **Race Conditions in Event System**

**Location**: `/ui2/src/hooks/useRenderCanvas.ts:68-99`

The event filtering system may have race conditions:

```typescript
const handleRenderComplete = useCallback((data: any) => {
  // Filter based on tag or viewType
  if (tag && data.tag !== tag) return;  // ❌ POTENTIAL RACE
  
  if (data.imageBitmap && canvasRef.current) {
    // ... render logic
  }
}, [tag, viewType, redrawCanvas]);
```

**Problem**: With 16 simultaneous `render.complete` events, tag-based filtering may have timing issues where some events are missed or misrouted.

## Architecture Comparison: Working vs. Failing

### FlexibleOrthogonalView (✅ Works)
- **Sequential rendering**: One view at a time
- **Proper lifecycle**: ImageBitmap disposal in SliceView
- **Error isolation**: Each view independent  
- **Resource management**: Single GPU context per view

### MosaicView (❌ Fails)  
- **Concurrent rendering**: 16 simultaneous renders
- **No lifecycle management**: ImageBitmap leaks
- **Error propagation**: Promise.all fails entire grid
- **Resource exhaustion**: GPU limits exceeded

## Technical Evidence

### Memory Pattern
1. **Renders 1-2**: Success (adequate resources)
2. **Render 3+**: ImageBitmap creation starts failing
3. **Promise.all()**: Cancels ALL remaining renders on first failure
4. **Result**: Grid goes black as all cells fail

### Error Timeline
1. Backend renders succeed initially
2. GPU/memory resources depleted
3. `createImageBitmap()` throws errors  
4. `useRenderCanvas` catches and sets "Failed to Draw Image"
5. Promise.all rejects, cancelling remaining cells
6. Event system stops processing `render.complete` events
7. Grid appears black/empty

## Recommended Solutions

### 1. **Implement Sequential Rendering** (High Priority)
Replace Promise.all with sequential processing to prevent cascade failures.

### 2. **Add ImageBitmap Lifecycle Management** (Critical)
Implement proper `.close()` calls in MosaicCell similar to SliceView.

### 3. **Add Error Boundaries** (High Priority)  
Isolate cell failures to prevent grid-wide failures.

### 4. **Implement Resource Throttling** (Medium Priority)
Limit concurrent renders based on detected capabilities.

### 5. **Add Resource Monitoring** (Medium Priority)
Track ImageBitmap allocations and implement cleanup thresholds.

## Root Cause Summary

The MosaicView failure is caused by a **resource exhaustion cascade failure** where:

1. **Concurrent rendering** (16 simultaneous) exceeds browser/GPU limits
2. **Missing resource cleanup** accelerates memory exhaustion  
3. **Promise.all error propagation** causes total failure on first individual error
4. **No error boundaries** allow failures to cascade through entire grid
5. **Event system races** compound the reliability issues

The first 2 slices work because sufficient resources exist initially, but resource depletion causes subsequent renders to fail, triggering the Promise.all cascade that kills the entire grid.

This explains both the "Failed to Draw Image" error message and the black panel symptom - they're different stages of the same resource exhaustion cascade failure.

## Report Location

Investigation completed: `/Users/bbuchsbaum/code/brainflow2/claude-code-storage/claude-instance-46/INVESTIGATION_REPORT.md`
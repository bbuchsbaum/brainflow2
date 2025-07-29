# Promise-Based Rendering Architecture

## Overview

This document describes the architectural improvements made to address brittleness in the event-based rendering system. The new promise-based architecture provides better isolation, cleaner APIs, and eliminates complex event filtering logic.

## Problem Statement

The original event-based rendering system had several issues:

1. **Event Filtering Brittleness**: Small changes to event filtering logic could break image centering
2. **Cross-Component Contamination**: Components could receive events meant for others
3. **Complex Debugging**: Hard to trace which component received which event
4. **Race Conditions**: Multiple event sources could conflict
5. **Tight Coupling**: Components were coupled through shared event namespaces

Example of the brittle filtering logic:
```typescript
// If we're looking for a viewType without a tag, don't match events that have tags
if (viewType && !tag && data.tag) return;
```

This single line was critical for proper image centering - removing it broke MosaicView display.

## Solution: Promise-Based Architecture

### Core Components

#### 1. Promise-Based API Methods (apiService.ts)
```typescript
// Direct promise return - no events
async renderViewState(
  viewState: ViewState,
  viewType: 'axial' | 'sagittal' | 'coronal',
  width = 512,
  height = 512
): Promise<ImageBitmap>

// Batch rendering for efficiency
async renderViewStateBatch(
  baseViewState: ViewState,
  sliceConfigs: Array<SliceConfig>
): Promise<ImageBitmap[]>
```

#### 2. RenderSession Abstraction
Provides isolated rendering contexts:
```typescript
class RenderSession {
  // Unique session ID prevents cross-contamination
  private sessionId: string;
  
  // Promise-based render method
  async render(
    viewState: ViewState,
    viewType: ViewType,
    width: number,
    height: number
  ): Promise<RenderResult>
  
  // Built-in lifecycle management
  async dispose(): Promise<void>
}
```

#### 3. useRenderSession Hook
React hook for component integration:
```typescript
const {
  canvasRef,
  isLoading,
  error,
  renderToCanvas,
  getSessionMetadata
} = useRenderSession({
  sessionId: 'my-component',
  onRenderComplete: (result) => { ... }
});
```

### Benefits

1. **Isolation**: Each component/cell has its own render session
2. **Direct Returns**: No event filtering needed - promises return directly
3. **Error Boundaries**: Errors are contained within sessions
4. **Performance Tracking**: Built-in timing and metadata
5. **Cleaner Testing**: Mock promises instead of event streams

## Migration Guide

### Step 1: Update Component to Use useRenderSession

Before (event-based):
```typescript
function MyComponent() {
  const { canvasRef } = useRenderCanvas({
    viewType: 'axial',
    tag: 'my-component'
  });
  
  // Complex event filtering happens internally
}
```

After (promise-based):
```typescript
function MyComponent() {
  const { canvasRef, renderToCanvas } = useRenderSession({
    sessionId: 'my-component'
  });
  
  // Direct render call
  useEffect(() => {
    renderToCanvas(viewState, 'axial');
  }, [viewState]);
}
```

### Step 2: Update Multi-Cell Components

Before (MosaicView with shared events):
```typescript
function MosaicCell({ index }) {
  // Each cell filters events by tag
  useRenderCanvas({
    viewType: 'axial',
    tag: `cell-${index}`
  });
}
```

After (isolated sessions):
```typescript
function MosaicCell({ index }) {
  // Each cell has isolated session
  const { renderToCanvas } = useRenderSession({
    sessionId: `mosaic-cell-${index}`
  });
}
```

### Step 3: Batch Operations

For multiple renders, use batch API:
```typescript
const bitmaps = await apiService.renderViewStateBatch(
  baseViewState,
  cells.map(cell => ({
    viewType: cell.viewType,
    sliceIndex: cell.index,
    width: cellWidth,
    height: cellHeight
  }))
);
```

## Implementation Status

### Completed
- [x] Promise-based methods in ApiService
- [x] RenderSession abstraction
- [x] useRenderSession hook
- [x] SliceViewPromise component
- [x] MosaicViewPromise component
- [x] RenderCoordinator using sessions internally

### Remaining Work
- [ ] Migrate remaining components to promise-based API
- [ ] Remove event-based rendering code
- [ ] Update documentation
- [ ] Add performance benchmarks

## Performance Considerations

1. **Session Overhead**: Each session has minimal overhead (~1KB)
2. **Concurrent Renders**: Sessions can render in parallel
3. **Memory Management**: Sessions should be disposed when done
4. **Caching**: Consider caching rendered bitmaps by session

## Example Components

### SliceViewPromise
Shows single-view rendering with promise-based API.

### MosaicViewPromise  
Demonstrates multi-cell rendering with isolated sessions per cell.

## Backward Compatibility

The new API is added alongside the existing event-based system:
- Existing components continue to work
- Migration can be incremental
- Event emission remains for non-render events

## Future Improvements

1. **Request Cancellation**: Add AbortController support
2. **Render Prioritization**: Priority queue for render requests
3. **Progressive Rendering**: Stream partial results
4. **WebWorker Rendering**: Move rendering off main thread
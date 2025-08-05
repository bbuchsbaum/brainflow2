# Phase 2 Analysis: Current File Loading State Management

## Current State Tracking Locations

### 1. LayerStore
- `loadingLayers: Set<string>` - tracks loading layer IDs
- `errorLayers: Map<string, Error>` - tracks layer errors
- Methods: `setLayerLoading()`, `setLayerError()`

### 2. Event Bus Events
- `file.loading` - emitted when file starts loading
- `file.loaded` - emitted when file finishes loading
- `file.error` - emitted on file loading errors
- `volume.loaded` - emitted when volume is loaded
- `volume.load.complete` - emitted after layer creation
- `volume.load.error` - emitted on volume errors
- `layer.loading` - emitted for layer loading state changes

### 3. Temporary IDs
- FileLoadingService creates `loading-${Date.now()}` temporary IDs
- TemplateService creates `template-loading-${Date.now()}` temporary IDs
- These are used to track loading state before real layer IDs exist

### 4. Component State
- Individual components may track their own loading states
- Potential for state inconsistency

## Problems with Current Approach

1. **Multiple Sources of Truth**
   - Loading state in layerStore
   - Loading events in EventBus
   - Temporary IDs that get orphaned

2. **Race Conditions**
   - Temporary ID created, then real layer ID created
   - Loading state set on temp ID, but cleared on real ID
   - Orphaned loading states if errors occur

3. **No Queue Management**
   - Multiple files can be loaded simultaneously
   - No way to cancel or prioritize loads
   - No visibility into what's in the loading queue

4. **Inconsistent Error Handling**
   - Errors stored in layerStore.errorLayers
   - Also emitted as events
   - Components may not know which to use

## Proposed Solution: Unified Loading Queue

### LoadingQueueStore
```typescript
interface LoadingQueueStore {
  // Queue of pending loads
  queue: LoadingQueueItem[];
  
  // Currently loading items
  activeLoads: Map<string, LoadingQueueItem>;
  
  // Completed loads (success or error)
  completed: LoadingQueueItem[];
  
  // Actions
  enqueue: (item: LoadingQueueItem) => string; // returns queue ID
  cancel: (queueId: string) => void;
  updateProgress: (queueId: string, progress: number) => void;
  markComplete: (queueId: string, result: LoadResult) => void;
  clearCompleted: () => void;
  
  // Queries
  getActiveCount: () => number;
  getQueuedCount: () => number;
  isLoading: (path: string) => boolean;
}

interface LoadingQueueItem {
  id: string; // unique queue ID
  type: 'file' | 'template' | 'atlas';
  path: string; // file path or template ID
  displayName: string;
  status: 'queued' | 'loading' | 'complete' | 'error' | 'cancelled';
  progress?: number; // 0-100
  startTime?: number;
  endTime?: number;
  error?: Error;
  result?: {
    layerId?: string;
    volumeId?: string;
  };
}
```

## Migration Strategy

1. Create new LoadingQueueStore
2. Update FileLoadingService to use queue
3. Update TemplateService to use queue
4. Update UI components to read from queue
5. Remove loadingLayers from layerStore
6. Reduce event emissions to just queue state changes
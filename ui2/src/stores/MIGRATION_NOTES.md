# Migration Notes for Phase 2

## Loading State Migration

The loading state management is being migrated from layerStore to LoadingQueueStore.

### Deprecated (in layerStore):
- `loadingLayers: Set<string>` 
- `setLayerLoading(id, loading)`
- `isLayerLoading` selector

### New (in LoadingQueueStore):
- `useLoadingQueueStore().isLoading(path)`
- `useIsLoading(path)` hook
- Full queue management with progress tracking

### Migration Strategy:
1. Keep deprecated methods temporarily for backward compatibility
2. Update all consumers to use LoadingQueueStore
3. Remove deprecated methods in Phase 4 cleanup

### Components that need updating:
- Any component checking `isLayerLoading`
- Any component calling `setLayerLoading`
- Test files using loading state
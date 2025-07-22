# Files Relevant to Intensity Snapback Bug

## Core Files That Handle Intensity Values

### 1. State Management
- `/ui2/src/stores/viewStateStore.ts` - Main state store, contains setViewState
- `/ui2/src/stores/layerStore.ts` - Layer store, contains createDefaultRender with 20-80% calculation
- `/ui2/src/stores/middleware/coalesceUpdatesMiddleware.ts` - Batches state updates to backend

### 2. UI Components
- `/ui2/src/components/panels/LayerPanel.tsx` - Contains handleRenderUpdate for intensity changes
- `/ui2/src/components/ui/ProSlider.tsx` - The actual slider component for intensity
- `/ui2/src/components/panels/LayerItem.tsx` - Individual layer item display

### 3. Services
- `/ui2/src/services/StoreSyncService.ts` - Syncs between layerStore and viewStateStore
- `/ui2/src/services/LayerService.ts` - Layer management service
- `/ui2/src/services/LayerApiImpl.ts` - Backend API implementation, sets initial 20-80% values
- `/ui2/src/services/apiService.ts` - Communicates with backend
- `/ui2/src/services/FileLoadingService.ts` - Loads volumes and creates layers

### 4. Event System
- `/ui2/src/events/EventBus.ts` - Central event system
- Various event handlers for layer.added, layer.patched, etc.

### 5. Hooks and Effects
- `/ui2/src/hooks/useServicesInit.ts` - Initializes services and sets up coalescing
- `/ui2/src/hooks/useBackendSync.ts` - Syncs with backend
- `/ui2/src/App.tsx` - Contains ViewState subscription that was buggy

### 6. Backend Bridge
- `/core/api_bridge/src/lib.rs` - Rust backend that receives ViewState

## Key Locations Where 20-80% Defaults Are Set

1. **layerStore.ts:86-87**
   ```typescript
   intensity = [
     dataRange.min + (range * 0.20),
     dataRange.min + (range * 0.80)
   ];
   ```

2. **LayerApiImpl.ts:72-73**
   ```typescript
   const intensityMin = min + (range * 0.20);
   const intensityMax = min + (range * 0.80);
   ```

3. **StoreSyncService.ts:158-159**
   ```typescript
   const expectedMin = dataRange.min + (range * 0.20);
   const expectedMax = dataRange.min + (range * 0.80);
   ```

## Event Flow
1. User changes slider → LayerPanel.handleRenderUpdate
2. Updates ViewState → triggers coalescing middleware
3. Updates layerStore → prevents StoreSyncService from using stale values
4. Backend receives update via applyAndRenderViewState
5. Various subscriptions and event handlers fire

## Potential Problem Areas
1. **Timing issues** between dirty flag setting and checking
2. **Synchronous subscriptions** that might fire immediately
3. **Event handlers** that re-initialize values
4. **State reconciliation** that applies defaults
5. **Backend responses** that might trigger updates
6. **ProSlider component** value handling
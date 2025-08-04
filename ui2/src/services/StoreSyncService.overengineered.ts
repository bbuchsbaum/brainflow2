/**
 * StoreSyncService - Keeps layerStore and viewStateStore in sync
 * Ensures that both stores reflect the same layer state
 */

import { getEventBus, type EventBus } from '@/events/EventBus';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ViewLayer } from '@/types/viewState';
import type { Layer as StoreLayer } from '@/types/layers';
import { CoordinateTransform } from '@/utils/coordinates';
import { coalesceUtils } from '@/stores/middleware/coalesceUpdatesMiddleware';

export class StoreSyncService {
  private eventBus: EventBus;
  private isUpdatingFromEvent = false; // Flag to prevent feedback loops
  private hasPerformedInitialSync = false; // Flag to prevent re-initialization
  private isAddingLayer = false; // Flag to prevent sync during layer addition
  private processedLayers = new Set<string>(); // Track layers we've already processed
  private dirtyLayers = new Set<string>(); // Track layers with user-modified values
  private layerVersions = new Map<string, number>(); // Track layer update versions
  
  constructor() {
    console.log('[StoreSyncService] Initializing StoreSyncService...');
    this.eventBus = getEventBus();
    this.initializeEventListeners();
    this.initializeStoreSubscriptions();
    this.performInitialSync();
    this.monitorSynchronization();
    console.log('[StoreSyncService] StoreSyncService initialized and listening for events');
    
    // Add debug check to ensure we're really listening
    const listeners = this.eventBus.listenerCount('layer.added');
    console.log(`[StoreSyncService] Number of listeners for 'layer.added': ${listeners}`);
  }
  
  private performInitialSync() {
    if (this.hasPerformedInitialSync) {
      console.log('[StoreSyncService] Initial sync already performed, skipping');
      return;
    }
    
    console.log('[StoreSyncService] Performing initial sync...');
    
    // Get current layers from layerStore
    const layerState = useLayerStore.getState();
    const layers = layerState.layers;
    
    console.log(`[StoreSyncService] Found ${layers.length} existing layers to sync`);
    
    // Get existing ViewState layers to avoid overwriting user changes
    const existingViewState = useViewStateStore.getState().viewState;
    const existingViewLayers = existingViewState.layers;
    const existingIds = new Set(existingViewLayers.map(l => l.id));
    
    if (layers.length > 0) {
      // Only sync layers that don't already exist in ViewState
      const layersToSync = layers.filter(layer => !existingIds.has(layer.id));
      
      if (layersToSync.length === 0) {
        console.log('[StoreSyncService] All layers already exist in ViewState, skipping sync');
        this.hasPerformedInitialSync = true;
        return;
      }
      
      // Convert store layers to view layers
      const viewLayers: ViewLayer[] = layersToSync.map(layer => {
        const layerRender = layerState.getLayerRender(layer.id);
        const layerMetadata = layerState.getLayerMetadata(layer.id);
        
        // Check if this layer already exists in ViewState (shouldn't happen but be safe)
        const existingViewLayer = existingViewLayers.find(l => l.id === layer.id);
        
        // Use actual data range from metadata if available
        const dataRange = layerMetadata?.dataRange;
        const defaultMin = dataRange?.min ?? 0;
        const defaultMax = dataRange?.max ?? 100;
        
        // CRITICAL: Prefer layerRender values which now include user modifications
        const intensityToUse = layerRender?.intensity ?? existingViewLayer?.intensity ?? [defaultMin, defaultMax];
        const midpoint = defaultMin + (defaultMax - defaultMin) / 2;
        const thresholdToUse = layerRender?.threshold ?? existingViewLayer?.threshold ?? [midpoint, midpoint];
        
        // SINGLE SOURCE OF TRUTH: Use opacity as canonical, derive visible from opacity
        const opacity = existingViewLayer?.opacity ?? (layer.visible ? 1.0 : 0.0);
        const visible = opacity > 0;
        return {
          id: layer.id,
          name: layer.name,
          volumeId: layer.volumeId,
          visible: visible,
          opacity: opacity,
          colormap: existingViewLayer?.colormap ?? layerRender?.colormap ?? 'gray',
          intensity: intensityToUse,
          threshold: thresholdToUse,
          blendMode: 'alpha'
        };
      });
      
      // Merge new layers with existing ViewState layers
      useViewStateStore.getState().setViewState((state) => {
        console.log(`[StoreSyncService] performInitialSync - About to merge ${viewLayers.length} layers`);
        viewLayers.forEach(vl => {
          console.log(`  - Layer ${vl.id} intensity: [${vl.intensity[0]}, ${vl.intensity[1]}]`);
        });
        return {
          ...state,
          layers: [...existingViewLayers, ...viewLayers]
        };
      });
      
      console.log(`[StoreSyncService] Initial sync complete. Added ${viewLayers.length} new layers to ViewState`);
    }
    
    this.hasPerformedInitialSync = true;
  }
  
  private handleLayerAdded = (event: any) => {
    console.log('[StoreSyncService] Processing layer.added event:', event);
    
    const layerId = event.layerId || event.layer?.id || event.id;
    if (!layerId) {
      console.error('[StoreSyncService] layer.added event missing layerId');
      return;
    }
    
    // Prevent duplicate processing
    if (this.processedLayers.has(layerId)) {
      console.log(`[StoreSyncService] Layer ${layerId} already processed, skipping`);
      return;
    }
    
    try {
      // Set flag to prevent feedback loops
      this.isAddingLayer = true;
      
      // Get layer data from layerStore
      const storeLayer = useLayerStore.getState().layers.find(l => l.id === layerId);
      if (!storeLayer) {
        console.error(`[StoreSyncService] Layer ${layerId} not found in layerStore`);
        return;
      }
      
      console.log(`[StoreSyncService] Converting layer ${layerId} to ViewLayer format`);
      
      // Convert to ViewLayer format
      const viewLayer = this.convertStoreLayerToViewLayer(storeLayer);
      
      // Update ViewState with immediate synchronization
      const currentViewState = useViewStateStore.getState().viewState;
      const updatedLayers = [...currentViewState.layers, viewLayer];
      
      console.log(`[StoreSyncService] Updating ViewState with ${updatedLayers.length} layers`);
      
      // Use immediate update to prevent timing issues
      const store = useViewStateStore.getState() as any;
      if (store._originalSet) {
        store._originalSet((storeState: any) => {
          return {
            ...storeState,
            viewState: {
              ...storeState.viewState,
              layers: updatedLayers
            }
          };
        });
      } else {
        useViewStateStore.getState().setViewState((state) => ({
          ...state,
          layers: updatedLayers
        }));
      }
      
      // Mark as processed
      this.processedLayers.add(layerId);
      
      // Add the layer to layerStore as well
      console.log(`[StoreSyncService] Adding layer ${layerId} to layerStore`);
      useLayerStore.getState().addLayer(storeLayer, {
        opacity: viewLayer.opacity,
        intensity: viewLayer.intensity,
        threshold: viewLayer.threshold,
        colormap: viewLayer.colormap,
        interpolation: 'linear' as const
      });
      
      // Center crosshair on first layer
      if (updatedLayers.length === 1) {
        const layerMetadata = useLayerStore.getState().getLayerMetadata(layerId);
        if (layerMetadata?.centerWorld) {
          console.log('[StoreSyncService] Centering crosshair on first layer');
          useViewStateStore.getState().setCrosshair(layerMetadata.centerWorld, true);
        }
      }
      
      // Force a render by flushing the coalescing middleware
      console.log(`[StoreSyncService] Forcing coalescing middleware flush after layer addition`);
      coalesceUtils.flush(true); // Force dimension update to trigger render
      
      console.log(`[StoreSyncService] Successfully processed layer ${layerId}`);
      
    } catch (error) {
      console.error(`[StoreSyncService] Error processing layer.added event:`, error);
    } finally {
      this.isAddingLayer = false;
    }
  };

  private convertStoreLayerToViewLayer(storeLayer: StoreLayer): ViewLayer {
    const layerRender = useLayerStore.getState().getLayerRender(storeLayer.id);
    const layerMetadata = useLayerStore.getState().getLayerMetadata(storeLayer.id);
    
    // Use actual data range from metadata if available
    const dataRange = layerMetadata?.dataRange;
    const defaultMin = dataRange?.min ?? 0;
    const defaultMax = dataRange?.max ?? 100;
    
    // CRITICAL: Prefer layerRender values which now include user modifications
    const intensityToUse = layerRender?.intensity ?? [defaultMin, defaultMax];
    const midpoint = defaultMin + (defaultMax - defaultMin) / 2;
    const thresholdToUse = layerRender?.threshold ?? [midpoint, midpoint];
    
    // SINGLE SOURCE OF TRUTH: Use opacity as canonical, derive visible from opacity
    const opacity = layerRender?.opacity ?? (storeLayer.visible ? 1.0 : 0.0);
    const visible = opacity > 0;
    
    return {
      id: storeLayer.id,
      name: storeLayer.name,
      volumeId: storeLayer.volumeId,
      visible: visible,
      opacity: opacity,
      colormap: layerRender?.colormap ?? 'gray',
      intensity: intensityToUse,
      threshold: thresholdToUse,
      blendMode: 'alpha'
    };
  }

  private initializeEventListeners() {
    // REMOVED: layer.metadata.updated handler was causing intensity values to reset
    // The intensity values are already correctly set when the layer is added,
    // so we don't need to update them again when metadata changes.
    // This was causing the bug where slider values would snap back to defaults.
    
    // Sync layer additions
    this.eventBus.on('layer.added', this.handleLayerAdded);
    
    // Sync layer removals
    this.eventBus.on('layer.removed', ({ layerId }) => {
      // Remove from processed layers set
      this.processedLayers.delete(layerId);
      // Remove from dirty layers set
      this.dirtyLayers.delete(layerId);
      
      useViewStateStore.getState().setViewState((state) => ({
        ...state,
        layers: state.layers.filter(layer => layer.id !== layerId)
      }));
    });
    
    // Sync layer visibility changes
    // REFACTORED: Single source of truth - only update opacity
    // The 'visible' property will be derived from opacity > 0
    this.eventBus.on('layer.visibility', ({ layerId, visible }) => {
      useViewStateStore.getState().setViewState((state) => {
        const layers = [...state.layers];
        const index = layers.findIndex(l => l.id === layerId);
        if (index !== -1) {
          layers[index] = {
            ...layers[index],
            // Only update opacity - visible is derived from opacity > 0
            opacity: visible ? 1.0 : 0.0
          };
        }
        return { ...state, layers };
      });
    });
    
    // Sync layer reordering
    this.eventBus.on('layer.reordered', ({ layerIds }) => {
      const viewState = useViewStateStore.getState();
      const currentLayers = viewState.viewState.layers;
      
      // Reorder layers based on the new order
      const reorderedLayers = layerIds
        .map(id => currentLayers.find(l => l.id === id))
        .filter(Boolean) as ViewLayer[];
      
      // Update the entire layers array
      viewState.setViewState((state) => ({
        ...state,
        layers: reorderedLayers
      }));
    });
    
    // Sync layer render property updates (colormap, intensity, threshold, etc)
    this.eventBus.on('layer.patched', ({ layerId, patch }) => {
      console.log('[StoreSyncService] layer.patched event received:', { layerId, patch });
      
      // IMPORTANT: This event fires AFTER the backend has processed the patch
      // The ViewState has already been updated by the UI component that triggered the change
      // We should NOT update ViewState here as it can cause race conditions
      // where we read stale values from layerStore and override user changes
      
      // Mark this layer as dirty (has user modifications)
      if (patch.intensity || patch.threshold || patch.colormap || patch.opacity !== undefined) {
        // Layer is already marked dirty by LayerPanel, but ensure it stays dirty
        if (!this.dirtyLayers.has(layerId)) {
          this.dirtyLayers.add(layerId);
          console.log(`[StoreSyncService] Marked layer ${layerId} as dirty (user-modified) from patch event`);
        }
      }
      
      // Simply log that the backend has acknowledged the patch
      console.log('[StoreSyncService] Backend acknowledged patch for layer:', layerId);
      
      // Do NOT update ViewState here - it's already up to date from the UI
      // Do NOT clear dirty flag here - user may still be making changes
    });
  }
  
  private initializeStoreSubscriptions() {
    console.log('[StoreSyncService] Initializing store subscriptions...');
    
    // Subscribe to ViewState changes to keep layerStore in sync
    // ViewState is the source of truth, layerStore is for UI display
    const unsubscribe = useViewStateStore.subscribe(
      (state) => state.viewState.layers,
      (viewLayers) => {
        if (this.isUpdatingFromEvent) {
          return; // Prevent feedback loops
        }
        
        // Skip if we're in the middle of adding a layer or performing initial sync
        // This prevents the subscription from overwriting the initial render properties
        if (this.isAddingLayer || !this.hasPerformedInitialSync) {
          console.log('[StoreSyncService] Skipping ViewState sync - layer addition or initial sync in progress');
          return;
        }
        
        console.log('[StoreSyncService] ViewState layers changed, syncing to layerStore');
        console.log('[StoreSyncService] ViewState layers:', viewLayers.map(l => ({
          id: l.id,
          intensity: l.intensity,
          isDirty: this.dirtyLayers.has(l.id)
        })));
        
        // Update layerStore render properties to match ViewState
        const layerStore = useLayerStore.getState();
        
        viewLayers.forEach(viewLayer => {
          const storeLayer = layerStore.layers.find(l => l.id === viewLayer.id);
          if (storeLayer) {
            // Skip if this layer is marked as dirty (has user modifications)
            if (this.dirtyLayers.has(viewLayer.id)) {
              console.log(`[StoreSyncService] Skipping layerStore update for ${viewLayer.id} - layer is dirty (user-modified)`);
              return;
            }
            
            // Get current render properties to check if they're newer
            const currentRender = layerStore.getLayerRender(viewLayer.id);
            
            // Skip update if layerStore already has the same or newer values
            // This prevents overwriting user changes that were just made
            if (currentRender && 
                currentRender.intensity?.[0] === viewLayer.intensity[0] &&
                currentRender.intensity?.[1] === viewLayer.intensity[1]) {
              console.log(`[StoreSyncService] Skipping layerStore update for ${viewLayer.id} - values already match`);
              return;
            }
            
            // Update render properties in layerStore to match ViewState
            const renderUpdate = {
              opacity: viewLayer.opacity,
              intensity: viewLayer.intensity,
              threshold: viewLayer.threshold,
              colormap: viewLayer.colormap,
              interpolation: 'linear' as const
            };
            
            // Use updateLayerRender to update the render properties
            layerStore.updateLayerRender(viewLayer.id, renderUpdate);
            
            console.log(`[StoreSyncService] Updated layerStore render for ${viewLayer.id}:`, renderUpdate);
          }
        });
      },
      {
        equalityFn: (a, b) => {
          // Custom equality check to prevent unnecessary updates
          if (a.length !== b.length) return false;
          
          return a.every((layerA, index) => {
            const layerB = b[index];
            return (
              layerA.id === layerB.id &&
              layerA.opacity === layerB.opacity &&
              layerA.intensity[0] === layerB.intensity[0] &&
              layerA.intensity[1] === layerB.intensity[1] &&
              layerA.threshold[0] === layerB.threshold[0] &&
              layerA.threshold[1] === layerB.threshold[1] &&
              layerA.colormap === layerB.colormap
            );
          });
        }
      }
    );
    
    // Store unsubscribe function for cleanup if needed
    // Note: In a singleton service, we typically don't unsubscribe
  }
  
  /**
   * Mark a layer as having user-modified values
   * This prevents StoreSyncService from overwriting user changes
   */
  public markLayerDirty(layerId: string) {
    this.dirtyLayers.add(layerId);
    // Increment version to indicate user modification
    const currentVersion = this.layerVersions.get(layerId) || 0;
    this.layerVersions.set(layerId, currentVersion + 1);
    console.log(`[StoreSyncService] Marked layer ${layerId} as dirty (user-modified), version: ${currentVersion + 1}`);
  }
  
  /**
   * Clear the dirty flag for a layer
   */
  public clearLayerDirty(layerId: string) {
    this.dirtyLayers.delete(layerId);
    console.log(`[StoreSyncService] Cleared dirty flag for layer ${layerId}`);
  }
  
  /**
   * Monitor store synchronization and fix desynchronization automatically
   */
  private monitorSynchronization() {
    setInterval(() => {
      const layerStoreState = useLayerStore.getState();
      const viewStateState = useViewStateStore.getState();
      
      const layerStoreLayers = layerStoreState.layers.length;
      const viewStateLayers = viewStateState.viewState.layers.length;
      
      if (layerStoreLayers !== viewStateLayers) {
        console.warn(`[StoreSyncService] Store desynchronization detected: LayerStore=${layerStoreLayers}, ViewState=${viewStateLayers}`);
        
        // Attempt automatic resynchronization
        this.performFullSync();
      }
    }, 5000); // Check every 5 seconds
  }
  
  /**
   * Perform full synchronization between stores
   */
  private performFullSync() {
    console.log('[StoreSyncService] Performing full store synchronization...');
    
    try {
      const layerStoreState = useLayerStore.getState();
      const viewLayers = layerStoreState.layers.map(layer => 
        this.convertStoreLayerToViewLayer(layer)
      );
      
      const store = useViewStateStore.getState() as any;
      if (store._originalSet) {
        store._originalSet((storeState: any) => ({
          ...storeState,
          viewState: {
            ...storeState.viewState,
            layers: viewLayers
          }
        }));
      } else {
        useViewStateStore.getState().setViewState((state) => ({
          ...state,
          layers: viewLayers
        }));
      }
      
      console.log(`[StoreSyncService] Full sync completed: ${viewLayers.length} layers`);
    } catch (error) {
      console.error('[StoreSyncService] Full sync failed:', error);
    }
  }
}

// Singleton instance
let storeSyncServiceInstance: StoreSyncService | null = null;

// Global flag to prevent multiple initializations during React StrictMode
let isInitializing = false;

/**
 * Get the singleton StoreSyncService instance
 */
export function getStoreSyncService(): StoreSyncService {
  if (!storeSyncServiceInstance && !isInitializing) {
    isInitializing = true;
    console.log('[StoreSyncService] Creating new singleton instance');
    storeSyncServiceInstance = new StoreSyncService();
    isInitializing = false;
  } else if (isInitializing) {
    console.warn('[StoreSyncService] Already initializing, waiting for completion...');
    // Wait for initialization to complete
    while (isInitializing) {
      // Busy wait - not ideal but prevents race conditions in StrictMode
    }
  }
  return storeSyncServiceInstance!;
}

/**
 * Initialize the store sync service
 * Should be called on app startup
 */
export function initializeStoreSyncService(): StoreSyncService {
  return getStoreSyncService();
}
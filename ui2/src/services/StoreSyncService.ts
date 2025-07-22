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
        const thresholdToUse = layerRender?.threshold ?? existingViewLayer?.threshold ?? [defaultMin, defaultMax];
        
        return {
          id: layer.id,
          name: layer.name,
          volumeId: layer.volumeId,
          visible: layer.visible,
          opacity: existingViewLayer?.opacity ?? (layer.visible ? 1.0 : 0.0),
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
  
  private initializeEventListeners() {
    // REMOVED: layer.metadata.updated handler was causing intensity values to reset
    // The intensity values are already correctly set when the layer is added,
    // so we don't need to update them again when metadata changes.
    // This was causing the bug where slider values would snap back to defaults.
    
    // Sync layer additions
    this.eventBus.on('layer.added', ({ layer }) => {
      const eventTime = performance.now();
      console.log(`[StoreSyncService ${eventTime.toFixed(0)}ms] 🔴 LAYER.ADDED EVENT HANDLER CALLED!`);
      console.log(`[StoreSyncService ${eventTime.toFixed(0)}ms] layer.added event received:`, JSON.stringify(layer));
      
      // Log duplicate event check
      if (this.processedLayers.has(layer.id)) {
        console.warn(`[StoreSyncService] ⚠️ DUPLICATE layer.added event for layer ${layer.id}!`);
        console.trace('Duplicate event stack trace:');
      }
      
      // Set flag to prevent ViewState subscription from syncing during layer addition
      this.isAddingLayer = true;
      
      // Check if layer already exists in ViewState to avoid overwriting user changes
      const existingViewState = useViewStateStore.getState().viewState;
      const existingLayer = existingViewState.layers.find(l => l.id === layer.id);
      
      if (existingLayer) {
        console.log(`[StoreSyncService] Layer ${layer.id} already exists in ViewState, skipping to preserve user changes`);
        console.log(`  - Existing intensity: [${existingLayer.intensity[0]}, ${existingLayer.intensity[1]}]`);
        console.log(`  - Existing opacity: ${existingLayer.opacity}`);
        this.isAddingLayer = false; // Clear flag
        this.processedLayers.add(layer.id); // Mark as processed
        return;
      }
      
      // Check if this layer is marked as dirty (has user modifications)
      if (this.dirtyLayers.has(layer.id)) {
        console.log(`[StoreSyncService] Layer ${layer.id} is marked as dirty, skipping to preserve user changes`);
        this.isAddingLayer = false; // Clear flag
        return;
      }
      
      // Check if we've already processed this layer (prevent duplicate events)
      if (this.processedLayers.has(layer.id)) {
        console.log(`[StoreSyncService] Layer ${layer.id} already processed, skipping duplicate event`);
        this.isAddingLayer = false;
        return;
      }
      
      // Get render properties and metadata from layerStore
      const layerRender = useLayerStore.getState().getLayerRender(layer.id);
      const layerMetadata = useLayerStore.getState().getLayerMetadata(layer.id);
      console.log(`[StoreSyncService ${performance.now() - eventTime}ms] Layer render properties:`, JSON.stringify(layerRender));
      console.log(`[StoreSyncService ${performance.now() - eventTime}ms] Layer metadata:`, JSON.stringify(layerMetadata));
      
      // CRITICAL: Log if layerRender has user-modified values
      if (layerRender?.intensity) {
        const dataRange = layerMetadata?.dataRange;
        if (dataRange) {
          const range = dataRange.max - dataRange.min;
          const expectedMin = dataRange.min + (range * 0.20);
          const expectedMax = dataRange.min + (range * 0.80);
          const isDefault = Math.abs(layerRender.intensity[0] - expectedMin) < 1 && 
                           Math.abs(layerRender.intensity[1] - expectedMax) < 1;
          console.log(`[StoreSyncService] Intensity values - isDefault: ${isDefault}, values: [${layerRender.intensity[0]}, ${layerRender.intensity[1]}]`);
          
          // Mark the layer as having user-modified values if not default
          if (!isDefault) {
            console.log(`[StoreSyncService] Layer ${layer.id} has USER-MODIFIED intensity values`);
          }
        }
      }
      
      // IMPORTANT: Check if ViewState already has this layer with user-modified values
      // This can happen if the user quickly changes values before events propagate
      const currentViewState = useViewStateStore.getState().viewState;
      const currentViewLayer = currentViewState.layers.find(l => l.id === layer.id);
      
      // Use actual data range from layer render properties (set by LayerApiImpl)
      // LayerApiImpl now sets the render properties with actual data range before adding the layer
      const actualIntensity = layerRender?.intensity;
      const actualThreshold = layerRender?.threshold;
      
      // CRITICAL FIX: Always use layerRender values if available
      // Since LayerPanel now updates layerStore, layerRender will have user values
      let intensityToUse: [number, number];
      
      // FIRST PRIORITY: If ViewState already has this layer with user values, preserve them
      if (currentViewLayer && currentViewLayer.intensity && this.dirtyLayers.has(layer.id)) {
        console.log(`[StoreSyncService] Layer ${layer.id} is dirty, preserving existing ViewState values: [${currentViewLayer.intensity[0]}, ${currentViewLayer.intensity[1]}]`);
        intensityToUse = currentViewLayer.intensity;
      } else if (currentViewLayer && currentViewLayer.intensity) {
        console.log(`[StoreSyncService] Preserving existing ViewState values: [${currentViewLayer.intensity[0]}, ${currentViewLayer.intensity[1]}]`);
        intensityToUse = currentViewLayer.intensity;
      } else if (actualIntensity) {
        console.log(`[StoreSyncService] Using intensity from layerRender: [${actualIntensity[0]}, ${actualIntensity[1]}]`);
        intensityToUse = actualIntensity;
      } else {
        // Fallback to metadata if render properties not set
        const dataRange = layerMetadata?.dataRange;
        const defaultMin = dataRange?.min ?? 0;
        const defaultMax = dataRange?.max ?? 100;
        console.log(`[StoreSyncService] No intensity values found, using data range: [${defaultMin}, ${defaultMax}]`);
        intensityToUse = [defaultMin, defaultMax];
      }
      
      console.log(`[StoreSyncService ${performance.now() - eventTime}ms] Final intensity resolution:`);
      console.log(`  - Using intensity: [${intensityToUse[0]}, ${intensityToUse[1]}]`);
      
      // Convert StoreLayer to ViewLayer format matching backend expectations
      console.log(`[StoreSyncService] Processing layer with visible=${layer.visible}`);
      const viewLayer: ViewLayer = {
        id: layer.id,
        name: layer.name,
        volumeId: layer.volumeId,
        visible: layer.visible,
        opacity: currentViewLayer?.opacity ?? (layer.visible ? 1.0 : 0.0),
        colormap: currentViewLayer?.colormap ?? layerRender?.colormap ?? 'gray',
        intensity: intensityToUse,
        threshold: currentViewLayer?.threshold ?? [
          actualThreshold?.[0] ?? -1e10,
          actualThreshold?.[1] ?? 1e10
        ],
        blendMode: 'alpha'
      };
      console.log(`[StoreSyncService] Created ViewLayer with visible=${viewLayer.visible}, opacity=${viewLayer.opacity}`);
      
      console.log(`[StoreSyncService ${performance.now() - eventTime}ms] Created ViewLayer:`, JSON.stringify(viewLayer));
      
      // Add layer to viewState
      const prevViewState = useViewStateStore.getState().viewState;
      const prevLayers = prevViewState.layers;
      console.log(`[StoreSyncService ${performance.now() - eventTime}ms] ViewState before update:`);
      console.log(`  - layers: ${prevLayers.length}`);
      console.log(`  - layer ids:`, prevLayers.map(l => l.id));
      
      // If this is the first layer and we have center world coordinates, update crosshair and views
      if (prevLayers.length === 0 && layerMetadata?.centerWorld) {
        console.log(`[StoreSyncService ${performance.now() - eventTime}ms] First layer - centering crosshair at:`, layerMetadata.centerWorld);
        useViewStateStore.getState().setCrosshair(layerMetadata.centerWorld, true);
        
        // Also update the views to be properly centered in world space
        console.log(`[StoreSyncService ${performance.now() - eventTime}ms] Updating views to center on volume`);
        const currentViews = useViewStateStore.getState().viewState.views;
        
        // Calculate appropriate field of view based on data range
        // This is a rough estimate - ideally we'd have volume dimensions in mm
        const fov = 256; // Default FOV in mm for brain imaging
        
        const newViews = CoordinateTransform.createOrthogonalViews(
          layerMetadata.centerWorld,
          [fov, fov],
          [currentViews.axial.dim_px[0], currentViews.axial.dim_px[1]]
        );
        
        // Update each view
        Object.entries(newViews).forEach(([viewType, plane]) => {
          useViewStateStore.getState().updateView(viewType as any, plane);
        });
        
        console.log(`[StoreSyncService ${performance.now() - eventTime}ms] Views updated`);
      }
      
      console.log(`[StoreSyncService ${performance.now() - eventTime}ms] Calling setViewState to add layer...`);
      useViewStateStore.getState().setViewState((state) => {
        // Check if we're overwriting an existing layer with user values
        const existingLayerInState = state.layers.find(l => l.id === viewLayer.id);
        if (existingLayerInState) {
          console.error(`[StoreSyncService] ❌ CRITICAL: About to overwrite existing layer ${viewLayer.id} in ViewState!`);
          console.error(`  - Existing intensity: [${existingLayerInState.intensity[0]}, ${existingLayerInState.intensity[1]}]`);
          console.error(`  - New intensity: [${viewLayer.intensity[0]}, ${viewLayer.intensity[1]}]`);
          console.trace('Overwrite stack trace:');
          // Don't add duplicate - this is likely causing the reset!
          return state;
        }
        
        const newState = {
          ...state,
          layers: [...state.layers, viewLayer]
        };
        console.log(`[StoreSyncService] Inside setViewState - old layers: ${state.layers.length}, new layers: ${newState.layers.length}`);
        return newState;
      });
      
      const newViewState = useViewStateStore.getState().viewState;
      const newLayers = newViewState.layers;
      console.log(`[StoreSyncService ${performance.now() - eventTime}ms] ViewState after update:`);
      console.log(`  - layers: ${newLayers.length}`);
      console.log(`  - layer ids:`, newLayers.map(l => l.id));
      console.log(`  - full layers:`, JSON.stringify(newLayers));
      
      // Also log to verify the ViewState was actually updated
      setTimeout(() => {
        const finalViewState = useViewStateStore.getState().viewState;
        const finalLayers = finalViewState.layers;
        console.log(`[StoreSyncService ${performance.now() - eventTime}ms] ViewState check after 100ms:`);
        console.log(`  - layers: ${finalLayers.length}`);
        console.log(`  - layer ids:`, finalLayers.map(l => l.id));
        
        if (finalLayers.length === 0) {
          console.error(`[StoreSyncService] WARNING: ViewState has 0 layers after sync!`);
        }
        
        // Clear the flag and mark as processed after layer addition is complete
        this.isAddingLayer = false;
        this.processedLayers.add(layer.id);
      }, 100);
    });
    
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
    this.eventBus.on('layer.visibility', ({ layerId, visible }) => {
      useViewStateStore.getState().setViewState((state) => {
        const layers = [...state.layers];
        const index = layers.findIndex(l => l.id === layerId);
        if (index !== -1) {
          layers[index] = {
            ...layers[index],
            visible,
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
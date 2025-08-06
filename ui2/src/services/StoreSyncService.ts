/**
 * StoreSyncService - Simplified version
 * Keeps layerStore and viewStateStore in sync with minimal complexity
 */

import { getEventBus, type EventBus } from '@/events/EventBus';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ViewLayer } from '@/types/viewState';
import type { Layer as StoreLayer } from '@/types/layers';

export class StoreSyncService {
  private eventBus: EventBus;
  private dirtyLayers = new Set<string>(); // Track layers being actively edited
  
  constructor() {
    this.eventBus = getEventBus();
    this.initializeEventListeners();
  }
  
  private convertToViewLayer(storeLayer: StoreLayer): ViewLayer {
    // Try to get existing render properties from ViewState first
    const viewState = useViewStateStore.getState().viewState;
    const existingViewLayer = viewState.layers.find(l => l.id === storeLayer.id);
    
    const layerMetadata = useLayerStore.getState().getLayerMetadata(storeLayer.id);
    
    // Use data range from metadata if available
    const dataRange = layerMetadata?.dataRange;
    const defaultMin = dataRange?.min ?? 0;
    const defaultMax = dataRange?.max ?? 100;
    
    // If layer already exists in ViewState, preserve its render properties
    if (existingViewLayer) {
      return {
        ...existingViewLayer,
        name: storeLayer.name,
        volumeId: storeLayer.volumeId,
      };
    }
    
    // Check if metadata contains render properties calculated by LayerApiImpl
    const metadataRenderProps = (layerMetadata as any)?.renderProps;
    if (metadataRenderProps) {
      console.log('[StoreSyncService] Using render properties from metadata:', metadataRenderProps);
      return {
        id: storeLayer.id,
        name: storeLayer.name,
        volumeId: storeLayer.volumeId,
        visible: true,
        opacity: metadataRenderProps.opacity ?? 1.0,
        colormap: metadataRenderProps.colormap ?? 'gray',
        intensity: metadataRenderProps.intensity ?? [defaultMin, defaultMax],
        threshold: metadataRenderProps.threshold ?? [defaultMin, defaultMin],
        blendMode: 'alpha'
      };
    }
    
    // Otherwise create with defaults
    console.log('[StoreSyncService] Using default intensity range:', [defaultMin, defaultMax]);
    return {
      id: storeLayer.id,
      name: storeLayer.name,
      volumeId: storeLayer.volumeId,
      visible: true,
      opacity: 1.0,
      colormap: 'gray',
      intensity: [defaultMin, defaultMax],
      threshold: [defaultMin, defaultMin],
      blendMode: 'alpha'
    };
  }

  private initializeEventListeners() {
    // When a layer is added, sync to ViewState
    this.eventBus.on('layer.added', ({ layer }) => {
      const layerId = layer?.id;
      if (!layerId) return;
      
      // Get the layer from store
      const storeLayer = useLayerStore.getState().layers.find(l => l.id === layerId);
      if (!storeLayer) return;
      
      // Convert and add to ViewState (renderProps will be read from metadata)
      const viewLayer = this.convertToViewLayer(storeLayer);
      
      useViewStateStore.getState().setViewState((state) => ({
        ...state,
        layers: [...state.layers, viewLayer]
      }));
      
      // Center crosshair on first layer
      if (useViewStateStore.getState().viewState.layers.length === 1) {
        const metadata = useLayerStore.getState().getLayerMetadata(layerId);
        if (metadata?.centerWorld) {
          useViewStateStore.getState().setCrosshair(metadata.centerWorld, true);
        }
      }
    });
    
    // When a layer is removed, sync to ViewState
    this.eventBus.on('layer.removed', ({ layerId }) => {
      this.dirtyLayers.delete(layerId);
      
      useViewStateStore.getState().setViewState((state) => ({
        ...state,
        layers: state.layers.filter(layer => layer.id !== layerId)
      }));
    });
    
    // When visibility changes, update opacity
    this.eventBus.on('layer.visibility', ({ layerId, visible }) => {
      useViewStateStore.getState().setViewState((state) => {
        const layers = [...state.layers];
        const index = layers.findIndex(l => l.id === layerId);
        if (index !== -1) {
          layers[index] = {
            ...layers[index],
            opacity: visible ? 1.0 : 0.0,
            visible
          };
        }
        return { ...state, layers };
      });
    });
    
    // When layers are reordered
    this.eventBus.on('layer.reordered', ({ layerIds }) => {
      const currentLayers = useViewStateStore.getState().viewState.layers;
      
      const reorderedLayers = layerIds
        .map(id => currentLayers.find(l => l.id === id))
        .filter(Boolean) as ViewLayer[];
      
      useViewStateStore.getState().setViewState((state) => ({
        ...state,
        layers: reorderedLayers
      }));
    });
  }
  
  /**
   * Mark a layer as being edited by user
   * This prevents automatic syncing that could override user changes
   */
  public markLayerDirty(layerId: string) {
    this.dirtyLayers.add(layerId);
  }
  
  /**
   * Clear the dirty flag when user is done editing
   */
  public clearLayerDirty(layerId: string) {
    this.dirtyLayers.delete(layerId);
  }
}

// Singleton instance
let instance: StoreSyncService | null = null;

export function getStoreSyncService(): StoreSyncService {
  if (!instance) {
    instance = new StoreSyncService();
  }
  return instance;
}

export function initializeStoreSyncService(): StoreSyncService {
  return getStoreSyncService();
}
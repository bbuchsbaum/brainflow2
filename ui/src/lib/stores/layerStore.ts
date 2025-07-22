/**
 * Clean Layer Store - Pure state management without business logic
 * Uses Svelte stores and follows clean architecture principles
 */
import { writable, derived, get } from 'svelte/store';
import type { LayerSpec, VolumeLayerGpuInfo } from '@brainflow/api';
import { getEventBus } from '$lib/events/EventBus';

export interface LayerInfo {
  dataRange?: { min: number; max: number };
  volumeId?: string;
}

export interface LayerEntry {
  id: string;
  spec: LayerSpec;
  gpu?: VolumeLayerGpuInfo;
  error?: Error | unknown;
  isLoadingGpu?: boolean;
  info?: LayerInfo;
}

// Helper function to get the ID from a LayerSpec
export function getLayerId(spec: LayerSpec): string {
  if ('Volume' in spec) {
    return spec.Volume.id;
  }
  throw new Error('Unsupported layer type');
}

// Create the writable stores
const layers = writable<LayerEntry[]>([]);
const activeLayerId = writable<string | null>(null);

// Create derived stores
export const activeLayer = derived(
  [layers, activeLayerId],
  ([$layers, $activeLayerId]) => {
    if (!$activeLayerId) return null;
    return $layers.find(l => l.id === $activeLayerId) || null;
  }
);

export const hasLayers = derived(
  layers,
  $layers => $layers.length > 0
);

export const visibleLayers = derived(
  layers,
  $layers => $layers.filter(l => !l.error && l.gpu)
);

// Create the layerStore with clean methods
function createLayerStore() {
  const { subscribe } = layers;
  
  return {
    subscribe,
    
    // Pure state mutations
    addLayer: (id: string, spec: LayerSpec) => {
      const newEntry: LayerEntry = { id, spec, isLoadingGpu: false };
      layers.update(currentLayers => [...currentLayers, newEntry]);
      
      // Emit event for other systems to react
      getEventBus().emit('layer.added', { layerId: id, spec });
    },
    
    updateLayer: (layerId: string, updates: Partial<LayerEntry>) => {
      console.log('[layerStore] Updating layer:', { layerId, updates });
      layers.update(currentLayers => {
        const updated = currentLayers.map(layer =>
          layer.id === layerId ? { ...layer, ...updates } : layer
        );
        console.log('[layerStore] Layers after update:', updated);
        return updated;
      });
      
      getEventBus().emit('layer.updated', { layerId, updates });
    },
    
    removeLayer: (layerId: string) => {
      const layer = get(layers).find(l => l.id === layerId);
      if (!layer) return;
      
      layers.update(currentLayers => currentLayers.filter(l => l.id !== layerId));
      
      // Clear active layer if it was removed
      if (get(activeLayerId) === layerId) {
        activeLayerId.set(null);
      }
      
      getEventBus().emit('layer.removed', { layerId });
    },
    
    setActiveLayer: (layerId: string | null) => {
      activeLayerId.set(layerId);
      getEventBus().emit('layer.selected', { layerId });
    },
    
    getLayer: (layerId: string): LayerEntry | undefined => {
      return get(layers).find(l => l.id === layerId);
    },
    
    getLayersByVolumeId: (volumeId: string): LayerEntry[] => {
      return get(layers).filter(layer => {
        if ('Volume' in layer.spec && layer.spec.Volume.source_resource_id === volumeId) {
          return true;
        }
        return false;
      });
    },
    
    clearAll: () => {
      layers.set([]);
      activeLayerId.set(null);
      getEventBus().emit('layers.cleared');
    },
    
    // Getters for current state
    getState: () => ({
      layers: get(layers),
      activeLayerId: get(activeLayerId)
    })
  };
}

// Create and export the store instance
export const useLayerStore = createLayerStore();

// Also export the raw stores for component bindings
export { layers, activeLayerId };

// Add layers as a property on useLayerStore for backward compatibility
useLayerStore.layers = layers;

// Listen to events from services
const eventBus = getEventBus();

// Update GPU info when resources are ready
eventBus.on('layer.gpu.request.success', ({ layerId, gpuInfo }) => {
  console.log('[layerStore] GPU request success:', { layerId, gpuInfo });
  useLayerStore.updateLayer(layerId, { 
    gpu: gpuInfo,
    isLoadingGpu: false,
    error: undefined
  });
});

// Update loading state
eventBus.on('layer.gpu.request.start', ({ layerId }) => {
  useLayerStore.updateLayer(layerId, { 
    isLoadingGpu: true,
    error: undefined
  });
});

// Handle errors
eventBus.on('layer.gpu.request.error', ({ layerId, error }) => {
  useLayerStore.updateLayer(layerId, { 
    error,
    isLoadingGpu: false
  });
});

// Handle layer addition requests from service
eventBus.on('layer.add.requested', ({ layerId, spec }) => {
  useLayerStore.addLayer(layerId, spec);
});

// Handle layer update requests from service
eventBus.on('layer.update.requested', ({ layerId, updates }) => {
  const layer = useLayerStore.getLayer(layerId);
  if (!layer) return;
  
  // Update the spec with the new values
  if ('Volume' in layer.spec && updates) {
    const updatedSpec = {
      ...layer.spec,
      Volume: {
        ...layer.spec.Volume,
        ...updates
      }
    };
    
    useLayerStore.updateLayer(layerId, { spec: updatedSpec });
  }
});

// Handle active layer requests from service
eventBus.on('layer.setactive.requested', ({ layerId }) => {
  useLayerStore.setActiveLayer(layerId);
});
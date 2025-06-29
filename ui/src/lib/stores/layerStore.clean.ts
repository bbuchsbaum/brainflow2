/**
 * Clean LayerStore implementation
 * Pure state management without business logic or circular dependencies
 */
import { createStore } from '$lib/zustand-vanilla';
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

interface LayerState {
  layers: Map<string, LayerEntry>;
  activeLayerId: string | null;
  
  // Pure state mutations
  addLayer: (id: string, spec: LayerSpec) => void;
  updateLayer: (layerId: string, updates: Partial<LayerEntry>) => void;
  removeLayer: (layerId: string) => void;
  setActiveLayer: (layerId: string | null) => void;
  
  // Getters
  getLayer: (layerId: string) => LayerEntry | undefined;
  getLayersByVolumeId: (volumeId: string) => LayerEntry[];
}

function getLayerId(spec: LayerSpec): string {
  if ('Volume' in spec) {
    return spec.Volume.id;
  }
  throw new Error('Unsupported layer type');
}

export const layerStoreClean = createStore<LayerState>((set, get) => ({
  layers: new Map(),
  activeLayerId: null,
  
  addLayer: (id, spec) => {
    const newEntry: LayerEntry = { id, spec, isLoadingGpu: false };
    
    set((state) => {
      const layers = new Map(state.layers);
      layers.set(id, newEntry);
      return { layers };
    });
    
    // Emit event for other systems to react
    getEventBus().emit('layer.added', { layerId: id, spec });
  },
  
  updateLayer: (layerId, updates) => {
    set((state) => {
      const layers = new Map(state.layers);
      const existing = layers.get(layerId);
      if (existing) {
        layers.set(layerId, { ...existing, ...updates });
      }
      return { layers };
    });
    
    getEventBus().emit('layer.updated', { layerId, updates });
  },
  
  removeLayer: (layerId) => {
    const layer = get().getLayer(layerId);
    if (!layer) return;
    
    set((state) => {
      const layers = new Map(state.layers);
      layers.delete(layerId);
      return {
        layers,
        activeLayerId: state.activeLayerId === layerId ? null : state.activeLayerId
      };
    });
    
    getEventBus().emit('layer.removed', { layerId });
  },
  
  setActiveLayer: (layerId) => {
    set({ activeLayerId: layerId });
    getEventBus().emit('layer.selected', { layerId });
  },
  
  getLayer: (layerId) => {
    return get().layers.get(layerId);
  },
  
  getLayersByVolumeId: (volumeId) => {
    const result: LayerEntry[] = [];
    for (const layer of get().layers.values()) {
      if ('Volume' in layer.spec && layer.spec.Volume.source_resource_id === volumeId) {
        result.push(layer);
      }
    }
    return result;
  }
}));

// Listen to events from services
const eventBus = getEventBus();

// Update GPU info when resources are ready
eventBus.on('layer.gpu.request.success', ({ layerId, gpuInfo }) => {
  layerStoreClean.getState().updateLayer(layerId, { 
    gpu: gpuInfo,
    isLoadingGpu: false,
    error: undefined
  });
});

// Update loading state
eventBus.on('layer.gpu.request.start', ({ layerId }) => {
  layerStoreClean.getState().updateLayer(layerId, { 
    isLoadingGpu: true,
    error: undefined
  });
});

// Handle errors
eventBus.on('layer.gpu.request.error', ({ layerId, error }) => {
  layerStoreClean.getState().updateLayer(layerId, { 
    error,
    isLoadingGpu: false
  });
});

// Handle layer addition requests from service
eventBus.on('layer.add.requested', ({ layerId, spec }) => {
  layerStoreClean.getState().addLayer(layerId, spec);
});

// Handle layer update requests from service
eventBus.on('layer.update.requested', ({ layerId, updates }) => {
  const layer = layerStoreClean.getState().getLayer(layerId);
  if (!layer) return;
  
  // Update the spec with the new values
  if ('Volume' in layer.spec) {
    const updatedSpec = {
      ...layer.spec,
      Volume: {
        ...layer.spec.Volume,
        ...updates
      }
    };
    
    layerStoreClean.getState().updateLayer(layerId, { spec: updatedSpec });
  }
});

// Handle active layer requests from service
eventBus.on('layer.setactive.requested', ({ layerId }) => {
  layerStoreClean.getState().setActiveLayer(layerId);
});
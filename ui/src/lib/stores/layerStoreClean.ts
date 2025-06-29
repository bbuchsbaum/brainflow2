/**
 * Clean Layer Store - Pure state management without business logic
 * Uses LayerService for all layer operations
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { LayerSpec, VolumeLayerGpuInfo } from '@brainflow/api';

export interface LayerEntry {
  id: string;
  spec: LayerSpec;
  gpu?: VolumeLayerGpuInfo;
  isLoadingGpu: boolean;
  error?: Error;
  visible: boolean;
  opacity: number;
  colormap: string;
  windowLevel: {
    window: number;
    level: number;
  };
  threshold?: {
    low: number;
    high: number;
    enabled: boolean;
  };
}

export interface LayerStoreState {
  // State
  layers: LayerEntry[];
  activeLayerId: string | null;
  soloLayerId: string | null;
  
  // Pure state mutations
  addLayer: (entry: LayerEntry) => void;
  removeLayer: (layerId: string) => void;
  updateLayer: (layerId: string, updates: Partial<LayerEntry>) => void;
  setActiveLayer: (layerId: string | null) => void;
  setSoloLayer: (layerId: string | null) => void;
  setLayerLoading: (layerId: string, loading: boolean) => void;
  setLayerGpu: (layerId: string, gpu: VolumeLayerGpuInfo) => void;
  setLayerError: (layerId: string, error: Error | undefined) => void;
  setLayerVisibility: (layerId: string, visible: boolean) => void;
  setLayerOpacity: (layerId: string, opacity: number) => void;
  setLayerColormap: (layerId: string, colormap: string) => void;
  setLayerWindowLevel: (layerId: string, window: number, level: number) => void;
  setLayerThreshold: (layerId: string, threshold: Partial<LayerEntry['threshold']>) => void;
  reorderLayers: (layerIds: string[]) => void;
  clearAll: () => void;
  
  // Computed getters
  getLayer: (layerId: string) => LayerEntry | undefined;
  getActiveLayer: () => LayerEntry | undefined;
  getVisibleLayers: () => LayerEntry[];
  hasLayers: () => boolean;
  isAnyLoading: () => boolean;
}

/**
 * Create clean layer store
 * All business logic is handled by LayerService
 */
export const useLayerStore = create<LayerStoreState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    layers: [],
    activeLayerId: null,
    soloLayerId: null,
    
    // Pure state mutations
    addLayer: (entry) => set((state) => ({
      layers: [...state.layers, entry],
      // Auto-set as active if it's the first layer
      activeLayerId: state.activeLayerId || entry.id
    })),
    
    removeLayer: (layerId) => set((state) => ({
      layers: state.layers.filter(l => l.id !== layerId),
      activeLayerId: state.activeLayerId === layerId ? null : state.activeLayerId,
      soloLayerId: state.soloLayerId === layerId ? null : state.soloLayerId
    })),
    
    updateLayer: (layerId, updates) => set((state) => ({
      layers: state.layers.map(layer =>
        layer.id === layerId ? { ...layer, ...updates } : layer
      )
    })),
    
    setActiveLayer: (layerId) => set({ activeLayerId: layerId }),
    
    setSoloLayer: (layerId) => set({ soloLayerId: layerId }),
    
    setLayerLoading: (layerId, loading) => set((state) => ({
      layers: state.layers.map(layer =>
        layer.id === layerId ? { ...layer, isLoadingGpu: loading } : layer
      )
    })),
    
    setLayerGpu: (layerId, gpu) => set((state) => ({
      layers: state.layers.map(layer =>
        layer.id === layerId ? { ...layer, gpu, error: undefined } : layer
      )
    })),
    
    setLayerError: (layerId, error) => set((state) => ({
      layers: state.layers.map(layer =>
        layer.id === layerId ? { ...layer, error } : layer
      )
    })),
    
    setLayerVisibility: (layerId, visible) => set((state) => ({
      layers: state.layers.map(layer =>
        layer.id === layerId ? { ...layer, visible } : layer
      )
    })),
    
    setLayerOpacity: (layerId, opacity) => set((state) => ({
      layers: state.layers.map(layer =>
        layer.id === layerId ? { ...layer, opacity } : layer
      )
    })),
    
    setLayerColormap: (layerId, colormap) => set((state) => ({
      layers: state.layers.map(layer =>
        layer.id === layerId ? { ...layer, colormap } : layer
      )
    })),
    
    setLayerWindowLevel: (layerId, window, level) => set((state) => ({
      layers: state.layers.map(layer =>
        layer.id === layerId 
          ? { ...layer, windowLevel: { window, level } }
          : layer
      )
    })),
    
    setLayerThreshold: (layerId, threshold) => set((state) => ({
      layers: state.layers.map(layer =>
        layer.id === layerId 
          ? { 
              ...layer, 
              threshold: layer.threshold 
                ? { ...layer.threshold, ...threshold }
                : { low: 0, high: 255, enabled: false, ...threshold }
            }
          : layer
      )
    })),
    
    reorderLayers: (layerIds) => set((state) => {
      const layerMap = new Map(state.layers.map(l => [l.id, l]));
      const reordered = layerIds
        .map(id => layerMap.get(id))
        .filter((layer): layer is LayerEntry => layer !== undefined);
      return { layers: reordered };
    }),
    
    clearAll: () => set({
      layers: [],
      activeLayerId: null,
      soloLayerId: null
    }),
    
    // Computed getters
    getLayer: (layerId) => {
      return get().layers.find(l => l.id === layerId);
    },
    
    getActiveLayer: () => {
      const state = get();
      return state.layers.find(l => l.id === state.activeLayerId);
    },
    
    getVisibleLayers: () => {
      const state = get();
      if (state.soloLayerId) {
        // In solo mode, only the solo layer is visible
        const soloLayer = state.layers.find(l => l.id === state.soloLayerId);
        return soloLayer ? [soloLayer] : [];
      }
      return state.layers.filter(l => l.visible);
    },
    
    hasLayers: () => {
      return get().layers.length > 0;
    },
    
    isAnyLoading: () => {
      return get().layers.some(l => l.isLoadingGpu);
    }
  }))
);

// Selectors for common use cases
export const layerStoreSelectors = {
  // Get layers with GPU resources ready
  layersWithGpu: (state: LayerStoreState) => {
    return state.layers.filter(l => l.gpu !== undefined);
  },
  
  // Get loading layers
  loadingLayers: (state: LayerStoreState) => {
    return state.layers.filter(l => l.isLoadingGpu);
  },
  
  // Get layers with errors
  errorLayers: (state: LayerStoreState) => {
    return state.layers.filter(l => l.error !== undefined);
  },
  
  // Check if layer is effectively visible
  isLayerVisible: (layerId: string) => (state: LayerStoreState) => {
    if (state.soloLayerId) {
      return state.soloLayerId === layerId;
    }
    const layer = state.layers.find(l => l.id === layerId);
    return layer?.visible || false;
  },
  
  // Get layer index
  getLayerIndex: (layerId: string) => (state: LayerStoreState) => {
    return state.layers.findIndex(l => l.id === layerId);
  },
  
  // Get layer count
  layerCount: (state: LayerStoreState) => state.layers.length,
  
  // Check if in solo mode
  isInSoloMode: (state: LayerStoreState) => state.soloLayerId !== null
};
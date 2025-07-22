/**
 * Layer Store - Manages layer state with Zustand
 * Handles layer CRUD operations, ordering, and rendering properties
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { enableMapSet } from 'immer';
import type { Layer, LayerRender } from '@/types/layers';
import type { DataRange } from '@brainflow/api';
import { getEventBus } from '@/events/EventBus';

// Enable Map and Set support in Immer
enableMapSet();

// Volume metadata
export interface VolumeMetadata {
  dataRange?: DataRange;
  centerWorld?: [number, number, number];
  isBinaryLike?: boolean;
  worldBounds?: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

// Declare global interface for store
declare global {
  interface Window {
    __layerStore?: any;
  }
}

export interface LayerState {
  // Core state
  layers: Layer[];
  selectedLayerId: string | null;
  
  // Layer render properties (stored separately for efficient updates)
  layerRender: Map<string, LayerRender>;
  
  // Volume metadata (for intensity windowing and centering)
  layerMetadata: Map<string, VolumeMetadata>;
  
  // Loading and error state
  loadingLayers: Set<string>;
  errorLayers: Map<string, Error>;
  
  // Actions
  addLayer: (layer: Layer, render?: LayerRender) => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<Layer>) => void;
  reorderLayers: (layers: Layer[]) => void;
  clearLayers: () => void;
  
  // Selection
  selectLayer: (id: string | null) => void;
  
  // Render properties
  setLayerRender: (id: string, render: LayerRender) => void;
  updateLayerRender: (id: string, updates: Partial<LayerRender>) => void;
  
  // Metadata
  setLayerMetadata: (id: string, metadata: VolumeMetadata) => void;
  
  // Loading and error state
  setLayerLoading: (id: string, loading: boolean) => void;
  setLayerError: (id: string, error: Error | null) => void;
  
  // Queries
  getLayer: (id: string) => Layer | undefined;
  getLayerRender: (id: string) => LayerRender | undefined;
  getLayerMetadata: (id: string) => VolumeMetadata | undefined;
  getVisibleLayers: () => Layer[];
  getLayersByType: (type: Layer['type']) => Layer[];
}

// Default render properties
const createDefaultRender = (dataRange?: { min: number; max: number }): LayerRender => {
  // Use 20-80% of the range for better default contrast
  let intensity: [number, number];
  if (dataRange) {
    const range = dataRange.max - dataRange.min;
    intensity = [
      dataRange.min + (range * 0.20),
      dataRange.min + (range * 0.80)
    ];
  } else {
    intensity = [0, 100];
  }
  
  return {
    opacity: 1.0,
    intensity,
    threshold: [0, 0],  // Disabled by default - pixels opaque if x < 0 OR x > 0, so nothing is thresholded
    colormap: 'gray',
    interpolation: 'linear',
  };
};

// Create store only once and attach to window for cross-root sharing
const createLayerStore = () => create<LayerState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      // Initial state
      layers: [],
      selectedLayerId: null,
      layerRender: new Map(),
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
      
      // Actions
      addLayer: (layer, render) => {
        const timestamp = performance.now();
        console.log(`[layerStore ${timestamp.toFixed(0)}ms] addLayer called with:`);
        console.log(`  - layer:`, JSON.stringify(layer));
        console.log(`  - render:`, render ? JSON.stringify(render) : 'undefined');
        console.log(`  - Stack trace:`, new Error().stack);
        
        const stateBefore = get().layers.length;
        
        set((state) => {
          state.layers.push(layer);
          // Use provided render properties or create defaults
          if (render) {
            console.log(`[layerStore] Using provided render properties for layer ${layer.id}`);
            state.layerRender.set(layer.id, render);
          } else {
            console.log(`[layerStore] Creating default render properties for layer ${layer.id}`);
            // Get metadata if available for data range
            const metadata = state.layerMetadata.get(layer.id);
            state.layerRender.set(layer.id, createDefaultRender(metadata?.dataRange));
          }
          
          // Auto-select first layer if none selected
          if (state.selectedLayerId === null && state.layers.length === 1) {
            console.log(`[layerStore] Auto-selecting first layer: ${layer.id}`);
            state.selectedLayerId = layer.id;
          }
        });
        
        const stateAfter = get().layers.length;
        console.log(`[layerStore ${performance.now() - timestamp}ms] Layer added. Count: ${stateBefore} -> ${stateAfter}`);
        console.log(`[layerStore] Current layers:`, get().layers.map(l => ({ id: l.id, name: l.name })));
        
        // Don't emit here - LayerService emits the event after successful backend operation
        // This prevents duplicate events
        console.log(`[layerStore] NOT emitting layer.added event - LayerService will emit it`);
      },
      
      removeLayer: (id) => {
        const layer = get().layers.find(l => l.id === id);
        if (!layer) return;
        
        set((state) => {
          state.layers = state.layers.filter(l => l.id !== id);
          state.layerRender.delete(id);
          state.layerMetadata.delete(id);
          state.loadingLayers.delete(id);
          state.errorLayers.delete(id);
          
          if (state.selectedLayerId === id) {
            state.selectedLayerId = null;
          }
        });
        
        const eventBus = getEventBus();
        eventBus.emit('layer.removed', { layerId: id });
      },
      
      updateLayer: (id, updates) => {
        set((state) => {
          const layer = state.layers.find(l => l.id === id);
          if (layer) {
            Object.assign(layer, updates);
          }
        });
        
        // Emit specific events for certain updates
        if ('visible' in updates) {
          const eventBus = getEventBus();
          eventBus.emit('layer.visibility', { 
            layerId: id, 
            visible: updates.visible! 
          });
        }
      },
      
      reorderLayers: (layers) => {
        set((state) => {
          state.layers = layers.map((layer, index) => ({
            ...layer,
            order: index
          }));
        });
        
        const eventBus = getEventBus();
        eventBus.emit('layer.reordered', { layerIds: layers.map(l => l.id) });
      },
      
      clearLayers: () => {
        set((state) => {
          state.layers = [];
          state.selectedLayerId = null;
          state.layerRender.clear();
          state.layerMetadata.clear();
          state.loadingLayers.clear();
          state.errorLayers.clear();
        });
        
        const eventBus = getEventBus();
        eventBus.emit('layer.cleared', {});
      },
      
      // Selection
      selectLayer: (id) => {
        set((state) => {
          state.selectedLayerId = id;
        });
      },
      
      // Render properties
      setLayerRender: (id, render) => {
        // DEBUG: Track who's setting default intensity values
        if (render.intensity && 
            (render.intensity[0] === 1969.6 || 
             render.intensity[0] === 1970 ||
             (render.intensity[0] > 1969 && render.intensity[0] < 1971))) {
          console.error('[layerStore] setLayerRender called with default intensity!', {
            id,
            intensity: render.intensity,
            stack: new Error().stack
          });
        }
        
        set((state) => {
          state.layerRender.set(id, render);
        });
      },
      
      updateLayerRender: (id, updates) => {
        // DEBUG: Track who's updating to default intensity values
        if (updates.intensity && 
            (updates.intensity[0] === 1969.6 || 
             updates.intensity[0] === 1970 ||
             (updates.intensity[0] > 1969 && updates.intensity[0] < 1971))) {
          console.error('[layerStore] updateLayerRender called with default intensity!', {
            id,
            intensity: updates.intensity,
            stack: new Error().stack
          });
        }
        
        set((state) => {
          const currentRender = state.layerRender.get(id);
          if (currentRender) {
            const newRender = { ...currentRender, ...updates };
            state.layerRender.set(id, newRender);
          }
        });
        
        // Don't emit layer.patched here - this causes infinite loops
        // The LayerService will emit the event after successful backend update
      },
      
      // Metadata
      setLayerMetadata: (id, metadata) => {
        set((state) => {
          state.layerMetadata.set(id, metadata);
        });
        
        const eventBus = getEventBus();
        eventBus.emit('layer.metadata.updated', { layerId: id, metadata });
      },
      
      // Loading and error state
      setLayerLoading: (id, loading) => {
        set((state) => {
          if (loading) {
            state.loadingLayers.add(id);
          } else {
            state.loadingLayers.delete(id);
          }
        });
        // Don't emit here - this causes infinite loop when called from event handler
      },
      
      setLayerError: (id, error) => {
        set((state) => {
          if (error) {
            state.errorLayers.set(id, error);
          } else {
            state.errorLayers.delete(id);
          }
        });
        // Don't emit here - this causes infinite loop when called from event handler
      },
      
      // Queries
      getLayer: (id) => {
        return get().layers.find(l => l.id === id);
      },
      
      getLayerRender: (id) => {
        return get().layerRender.get(id);
      },
      
      getLayerMetadata: (id) => {
        return get().layerMetadata.get(id);
      },
      
      getVisibleLayers: () => {
        return get().layers.filter(layer => layer.visible);
      },
      
      getLayersByType: (type) => {
        return get().layers.filter(layer => layer.type === type);
      },
    }))
  )
);

// Export store with global instance sharing
export const useLayerStore = (() => {
  if (typeof window !== 'undefined' && window.__layerStore) {
    return window.__layerStore;
  }
  
  const store = createLayerStore();
  
  if (typeof window !== 'undefined') {
    window.__layerStore = store;
  }
  
  return store;
})();

// Subscribe to layer service events to keep store in sync
const eventBus = getEventBus();

eventBus.on('layer.added', ({ layer }) => {
  // Layer service handles the actual addition, store just reflects the state
});

eventBus.on('layer.removed', ({ layerId }) => {
  // Layer service handles the actual removal, store just reflects the state
});

// Removed layer.patched listener to prevent infinite loop
// The component updates the store directly via updateLayerRender,
// and the LayerService emits the event after backend update

// Removed to prevent infinite loop - LayerService already manages loading state

eventBus.on('layer.error', ({ layerId, error }) => {
  useLayerStore.getState().setLayerError(layerId, error);
});
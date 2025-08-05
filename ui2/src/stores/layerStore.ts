/**
 * Layer Store - Manages layer state with Zustand
 * Handles layer CRUD operations, ordering, and rendering properties
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { enableMapSet } from 'immer';
import type { Layer } from '@/types/layers';
import type { DataRange } from '@brainflow/api';
import { getEventBus } from '@/events/EventBus';

// Enable Map and Set support in Immer
enableMapSet();

// Volume metadata
export interface VolumeMetadata {
  // Existing fields
  dataRange?: DataRange;
  centerWorld?: [number, number, number];
  isBinaryLike?: boolean;
  worldBounds?: {
    min: [number, number, number];
    max: [number, number, number];
  };
  
  // New fields for comprehensive metadata
  dimensions?: [number, number, number];     // Volume dimensions in voxels
  spacing?: [number, number, number];         // Voxel spacing in mm
  origin?: [number, number, number];          // Volume origin in world space
  dataType?: string;                          // Data type (e.g., "Float32", "Int16")
  voxelToWorld?: number[];                    // 4x4 transformation matrix (flat array)
  worldToVoxel?: number[];                    // 4x4 inverse transformation matrix
  filePath?: string;                          // Source file path
  fileFormat?: string;                        // File format (e.g., "NIfTI", "DICOM")
  totalVoxels?: number;                       // Total number of voxels
  nonZeroVoxels?: number;                     // Number of non-zero voxels
  orientation?: string;                       // Orientation string (e.g., "RAS+")
  units?: string;                             // Spatial units (e.g., "millimeters")
}

// Declare global interface for store
declare global {
  interface Window {
    __layerStore?: any;
  }
}

// Extended layer info that includes volume metadata
export interface LayerInfo extends Layer {
  volumeType?: 'Volume3D' | 'TimeSeries4D';
  timeSeriesInfo?: {
    num_timepoints: number;
    tr: number | null;
    temporal_unit: string | null;
    acquisition_time: number | null;
  };
  currentTimepoint?: number;
}

export interface LayerState {
  // Core state
  layers: LayerInfo[]; // Changed from Layer[] to LayerInfo[]
  selectedLayerId: string | null;
  
  // NOTE: Layer render properties have been moved to ViewState
  
  // Volume metadata (for intensity windowing and centering)
  layerMetadata: Map<string, VolumeMetadata>;
  
  // Loading and error state
  loadingLayers: Set<string>;
  errorLayers: Map<string, Error>;
  
  // Actions
  addLayer: (layer: LayerInfo) => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<LayerInfo>) => void;
  reorderLayers: (layers: LayerInfo[]) => void;
  clearLayers: () => void;
  
  // Selection
  selectLayer: (id: string | null) => void;
  
  // NOTE: Render properties have been moved to ViewState
  
  // Metadata
  setLayerMetadata: (id: string, metadata: VolumeMetadata) => void;
  
  // Loading and error state
  setLayerLoading: (id: string, loading: boolean) => void;
  setLayerError: (id: string, error: Error | null) => void;
  
  // Queries
  getLayer: (id: string) => Layer | undefined;
  getLayerMetadata: (id: string) => VolumeMetadata | undefined;
  getVisibleLayers: () => Layer[];
  getLayersByType: (type: Layer['type']) => Layer[];
  
  // State validation and repair
  validateState: () => string[];
  repairState: () => void;
}

// NOTE: Default render properties creation moved to ViewState/StoreSyncService

// Create store only once and attach to window for cross-root sharing
const createLayerStore = () => create<LayerState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      // Initial state
      layers: [],
      selectedLayerId: null,
      // NOTE: layerRender has been moved to ViewState
      layerMetadata: new Map(),
      loadingLayers: new Set(),
      errorLayers: new Map(),
      
      // Actions
      addLayer: (layer) => {
        const timestamp = performance.now();
        console.log(`[layerStore ${timestamp.toFixed(0)}ms] addLayer called with:`);
        console.log(`  - layer:`, JSON.stringify(layer));
        console.log(`  - Stack trace:`, new Error().stack);
        
        const stateBefore = get().layers.length;
        
        set((state) => {
          state.layers.push(layer);
          // NOTE: Render properties are now managed in ViewState
          
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
          // NOTE: Render properties are removed from ViewState via StoreSyncService
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
            
            // NOTE: Visibility is now managed through ViewState opacity
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
          // NOTE: Render properties cleared in ViewState via StoreSyncService
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
      
      // NOTE: Render properties have been moved to ViewState
      
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
      
      // NOTE: getLayerRender has been moved to ViewState
      
      getLayerMetadata: (id) => {
        return get().layerMetadata.get(id);
      },
      
      getVisibleLayers: () => {
        // NOTE: Visibility is now determined by ViewState opacity
        // This method returns all layers - filter by ViewState in components
        return get().layers;
      },
      
      getLayersByType: (type) => {
        return get().layers.filter(layer => layer.type === type);
      },
      
      // State validation
      validateState: () => {
        const state = get();
        const issues: string[] = [];
        
        // NOTE: Render properties validation moved to ViewState
        
        // Check for orphaned metadata
        state.layerMetadata.forEach((_, layerId) => {
          if (!state.layers.find(l => l.id === layerId)) {
            issues.push(`Orphaned metadata for layer ${layerId}`);
          }
        });
        
        // Check for orphaned loading states
        state.loadingLayers.forEach((layerId) => {
          if (!state.layers.find(l => l.id === layerId)) {
            issues.push(`Orphaned loading state for layer ${layerId}`);
          }
        });
        
        // Check for orphaned error states
        state.errorLayers.forEach((_, layerId) => {
          if (!state.layers.find(l => l.id === layerId)) {
            issues.push(`Orphaned error state for layer ${layerId}`);
          }
        });
        
        if (issues.length > 0) {
          console.warn('[LayerStore] State validation issues:', issues);
        }
        
        return issues;
      },
      
      // State repair
      repairState: () => {
        console.log('[LayerStore] Repairing state...');
        
        set((state) => {
          // NOTE: Render properties cleanup moved to ViewState
          
          // Remove orphaned metadata
          const metadataIdsToRemove: string[] = [];
          state.layerMetadata.forEach((_, layerId) => {
            if (!state.layers.find(l => l.id === layerId)) {
              metadataIdsToRemove.push(layerId);
            }
          });
          metadataIdsToRemove.forEach(id => state.layerMetadata.delete(id));
          
          // Remove orphaned loading states
          const loadingIdsToRemove: string[] = [];
          state.loadingLayers.forEach((layerId) => {
            if (!state.layers.find(l => l.id === layerId)) {
              loadingIdsToRemove.push(layerId);
            }
          });
          loadingIdsToRemove.forEach(id => state.loadingLayers.delete(id));
          
          // Remove orphaned error states
          const errorIdsToRemove: string[] = [];
          state.errorLayers.forEach((_, layerId) => {
            if (!state.layers.find(l => l.id === layerId)) {
              errorIdsToRemove.push(layerId);
            }
          });
          errorIdsToRemove.forEach(id => state.errorLayers.delete(id));
          
          // NOTE: Render properties initialization moved to ViewState
          
          // Validate selected layer ID
          if (state.selectedLayerId && !state.layers.find(l => l.id === state.selectedLayerId)) {
            console.log(`[LayerStore] Clearing invalid selected layer ID: ${state.selectedLayerId}`);
            state.selectedLayerId = null;
          }
        });
        
        console.log('[LayerStore] State repair completed');
      },

      // NOTE: Computed visible property moved to ViewState
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

// Typed selectors to prevent property name errors
export const layerSelectors = {
  // Basic selectors
  layers: (state: LayerState) => state.layers,
  selectedLayerId: (state: LayerState) => state.selectedLayerId,
  layerMetadata: (state: LayerState) => state.layerMetadata,
  // NOTE: layerRender selector moved to ViewState
  loadingLayers: (state: LayerState) => state.loadingLayers,
  errorLayers: (state: LayerState) => state.errorLayers,
  
  // Computed selectors
  getLayerById: (state: LayerState, id: string) => 
    state.layers.find(l => l.id === id),
  
  getLayerMetadata: (state: LayerState, id: string) => 
    state.layerMetadata.get(id),
  
  // NOTE: getLayerRender selector moved to ViewState
  
  getSelectedLayer: (state: LayerState) => 
    state.selectedLayerId ? state.layers.find(l => l.id === state.selectedLayerId) : null,
  
  getSelectedLayerMetadata: (state: LayerState) => 
    state.selectedLayerId ? state.layerMetadata.get(state.selectedLayerId) : null,
  
  // NOTE: getSelectedLayerRender selector moved to ViewState
  
  isLayerLoading: (state: LayerState, id: string) => 
    state.loadingLayers.has(id),
  
  getLayerError: (state: LayerState, id: string) => 
    state.errorLayers.get(id),
  
  getVisibleLayers: (state: LayerState) => 
    // NOTE: Visibility is determined by ViewState opacity
    state.layers,
  
  getLayersByType: (state: LayerState, type: Layer['type']) => 
    state.layers.filter(layer => layer.type === type),
  
  hasLayers: (state: LayerState) => 
    state.layers.length > 0,
};

// Custom hook that enforces selector usage
export const useLayer = <T>(selector: (state: LayerState) => T): T => {
  return useLayerStore(selector);
};

// Export specific selector hooks for common use cases
export const useLayers = () => useLayer(layerSelectors.layers);
export const useSelectedLayerId = () => useLayer(layerSelectors.selectedLayerId);
export const useSelectedLayer = () => useLayer(layerSelectors.getSelectedLayer);
export const useLayerMetadata = (id: string) => useLayer(state => layerSelectors.getLayerMetadata(state, id));
export const useLayerRender = (id: string) => useLayer(state => layerSelectors.getLayerRender(state, id));
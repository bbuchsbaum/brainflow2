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
  
  // Layer render properties (stored separately for efficient updates)
  layerRender: Map<string, LayerRender>;
  
  // Volume metadata (for intensity windowing and centering)
  layerMetadata: Map<string, VolumeMetadata>;
  
  // Loading and error state
  loadingLayers: Set<string>;
  errorLayers: Map<string, Error>;
  
  // Actions
  addLayer: (layer: LayerInfo, render?: LayerRender) => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, updates: Partial<LayerInfo>) => void;
  reorderLayers: (layers: LayerInfo[]) => void;
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
  
  // State validation and repair
  validateState: () => string[];
  repairState: () => void;
}

// Default render properties
const createDefaultRender = (dataRange?: { min: number; max: number }): LayerRender => {
  // Use 20-80% of the range for better default contrast
  let intensity: [number, number];
  if (dataRange) {
    const range = dataRange.max - dataRange.min;
    const precision = 100; // Round to 2 decimal places for better precision
    intensity = [
      Math.round((dataRange.min + (range * 0.20)) * precision) / precision,
      Math.round((dataRange.min + (range * 0.80)) * precision) / precision
    ];
  } else {
    intensity = [0, 100];
  }
  
  return {
    opacity: 1.0,
    intensity,
    threshold: dataRange 
      ? [dataRange.min + (dataRange.max - dataRange.min) / 2, dataRange.min + (dataRange.max - dataRange.min) / 2]  // Midpoint by default
      : [5000, 5000],  // Midpoint of default range
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
            
            // SINGLE SOURCE OF TRUTH: If visible is being updated, sync it with opacity
            if ('visible' in updates) {
              const render = state.layerRender.get(id);
              if (render) {
                render.opacity = updates.visible ? 1.0 : 0.0;
              }
            }
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
            // CRITICAL FIX: Deep equality check to prevent circular updates
            // This breaks the StoreSyncService feedback loop
            const newRender = { ...currentRender, ...updates };
            
            // Check if any values actually changed
            let hasChanges = false;
            for (const [key, value] of Object.entries(updates)) {
              const currentValue = currentRender[key as keyof LayerRender];
              
              // Handle array comparisons (intensity, threshold)
              if (Array.isArray(value) && Array.isArray(currentValue)) {
                if (value.length !== currentValue.length || 
                    !value.every((v, i) => v === currentValue[i])) {
                  hasChanges = true;
                  break;
                }
              } else if (value !== currentValue) {
                hasChanges = true;
                break;
              }
            }
            
            if (hasChanges) {
              console.log(`[layerStore] updateLayerRender: Changes detected for ${id}, updating store`);
              state.layerRender.set(id, newRender);
            } else {
              console.log(`[layerStore] updateLayerRender: No changes detected for ${id}, skipping update to prevent circular loop`);
            }
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
        const state = get();
        const layer = state.layers.find(l => l.id === id);
        if (layer) {
          // Ensure visible property is derived from opacity (single source of truth)
          const render = state.layerRender.get(id);
          return {
            ...layer,
            visible: render ? render.opacity > 0 : layer.visible
          };
        }
        return layer;
      },
      
      getLayerRender: (id) => {
        return get().layerRender.get(id);
      },
      
      getLayerMetadata: (id) => {
        return get().layerMetadata.get(id);
      },
      
      getVisibleLayers: () => {
        const state = get();
        return state.layers.filter(layer => {
          const render = state.layerRender.get(layer.id);
          // Layer is visible if opacity > 0 (single source of truth)
          return render && render.opacity > 0;
        });
      },
      
      getLayersByType: (type) => {
        return get().layers.filter(layer => layer.type === type);
      },
      
      // State validation
      validateState: () => {
        const state = get();
        const issues: string[] = [];
        
        // Check for orphaned render properties
        state.layerRender.forEach((_, layerId) => {
          if (!state.layers.find(l => l.id === layerId)) {
            issues.push(`Orphaned render properties for layer ${layerId}`);
          }
        });
        
        // Check for missing render properties
        state.layers.forEach(layer => {
          if (!state.layerRender.has(layer.id)) {
            issues.push(`Missing render properties for layer ${layer.id}`);
          }
        });
        
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
          // Remove orphaned render properties
          const renderIdsToRemove: string[] = [];
          state.layerRender.forEach((_, layerId) => {
            if (!state.layers.find(l => l.id === layerId)) {
              renderIdsToRemove.push(layerId);
            }
          });
          renderIdsToRemove.forEach(id => state.layerRender.delete(id));
          
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
          
          // Add missing render properties
          state.layers.forEach(layer => {
            if (!state.layerRender.has(layer.id)) {
              const metadata = state.layerMetadata.get(layer.id);
              state.layerRender.set(layer.id, createDefaultRender(metadata?.dataRange));
              console.log(`[LayerStore] Added missing render properties for layer ${layer.id}`);
            }
          });
          
          // Validate selected layer ID
          if (state.selectedLayerId && !state.layers.find(l => l.id === state.selectedLayerId)) {
            console.log(`[LayerStore] Clearing invalid selected layer ID: ${state.selectedLayerId}`);
            state.selectedLayerId = null;
          }
        });
        
        console.log('[LayerStore] State repair completed');
      },

      // Helper to get layers with computed visible property from opacity
      getLayersWithComputedVisible: () => {
        const state = get();
        return state.layers.map(layer => {
          const render = state.layerRender.get(layer.id);
          return {
            ...layer,
            visible: render ? render.opacity > 0 : layer.visible
          };
        });
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

// Typed selectors to prevent property name errors
export const layerSelectors = {
  // Basic selectors
  layers: (state: LayerState) => state.layers,
  selectedLayerId: (state: LayerState) => state.selectedLayerId,
  layerMetadata: (state: LayerState) => state.layerMetadata,
  layerRender: (state: LayerState) => state.layerRender,
  loadingLayers: (state: LayerState) => state.loadingLayers,
  errorLayers: (state: LayerState) => state.errorLayers,
  
  // Computed selectors
  getLayerById: (state: LayerState, id: string) => 
    state.layers.find(l => l.id === id),
  
  getLayerMetadata: (state: LayerState, id: string) => 
    state.layerMetadata.get(id),
  
  getLayerRender: (state: LayerState, id: string) => 
    state.layerRender.get(id),
  
  getSelectedLayer: (state: LayerState) => 
    state.selectedLayerId ? state.layers.find(l => l.id === state.selectedLayerId) : null,
  
  getSelectedLayerMetadata: (state: LayerState) => 
    state.selectedLayerId ? state.layerMetadata.get(state.selectedLayerId) : null,
  
  getSelectedLayerRender: (state: LayerState) => 
    state.selectedLayerId ? state.layerRender.get(state.selectedLayerId) : null,
  
  isLayerLoading: (state: LayerState, id: string) => 
    state.loadingLayers.has(id),
  
  getLayerError: (state: LayerState, id: string) => 
    state.errorLayers.get(id),
  
  getVisibleLayers: (state: LayerState) => 
    state.layers.filter(layer => {
      const render = state.layerRender.get(layer.id);
      return render && render.opacity > 0;
    }),
  
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
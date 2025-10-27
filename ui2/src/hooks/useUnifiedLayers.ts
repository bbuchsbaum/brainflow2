/**
 * useUnifiedLayers Hook
 * 
 * Provides React components with unified access to both volume and surface layers
 * through the UnifiedLayerService facade. Automatically subscribes to store changes
 * and provides filtered accessors for different layer types.
 * 
 * @module useUnifiedLayers
 * @see {@link file://./../../docs/FACADE_PATTERN.md} for usage examples
 * 
 * Part of the Facade Pattern implementation (2025-01-09)
 * 
 * @example
 * // Basic usage
 * function LayerPanel() {
 *   const { allLayers, toggleVisibility } = useUnifiedLayers();
 *   
 *   return (
 *     <div>
 *       {allLayers.map(layer => (
 *         <LayerRow 
 *           key={layer.id} 
 *           layer={layer}
 *           onToggle={() => toggleVisibility(layer.id)}
 *         />
 *       ))}
 *     </div>
 *   );
 * }
 * 
 * @example
 * // Filter specific layer types
 * function VolumeOnlyPanel() {
 *   const { volumeLayers, updateLayer } = useUnifiedLayers();
 *   // Work only with volume layers
 * }
 */

import { useMemo, useCallback } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { 
  UnifiedLayerService, 
  unifiedLayerService,
  type ManagedLayer,
  isVolumeLayer,
  isSurfaceLayer,
  isVol2SurfLayer
} from '@/services/UnifiedLayerService';

// Re-export type guards for convenience
export { isVolumeLayer, isSurfaceLayer, isVol2SurfLayer, type ManagedLayer };

/**
 * Return type for the useUnifiedLayers hook
 */
export interface UnifiedLayersResult {
  // All layers combined
  allLayers: ManagedLayer[];
  
  // Filtered layer lists
  volumeLayers: ManagedLayer[];
  surfaceLayers: ManagedLayer[];
  vol2surfLayers: ManagedLayer[];
  
  // Layer operations
  getLayerById: (id: string) => ManagedLayer | undefined;
  updateLayer: (id: string, property: string, value: any) => void;
  toggleVisibility: (id: string) => void;
  removeLayer: (id: string) => void;
  
  // Vol2surf operations
  createVol2Surf: (volumeId: string, surfaceId: string) => Promise<string | null>;
  availableVolumesForMapping: ManagedLayer[];
  availableSurfacesForMapping: ManagedLayer[];
  
  // Selection state (if applicable)
  selectedLayerId: string | null;
  selectLayer: (id: string | null) => void;
}

/**
 * Hook that provides unified access to all layer types
 */
export function useUnifiedLayers(): UnifiedLayersResult {
  // Subscribe to both stores for reactivity
  const volumeLayers = useLayerStore(state => state.layers);
  const surfaces = useSurfaceStore(state => state.surfaces);
  const selectedLayerId = useLayerStore(state => state.selectedLayerId);
  const selectLayerInStore = useLayerStore(state => state.selectLayer);
  
  // Get all layers whenever either store changes
  const allLayers = useMemo(() => {
    return unifiedLayerService.getAllLayers();
  }, [volumeLayers, surfaces]);
  
  // Filtered layer lists
  const volumeLayersList = useMemo(() => 
    allLayers.filter(isVolumeLayer),
    [allLayers]
  );
  
  const surfaceLayersList = useMemo(() => 
    allLayers.filter(isSurfaceLayer),
    [allLayers]
  );
  
  const vol2surfLayersList = useMemo(() => 
    allLayers.filter(isVol2SurfLayer),
    [allLayers]
  );
  
  // Available layers for mapping
  const availableVolumesForMapping = useMemo(() => 
    volumeLayersList.filter(layer => layer.visible),
    [volumeLayersList]
  );
  
  const availableSurfacesForMapping = useMemo(() => 
    surfaceLayersList.filter(layer => !layer.sourceVolumeId),
    [surfaceLayersList]
  );
  
  // Layer operations wrapped in useCallback for stability
  const getLayerById = useCallback((id: string) => {
    return allLayers.find(layer => layer.id === id);
  }, [allLayers]);
  
  const updateLayer = useCallback((id: string, property: string, value: any) => {
    unifiedLayerService.updateLayerProperty(id, property, value);
  }, []);
  
  const toggleVisibility = useCallback((id: string) => {
    unifiedLayerService.toggleLayerVisibility(id);
  }, []);
  
  const removeLayer = useCallback((id: string) => {
    unifiedLayerService.removeLayer(id);
  }, []);
  
  const createVol2Surf = useCallback(async (volumeId: string, surfaceId: string) => {
    return await unifiedLayerService.createVol2SurfMapping(volumeId, surfaceId);
  }, []);
  
  // Selection handling
  const selectLayer = useCallback((id: string | null) => {
    if (!id) {
      selectLayerInStore(null);
      return;
    }
    
    const layer = getLayerById(id);
    if (!layer) return;
    
    if (isVolumeLayer(layer)) {
      // For volumes, use the existing selection mechanism
      selectLayerInStore(id);
    } else {
      // For surfaces, we might want to handle differently
      // For now, clear volume selection when selecting a surface
      selectLayerInStore(null);
      // TODO: Add surface selection to surfaceStore if needed
      useSurfaceStore.getState().setActiveSurface(id);
    }
  }, [getLayerById, selectLayerInStore]);
  
  return {
    allLayers,
    volumeLayers: volumeLayersList,
    surfaceLayers: surfaceLayersList,
    vol2surfLayers: vol2surfLayersList,
    getLayerById,
    updateLayer,
    toggleVisibility,
    removeLayer,
    createVol2Surf,
    availableVolumesForMapping,
    availableSurfacesForMapping,
    selectedLayerId,
    selectLayer
  };
}

/**
 * Hook for components that only need volume layers
 */
export function useVolumeLayers() {
  const { volumeLayers, updateLayer, toggleVisibility, removeLayer } = useUnifiedLayers();
  return {
    layers: volumeLayers,
    updateLayer,
    toggleVisibility,
    removeLayer
  };
}

/**
 * Hook for components that only need surface layers
 */
export function useSurfaceLayers() {
  const { surfaceLayers, updateLayer, toggleVisibility, removeLayer } = useUnifiedLayers();
  return {
    layers: surfaceLayers,
    updateLayer,
    toggleVisibility,
    removeLayer
  };
}

/**
 * Hook for components that need vol2surf layers
 */
export function useVol2SurfLayers() {
  const { vol2surfLayers, updateLayer, createVol2Surf } = useUnifiedLayers();
  return {
    layers: vol2surfLayers,
    updateLayer,
    createMapping: createVol2Surf
  };
}

/**
 * Hook to get a specific layer by ID
 */
export function useLayerById(id: string): ManagedLayer | undefined {
  const { getLayerById } = useUnifiedLayers();
  return getLayerById(id);
}
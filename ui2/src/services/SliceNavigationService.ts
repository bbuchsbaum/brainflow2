/**
 * SliceNavigationService - Manages slice navigation in world space
 * Calculates appropriate bounds and step sizes based on volume metadata
 */

import type { ViewType } from '@/types/coordinates';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

export interface SliceRange {
  min: number;
  max: number;
  step: number;
  current: number;
}

export class SliceNavigationService {
  /**
   * Get the world space range for a given view type
   * Uses the bottom layer's voxel spacing as the step size
   */
  getSliceRange(viewType: ViewType): SliceRange {
    const layers = useLayerStore.getState().layers;
    const viewState = useViewStateStore.getState().viewState;
    
    if (layers.length === 0) {
      // Default range when no layers are loaded - use generic round numbers
      return {
        min: -100,
        max: 100,
        step: 1,
        current: 0
      };
    }
    
    // Get the bottom layer (first layer)
    const bottomLayer = layers[0];
    const layerMetadata = useLayerStore.getState().getLayerMetadata(bottomLayer.id);
    
    if (!layerMetadata || !layerMetadata.worldBounds) {
      // This might be a timing issue - log more details
      console.warn(`[SliceNavigationService] Layer ${bottomLayer.id} is missing worldBounds metadata`);
      console.warn(`[SliceNavigationService] Available metadata:`, layerMetadata);
      
      // Try to get data range as a fallback
      if (layerMetadata?.dataRange) {
        console.warn(`[SliceNavigationService] Using dataRange as fallback for missing worldBounds`);
        // Use a reasonable default based on typical brain imaging volumes
        return {
          min: -128,  // Typical brain volume extends ~128mm from center
          max: 128,
          step: 1,
          current: viewState.crosshair.world_mm[
            viewType === 'axial' ? 2 : viewType === 'sagittal' ? 0 : 1
          ]
        };
      }
      
      // Last resort fallback
      console.error(`[SliceNavigationService] No metadata available for layer ${bottomLayer.id}`);
      return {
        min: -100,
        max: 100,
        step: 1,
        current: 0
      };
    }
    
    // Use the actual world bounds from the volume
    const { min: worldMin, max: worldMax } = layerMetadata.worldBounds;
    let min: number, max: number, step: number, current: number;
    
    switch (viewType) {
      case 'axial':
        // Z axis (Inferior-Superior)
        min = worldMin[2];
        max = worldMax[2];
        step = 1;   // 1mm spacing (could be improved with voxel spacing info)
        current = viewState.crosshair.world_mm[2];
        break;
        
      case 'sagittal':
        // X axis (Left-Right)
        min = worldMin[0];
        max = worldMax[0];
        step = 1;   // 1mm spacing
        current = viewState.crosshair.world_mm[0];
        break;
        
      case 'coronal':
        // Y axis (Posterior-Anterior)
        min = worldMin[1];
        max = worldMax[1];
        step = 1;   // 1mm spacing
        current = viewState.crosshair.world_mm[1];
        break;
    }
    
    return { min, max, step, current };
  }
  
  /**
   * Update the crosshair position for a specific axis
   */
  updateSlicePosition(viewType: ViewType, worldPosition: number) {
    const currentCrosshair = useViewStateStore.getState().viewState.crosshair.world_mm;
    const newCrosshair: [number, number, number] = [...currentCrosshair];
    
    switch (viewType) {
      case 'axial':
        newCrosshair[2] = worldPosition; // Z axis
        break;
      case 'sagittal':
        newCrosshair[0] = worldPosition; // X axis
        break;
      case 'coronal':
        newCrosshair[1] = worldPosition; // Y axis
        break;
    }
    
    // Update the crosshair position with immediate flag for responsive slider
    useViewStateStore.getState().setCrosshair(newCrosshair, true, true);
  }
}

// Singleton instance
let sliceNavigationService: SliceNavigationService | null = null;

export function getSliceNavigationService(): SliceNavigationService {
  if (!sliceNavigationService) {
    sliceNavigationService = new SliceNavigationService();
  }
  return sliceNavigationService;
}
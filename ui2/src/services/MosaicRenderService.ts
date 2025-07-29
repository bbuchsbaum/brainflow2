/**
 * MosaicRenderService
 * 
 * Coordinates rendering of multiple slices for MosaicView using the event-driven architecture.
 * Instead of batch rendering, this service triggers individual renders with unique tags.
 */

import { getApiService } from '@/services/apiService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getEventBus } from '@/events/EventBus';
import type { ViewState } from '@/types/viewState';
import type { ViewPlane } from '@/types/coordinates';

export interface MosaicRenderRequest {
  sliceIndex: number;
  axis: 'axial' | 'sagittal' | 'coronal';
  cellId: string;
  width: number;
  height: number;
}

class MosaicRenderService {
  private apiService = getApiService();
  private eventBus = getEventBus();
  private activeRenders = new Map<string, MosaicRenderRequest>();
  
  /**
   * Render a single mosaic cell
   */
  async renderMosaicCell(request: MosaicRenderRequest): Promise<void> {
    const { sliceIndex, axis, cellId, width, height } = request;
    
    // Store active render
    this.activeRenders.set(cellId, request);
    
    try {
      // Emit render start event with tag
      this.eventBus.emit('render.start', { tag: cellId });
      
      // Get current view state
      const currentViewState = useViewStateStore.getState().viewState;
      
      // Create a modified view state for this specific slice WITH correct dimensions
      const modifiedViewState = await this.createSliceViewState(
        currentViewState,
        axis,
        sliceIndex,
        width,
        height
      );
      
      // Render using the normal pipeline with dimensions
      const imageBitmap = await this.apiService.applyAndRenderViewState(
        modifiedViewState,
        axis,
        width,
        height
      );
      
      if (imageBitmap) {
        // Emit render complete event with tag
        this.eventBus.emit('render.complete', {
          viewType: axis,
          imageBitmap,
          tag: cellId
        });
      } else {
        throw new Error('No image returned from backend');
      }
    } catch (error) {
      // Emit render error event with tag
      this.eventBus.emit('render.error', {
        viewType: axis,
        error: error instanceof Error ? error : new Error(String(error)),
        tag: cellId
      });
    } finally {
      this.activeRenders.delete(cellId);
    }
  }
  
  /**
   * Render multiple mosaic cells
   */
  async renderMosaicGrid(requests: MosaicRenderRequest[]): Promise<void> {
    // Render cells in parallel for better performance
    const renderPromises = requests.map(request => 
      this.renderMosaicCell(request)
    );
    
    await Promise.all(renderPromises);
  }
  
  /**
   * Cancel active renders for given cell IDs
   */
  cancelRenders(cellIds: string[]): void {
    for (const cellId of cellIds) {
      this.activeRenders.delete(cellId);
    }
  }
  
  /**
   * Calculate natural dimensions for a view based on anatomical extent
   * This respects the volume's aspect ratio instead of forcing square dimensions
   */
  private async getNaturalDimensions(
    volumeId: string,
    axis: 'axial' | 'sagittal' | 'coronal',
    maxSize: number
  ): Promise<[number, number]> {
    // Check cache first
    const cacheKey = volumeId;
    if (!this.viewCache.has(cacheKey)) {
      // Get initial views from backend which properly calculates dimensions
      const views = await this.apiService.getInitialViews(volumeId, [maxSize, maxSize]);
      this.viewCache.set(cacheKey, views);
    }
    
    const views = this.viewCache.get(cacheKey)!;
    const view = views[axis];
    
    if (view && view.dim_px) {
      return view.dim_px;
    }
    
    // Fallback to square if something goes wrong
    return [maxSize, maxSize];
  }
  
  /**
   * Create a modified ViewState for a specific slice
   */
  private async createSliceViewState(
    baseViewState: ViewState,
    axis: 'axial' | 'sagittal' | 'coronal',
    sliceIndex: number,
    width: number,
    height: number
  ): Promise<ViewState> {
    // Get all visible layers to calculate combined bounds
    const visibleLayers = baseViewState.layers.filter(l => l.visible && l.opacity > 0);
    if (visibleLayers.length === 0) {
      return baseViewState;
    }
    
    // Clone the view state
    const modifiedViewState: ViewState = {
      ...baseViewState,
      views: { ...baseViewState.views }
    };
    
    // Get the base view plane for the requested axis
    const baseViewPlane = baseViewState.views[axis];
    if (!baseViewPlane) {
      return baseViewState;
    }
    
    // Calculate the normal vector (cross product of u and v)
    const normal = [
      baseViewPlane.u_mm[1] * baseViewPlane.v_mm[2] - baseViewPlane.u_mm[2] * baseViewPlane.v_mm[1],
      baseViewPlane.u_mm[2] * baseViewPlane.v_mm[0] - baseViewPlane.u_mm[0] * baseViewPlane.v_mm[2],
      baseViewPlane.u_mm[0] * baseViewPlane.v_mm[1] - baseViewPlane.u_mm[1] * baseViewPlane.v_mm[0]
    ];
    
    // Normalize
    const mag = Math.sqrt(normal[0]**2 + normal[1]**2 + normal[2]**2);
    const normalizedNormal = [
      normal[0] / mag,
      normal[1] / mag,
      normal[2] / mag
    ];
    
    // Calculate combined bounds from all visible layers
    let combinedBounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity]
    };
    
    // Get bounds for each visible layer and combine them
    for (const layer of visibleLayers) {
      if (layer.volumeId) {
        try {
          const bounds = await this.apiService.getVolumeBounds(layer.volumeId);
          // Update combined min bounds
          combinedBounds.min[0] = Math.min(combinedBounds.min[0], bounds.min[0]);
          combinedBounds.min[1] = Math.min(combinedBounds.min[1], bounds.min[1]);
          combinedBounds.min[2] = Math.min(combinedBounds.min[2], bounds.min[2]);
          // Update combined max bounds
          combinedBounds.max[0] = Math.max(combinedBounds.max[0], bounds.max[0]);
          combinedBounds.max[1] = Math.max(combinedBounds.max[1], bounds.max[1]);
          combinedBounds.max[2] = Math.max(combinedBounds.max[2], bounds.max[2]);
        } catch (error) {
          console.warn(`[MosaicRenderService] Failed to get bounds for volume ${layer.volumeId}:`, error);
        }
      }
    }
    
    // Use default MNI bounds if we couldn't get any bounds
    if (!isFinite(combinedBounds.min[0])) {
      combinedBounds = {
        min: [-96, -132, -78],  // Default MNI bounds
        max: [96, 96, 114]
      };
    }
    
    // Calculate the range for each axis
    let sliceMin: number, sliceMax: number;
    switch (axis) {
      case 'axial':
        // For axial slices in LPI, we move inferior to superior (Z axis)
        sliceMin = combinedBounds.min[2];  // Most inferior slice
        sliceMax = combinedBounds.max[2];  // Most superior slice
        break;
      case 'sagittal':
        // For sagittal slices, we move right to left (X axis) 
        sliceMin = combinedBounds.min[0];
        sliceMax = combinedBounds.max[0];
        break;
      case 'coronal':
        // For coronal slices, we move posterior to anterior (Y axis)
        sliceMin = combinedBounds.min[1];
        sliceMax = combinedBounds.max[1];
        break;
    }
    
    // Calculate total number of slices (assuming 1mm spacing)
    const sliceRange = sliceMax - sliceMin;
    const totalSlices = Math.ceil(sliceRange);
    
    // Map slice index to actual position
    // sliceIndex 0 should be at sliceMin (most inferior for axial)
    const slicePosition_mm = sliceMin + (sliceIndex * (sliceRange / totalSlices));
    
    // Get the current crosshair position as the center reference
    const crosshair = baseViewState.crosshair.world_mm;
    
    // Calculate the slice position based on axis
    // Use the absolute slice position we calculated above
    let slicePosition: [number, number, number];
    switch (axis) {
      case 'axial':
        // For axial, set Z to the calculated position, keep X and Y from crosshair
        slicePosition = [crosshair[0], crosshair[1], slicePosition_mm];
        break;
      case 'sagittal':
        // For sagittal, set X to the calculated position
        slicePosition = [slicePosition_mm, crosshair[1], crosshair[2]];
        break;
      case 'coronal':
        // For coronal, set Y to the calculated position
        slicePosition = [crosshair[0], slicePosition_mm, crosshair[2]];
        break;
    }
    
    console.log(`[MosaicRenderService] Slice ${sliceIndex} position: ${slicePosition_mm}mm (range: ${sliceMin} to ${sliceMax})`);
    
    
    // Update crosshair to the slice position
    modifiedViewState.crosshair = {
      world_mm: slicePosition,
      visible: false // Hide crosshair for mosaic cells
    };
    
    // CRITICAL: Update the view plane dimensions and vectors for the mosaic cell size
    // We need to recalculate the view plane to show the full brain extent in the smaller cell
    const currentView = modifiedViewState.views[axis];
    if (currentView) {
      // Calculate a suitable field of view for the mosaic cell
      // We want to show more of the brain, not less
      const fovScale = 1.5; // Show 1.5x more than the normal view
      const extent_mm: [number, number] = [200 * fovScale, 200 * fovScale]; // Typical brain extent
      
      // Use the CoordinateTransform utility to create proper view planes
      const { CoordinateTransform } = await import('@/utils/coordinates');
      const newViews = CoordinateTransform.createOrthogonalViews(
        slicePosition,
        extent_mm,
        [width, height]
      );
      
      // Update only the requested axis view
      modifiedViewState.views[axis] = newViews[axis];
      
      console.log(`[MosaicRenderService] createSliceViewState result for ${axis} slice ${sliceIndex}:`, {
        origin_mm: modifiedViewState.views[axis].origin_mm,
        u_mm: modifiedViewState.views[axis].u_mm,
        v_mm: modifiedViewState.views[axis].v_mm,
        dim_px: modifiedViewState.views[axis].dim_px,
        crosshair: modifiedViewState.crosshair.world_mm,
        layers: modifiedViewState.layers.length
      });
    }
    
    return modifiedViewState;
  }
}

// Singleton instance
let instance: MosaicRenderService | null = null;

export function getMosaicRenderService(): MosaicRenderService {
  if (!instance) {
    instance = new MosaicRenderService();
  }
  return instance;
}
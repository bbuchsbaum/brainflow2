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
import { CoordinateTransform } from '@/utils/coordinates';

export interface MosaicRenderRequest {
  sliceIndex: number;
  axis: 'axial' | 'sagittal' | 'coronal';
  cellId: string;
  width: number;
  height: number;
}

export interface CrosshairInfo {
  screenCoord: [number, number] | null;
  isActive: boolean; // true if this slice contains the global crosshair
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
   * Calculate crosshair information for a mosaic cell
   * Returns screen coordinates if the global crosshair should be visible on this slice
   */
  calculateCrosshairForCell(
    globalCrosshair: [number, number, number],
    axis: 'axial' | 'sagittal' | 'coronal',
    slicePosition: number,
    viewPlane: ViewPlane
  ): CrosshairInfo {
    console.log(`[MosaicRenderService] calculateCrosshairForCell:`, {
      globalCrosshair,
      axis,
      slicePosition,
      viewPlane: {
        origin_mm: viewPlane.origin_mm,
        u_mm: viewPlane.u_mm,
        v_mm: viewPlane.v_mm,
        dim_px: viewPlane.dim_px
      }
    });
    
    // Check if the crosshair is on this slice (within 1mm tolerance)
    let isOnSlice = false;
    let diff = 0;
    switch (axis) {
      case 'axial':
        diff = Math.abs(globalCrosshair[2] - slicePosition);
        isOnSlice = diff < 1.0;
        break;
      case 'sagittal':
        diff = Math.abs(globalCrosshair[0] - slicePosition);
        isOnSlice = diff < 1.0;
        break;
      case 'coronal':
        diff = Math.abs(globalCrosshair[1] - slicePosition);
        isOnSlice = diff < 1.0;
        break;
    }
    console.log(`[MosaicRenderService] Slice at ${slicePosition}, crosshair diff: ${diff}, isOnSlice: ${isOnSlice}`);
    
    if (!isOnSlice) {
      // This is a mirror crosshair - project the global crosshair onto this slice
      let projectedCrosshair: [number, number, number];
      switch (axis) {
        case 'axial':
          projectedCrosshair = [globalCrosshair[0], globalCrosshair[1], slicePosition];
          break;
        case 'sagittal':
          projectedCrosshair = [slicePosition, globalCrosshair[1], globalCrosshair[2]];
          break;
        case 'coronal':
          projectedCrosshair = [globalCrosshair[0], slicePosition, globalCrosshair[2]];
          break;
      }
      
      // Transform to screen coordinates without plane tolerance check
      const screenCoord = CoordinateTransform.worldToScreenUnchecked(projectedCrosshair, viewPlane);
      console.log(`[MosaicRenderService] Mirror crosshair:`, {
        projectedCrosshair,
        screenCoord,
        isActive: false
      });
      return {
        screenCoord,
        isActive: false
      };
    } else {
      // This is the active crosshair slice
      const screenCoord = CoordinateTransform.worldToScreenUnchecked(globalCrosshair, viewPlane);
      console.log(`[MosaicRenderService] Active crosshair:`, {
        globalCrosshair,
        screenCoord,
        isActive: true
      });
      return {
        screenCoord,
        isActive: true
      };
    }
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
    // Keep the original crosshair for coordinate calculations but hide it from rendering
    modifiedViewState.crosshair = {
      world_mm: slicePosition,
      visible: false // Hide crosshair for mosaic cells - we'll draw it ourselves
    };
    
    // CRITICAL: Update the view plane for the mosaic cell
    // Instead of creating new views, we modify the existing one to show full brain extent
    const currentView = modifiedViewState.views[axis];
    if (currentView) {
      // Calculate extent based on the actual volume bounds for this axis
      let extent_mm: [number, number];
      switch (axis) {
        case 'axial':
          // For axial view, we see X and Y axes
          extent_mm = [
            combinedBounds.max[0] - combinedBounds.min[0],  // X extent
            combinedBounds.max[1] - combinedBounds.min[1]   // Y extent
          ];
          break;
        case 'sagittal':
          // For sagittal view, we see Y and Z axes
          extent_mm = [
            combinedBounds.max[1] - combinedBounds.min[1],  // Y extent
            combinedBounds.max[2] - combinedBounds.min[2]   // Z extent
          ];
          break;
        case 'coronal':
          // For coronal view, we see X and Z axes
          extent_mm = [
            combinedBounds.max[0] - combinedBounds.min[0],  // X extent
            combinedBounds.max[2] - combinedBounds.min[2]   // Z extent
          ];
          break;
      }
      
      // Add small padding (10%) to avoid clipping edges
      const padding = 1.1;
      extent_mm[0] *= padding;
      extent_mm[1] *= padding;
      
      // Calculate the center of the volume bounds
      const volumeCenter: [number, number, number] = [
        (combinedBounds.min[0] + combinedBounds.max[0]) / 2,
        (combinedBounds.min[1] + combinedBounds.max[1]) / 2,
        (combinedBounds.min[2] + combinedBounds.max[2]) / 2
      ];
      
      // Use uniform pixel size to maintain aspect ratio
      const pixelSize = Math.max(extent_mm[0] / width, extent_mm[1] / height);
      
      // Calculate actual rendered extents based on pixel size and canvas dimensions
      const actualExtentX = pixelSize * width;
      const actualExtentY = pixelSize * height;
      
      // Update the view to be centered on the volume with correct extent
      // Keep the same vector directions but adjust origin and pixel size
      const updatedView = { ...currentView };
      
      // Update pixel dimensions
      updatedView.dim_px = [width, height];
      
      // Update vectors to use new pixel size
      if (axis === 'axial') {
        // Use actual rendered extent for proper centering
        updatedView.origin_mm = [volumeCenter[0] - actualExtentX/2, volumeCenter[1] + actualExtentY/2, slicePosition[2]];
        updatedView.u_mm = [pixelSize, 0, 0];
        updatedView.v_mm = [0, -pixelSize, 0];
      } else if (axis === 'sagittal') {
        // For sagittal: Y and Z axes visible
        updatedView.origin_mm = [slicePosition[0], volumeCenter[1] + actualExtentX/2, volumeCenter[2] + actualExtentY/2];
        updatedView.u_mm = [0, -pixelSize, 0];
        updatedView.v_mm = [0, 0, -pixelSize];
      } else if (axis === 'coronal') {
        // For coronal: X and Z axes visible
        updatedView.origin_mm = [volumeCenter[0] - actualExtentX/2, slicePosition[1], volumeCenter[2] + actualExtentY/2];
        updatedView.u_mm = [pixelSize, 0, 0];
        updatedView.v_mm = [0, 0, -pixelSize];
      }
      
      // Update the view in the state
      modifiedViewState.views[axis] = updatedView;
      
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
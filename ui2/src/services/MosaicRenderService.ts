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
import { getViewPlaneService } from '@/services/ViewPlaneService';

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
  private static readonly MAX_CONCURRENT_RENDERS = 4;
  // Store actual slice positions for each cell tag
  private slicePositions = new Map<string, number>();
  
  /**
   * Render a single mosaic cell
   */
  async renderMosaicCell(request: MosaicRenderRequest): Promise<void> {
    const { sliceIndex, axis, cellId, width, height } = request;
    
    console.log(`[MosaicRenderService] DEBUG - Starting render for cell:`, {
      cellId,
      sliceIndex,
      axis,
      width,
      height
    });
    
    // Store active render
    this.activeRenders.set(cellId, request);
    
    try {
      // Emit render start event with tag
      this.eventBus.emit('render.start', { tag: cellId });
      
      // Get current view state
      const currentViewState = useViewStateStore.getState().viewState;
      
      console.log(`[MosaicRenderService] DEBUG - Current ViewState structure:`, {
        cellId,
        hasLayers: !!currentViewState.layers,
        layerCount: currentViewState.layers?.length,
        firstLayer: currentViewState.layers?.[0],
        hasCrosshair: !!currentViewState.crosshair,
        hasViews: !!currentViewState.views,
        viewKeys: Object.keys(currentViewState.views || {})
      });
      
      // Create a modified view state for this specific slice WITH correct dimensions
      const modifiedViewState = await this.createSliceViewState(
        currentViewState,
        axis,
        sliceIndex,
        width,
        height
      );
      
      // Store the actual slice position for this cell
      // This is needed for correct crosshair calculation
      const slicePosition = await this.getSlicePositionForIndex(
        currentViewState,
        axis,
        sliceIndex
      );
      this.slicePositions.set(cellId, slicePosition);
      console.log(`[MosaicRenderService] Stored slice position ${slicePosition}mm for cell ${cellId}`);
      
      console.log(`[MosaicRenderService] DEBUG - Modified ViewState for slice ${sliceIndex}:`, {
        cellId,
        hasModifiedViews: !!modifiedViewState.views,
        modifiedViewKeys: Object.keys(modifiedViewState.views || {}),
        axialView: modifiedViewState.views?.axial
      });
      
      // Render using the normal pipeline with correct cell dimensions
      // This ensures backend renders at the exact size needed for the canvas
      console.log(`[MosaicRenderService] DEBUG - Calling applyAndRenderViewState for ${cellId} WITH dimensions ${width}x${height}`);
      
      const imageBitmap = await this.apiService.applyAndRenderViewState(
        modifiedViewState,
        axis,
        width,  // Pass actual cell width to match canvas size
        height  // Pass actual cell height to match canvas size
      );
      
      console.log(`[MosaicRenderService] DEBUG - Render result for ${cellId}:`, {
        hasImageBitmap: !!imageBitmap,
        imageBitmapType: imageBitmap ? imageBitmap.constructor.name : 'null',
        imageBitmapSize: imageBitmap ? `${imageBitmap.width}x${imageBitmap.height}` : 'N/A'
      });
      
      if (imageBitmap) {
        // Emit render complete event with tag (no viewType for tagged events)
        this.eventBus.emit('render.complete', {
          imageBitmap,
          tag: cellId
        });
        console.log(`[MosaicRenderService] DEBUG - Emitted render.complete for ${cellId}`);
      } else {
        throw new Error('No image returned from backend');
      }
    } catch (error) {
      console.error(`[MosaicRenderService] DEBUG - Error rendering ${cellId}:`, {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        sliceIndex,
        axis
      });
      
      // Emit render error event with tag (no viewType for tagged events)
      this.eventBus.emit('render.error', {
        error: error instanceof Error ? error : new Error(String(error)),
        tag: cellId
      });
    } finally {
      this.activeRenders.delete(cellId);
      console.log(`[MosaicRenderService] DEBUG - Finished processing ${cellId}`);
    }
  }
  
  /**
   * Render multiple mosaic cells with batched processing for controlled concurrency
   */
  async renderMosaicGrid(requests: MosaicRenderRequest[]): Promise<void> {
    console.log(`[MosaicRenderService] Starting batched rendering: ${requests.length} requests, max concurrent: ${MosaicRenderService.MAX_CONCURRENT_RENDERS}`);
    console.log('[MosaicRenderService] Request details:', requests.map(r => ({
      cellId: r.cellId,
      sliceIndex: r.sliceIndex,
      axis: r.axis,
      dimensions: `${r.width}x${r.height}`
    })));
    
    const batches = this.createBatches(requests, MosaicRenderService.MAX_CONCURRENT_RENDERS);
    const results = { successful: 0, failed: 0, errors: [] as Array<{cellId: string, error: any}> };
    
    // Process batches sequentially, but items within each batch in parallel
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`[MosaicRenderService] Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} renders`);
      
      // Process batch with controlled concurrency
      const batchPromises = batch.map(async (request) => {
        try {
          await this.renderMosaicCell(request);
          results.successful++;
          return { success: true, cellId: request.cellId };
        } catch (error) {
          results.failed++;
          results.errors.push({ cellId: request.cellId, error });
          return { success: false, cellId: request.cellId, error };
        }
      });
      
      // Wait for all renders in this batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Log batch results
      const batchSuccessful = batchResults.filter(r => r.success).length;
      const batchFailed = batchResults.filter(r => !r.success).length;
      console.log(`[MosaicRenderService] Batch ${batchIndex + 1} complete: ${batchSuccessful} successful, ${batchFailed} failed. Running total: ${results.successful}/${requests.length} successful`);
    }
    
    console.log(`[MosaicRenderService] All batches complete: ${results.successful}/${requests.length} successful`);
    
    if (results.failed > 0) {
      console.warn('[MosaicRenderService] Some cells failed to render:', results.errors);
      // Don't throw - allow partial success
    }
  }
  
  /**
   * Create batches from an array of items
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
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
   * Get the actual slice position for a given cell tag
   */
  getSlicePositionForTag(tag: string): number | undefined {
    return this.slicePositions.get(tag);
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
    
    console.log(`[MosaicRenderService] Slice ${sliceIndex} position: ${slicePosition_mm}mm (range: ${sliceMin} to ${sliceMax})`);
    
    // CRITICAL FIX: Calculate proper ViewPlane for this cell's dimensions
    // This ensures the entire slice fits within the cell, not a zoomed portion
    
    // Calculate the field of view in mm from the volume bounds
    let widthMm: number, heightMm: number;
    switch (axis) {
      case 'axial': // XY plane
        widthMm = combinedBounds.max[0] - combinedBounds.min[0]; // X extent
        heightMm = combinedBounds.max[1] - combinedBounds.min[1]; // Y extent
        break;
      case 'sagittal': // YZ plane
        widthMm = combinedBounds.max[1] - combinedBounds.min[1]; // Y extent
        heightMm = combinedBounds.max[2] - combinedBounds.min[2]; // Z extent
        break;
      case 'coronal': // XZ plane
        widthMm = combinedBounds.max[0] - combinedBounds.min[0]; // X extent
        heightMm = combinedBounds.max[2] - combinedBounds.min[2]; // Z extent
        break;
    }
    
    // Use ViewPlaneService for consistent pixel size and centering calculations
    const viewPlaneService = getViewPlaneService();
    
    // Calculate uniform pixel size to maintain aspect ratio and square pixels
    // This is the key to showing the entire slice within the cell
    const pixelSize = viewPlaneService.calculatePixelSize(widthMm, heightMm, width, height);
    
    // Calculate how many pixels the actual anatomy needs
    const actualWidthPx = widthMm / pixelSize;
    const actualHeightPx = heightMm / pixelSize;
    
    // Calculate centering offsets when anatomy doesn't fill the entire canvas
    // This happens when one dimension is smaller than the other
    const offsets = viewPlaneService.calculateCenteringOffsets(
      widthMm, heightMm, width, height, pixelSize
    );
    const xCenterOffset = offsets.x;
    const yCenterOffset = offsets.y;
    
    // Calculate new origin and basis vectors for this cell's ViewPlane
    let newOrigin: [number, number, number];
    let newU: [number, number, number];
    let newV: [number, number, number];
    
    switch (axis) {
      case 'axial':
        // Center the view within the canvas
        newOrigin = [
          combinedBounds.min[0] - xCenterOffset,  // Center X if narrower
          combinedBounds.max[1] + yCenterOffset,  // Center Y if shorter (Y inverted)
          slicePosition_mm
        ];
        newU = [pixelSize, 0, 0];      // +X right
        newV = [0, -pixelSize, 0];     // -Y down (neurological view)
        break;
      case 'sagittal':
        // For sagittal, Y is horizontal and Z is vertical
        const sagYOffset = xCenterOffset;  // Y maps to horizontal
        const sagZOffset = yCenterOffset;  // Z maps to vertical
        newOrigin = [
          slicePosition_mm,
          combinedBounds.max[1] + sagYOffset,  // Center Y if narrower
          combinedBounds.max[2] + sagZOffset   // Center Z if shorter
        ];
        newU = [0, -pixelSize, 0];     // -Y right
        newV = [0, 0, -pixelSize];     // -Z down
        break;
      case 'coronal':
        // For coronal, X is horizontal and Z is vertical
        newOrigin = [
          combinedBounds.min[0] - xCenterOffset,  // Center X if narrower
          slicePosition_mm,
          combinedBounds.max[2] + yCenterOffset   // Center Z if shorter
        ];
        newU = [pixelSize, 0, 0];      // +X right
        newV = [0, 0, -pixelSize];     // -Z down
        break;
    }
    
    // Create the new ViewPlane for this specific slice
    // Use actual dimensions needed for the anatomy, not the full canvas size
    // This prevents the backend from rendering beyond what's needed
    const actualDimPx: [number, number] = [
      Math.ceil(actualWidthPx),
      Math.ceil(actualHeightPx)
    ];
    
    const newViewPlane: ViewPlane = {
      origin_mm: newOrigin,
      u_mm: newU,
      v_mm: newV,
      dim_px: actualDimPx  // Use actual anatomy dimensions, not canvas dimensions
    };
    
    // Create the modified ViewState with both crosshair and proper ViewPlane
    const modifiedViewState: ViewState = {
      ...baseViewState,
      crosshair: {
        world_mm: (() => {
          // Create crosshair at the slice position
          const crosshair: [number, number, number] = [...baseViewState.crosshair.world_mm];
          switch (axis) {
            case 'axial':
              crosshair[2] = slicePosition_mm;
              break;
            case 'sagittal':
              crosshair[0] = slicePosition_mm;
              break;
            case 'coronal':
              crosshair[1] = slicePosition_mm;
              break;
          }
          return crosshair;
        })(),
        visible: false // Let cells draw crosshairs themselves
      },
      // Add the correctly framed ViewPlane for this axis
      views: {
        ...baseViewState.views,
        [axis]: newViewPlane
      }
    };
    
    console.log(`[MosaicRenderService] Correctly framed ViewState for ${axis} slice ${sliceIndex}:`, {
      slicePosition_mm,
      crosshair: modifiedViewState.crosshair.world_mm,
      newViewPlane,
      pixelSize
    });
    
    return modifiedViewState;
  }
  
  /**
   * Get the actual slice position for a given slice index
   * This calculates the exact mm position without any centering offsets
   */
  private async getSlicePositionForIndex(
    baseViewState: ViewState,
    axis: 'axial' | 'sagittal' | 'coronal',
    sliceIndex: number
  ): Promise<number> {
    // Get all visible layers to calculate combined bounds
    const visibleLayers = baseViewState.layers.filter(l => l.visible && l.opacity > 0);
    if (visibleLayers.length === 0) {
      return 0;
    }
    
    // Calculate combined bounds from all visible layers
    let combinedBounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity]
    };
    
    const apiService = getApiService();
    for (const layer of visibleLayers) {
      if (layer.volumeId) {
        try {
          const bounds = await apiService.getVolumeBounds(layer.volumeId);
          for (let i = 0; i < 3; i++) {
            combinedBounds.min[i] = Math.min(combinedBounds.min[i], bounds.min[i]);
            combinedBounds.max[i] = Math.max(combinedBounds.max[i], bounds.max[i]);
          }
        } catch (error) {
          console.warn(`[MosaicRenderService] Failed to get bounds for volume ${layer.volumeId}:`, error);
        }
      }
    }
    
    // Use default MNI bounds if we couldn't get any bounds
    if (!isFinite(combinedBounds.min[0])) {
      combinedBounds = {
        min: [-96, -132, -78],
        max: [96, 96, 114]
      };
    }
    
    // Calculate the range for each axis
    let sliceMin: number, sliceMax: number;
    switch (axis) {
      case 'axial':
        sliceMin = combinedBounds.min[2];
        sliceMax = combinedBounds.max[2];
        break;
      case 'sagittal':
        sliceMin = combinedBounds.min[0];
        sliceMax = combinedBounds.max[0];
        break;
      case 'coronal':
        sliceMin = combinedBounds.min[1];
        sliceMax = combinedBounds.max[1];
        break;
    }
    
    // Calculate total number of slices
    const sliceRange = sliceMax - sliceMin;
    const totalSlices = Math.ceil(sliceRange);
    
    // Map slice index to actual position
    const slicePosition_mm = sliceMin + (sliceIndex * (sliceRange / totalSlices));
    
    return slicePosition_mm;
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
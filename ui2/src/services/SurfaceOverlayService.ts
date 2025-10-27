/**
 * Surface Overlay Service
 * Handles loading and management of surface data overlays (functional, shape, label data)
 */

import { nanoid } from 'nanoid';
import { getTransport } from './transport';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { getEventBus } from '@/events/EventBus';

export interface SurfaceDataLayer {
  id: string;
  name: string;
  dataHandle: string;
  surfaceId: string;
  colormap: string;
  range: [number, number];
  threshold?: [number, number];
  opacity: number;
  showOnlyPositive?: boolean;
  showOnlyNegative?: boolean;
  mean?: number;
  std?: number;
  clusterThreshold?: number;
  smoothingKernel?: number;
}

export interface LoadedSurfaceData {
  handle: string;
  data_count: number;
  intent: string;
}

export class SurfaceOverlayService {
  private static instance: SurfaceOverlayService;
  
  private constructor() {}
  
  static getInstance(): SurfaceOverlayService {
    if (!SurfaceOverlayService.instance) {
      SurfaceOverlayService.instance = new SurfaceOverlayService();
    }
    return SurfaceOverlayService.instance;
  }
  
  /**
   * Check if a file is a surface overlay based on naming patterns
   */
  isOverlayFile(path: string): boolean {
    return path.includes('.func.gii') || 
           path.includes('.shape.gii') ||
           path.includes('.label.gii');
  }
  
  /**
   * Detect GIFTI file type from filename
   */
  detectGiftiType(filename: string): 'geometry' | 'overlay' | 'unknown' {
    if (filename.includes('.surf.gii')) return 'geometry';
    if (filename.includes('.func.gii')) return 'overlay';
    if (filename.includes('.shape.gii')) return 'overlay';
    if (filename.includes('.label.gii')) return 'overlay';
    return 'unknown';
  }
  
  /**
   * Load a surface overlay file and apply it to a target surface
   */
  async loadSurfaceOverlay(
    filePath: string,
    targetSurfaceId: string
  ): Promise<SurfaceDataLayer> {
    console.log(`Loading surface overlay: ${filePath} for surface: ${targetSurfaceId}`);
    
    // Validate file is overlay type
    if (!this.isOverlayFile(filePath)) {
      throw new Error(`Not a valid overlay file: ${filePath}`);
    }
    
    try {
      const transport = getTransport();

      // Load data via Tauri command
      const result = await transport.invoke<LoadedSurfaceData>('load_surface_overlay', {
        path: filePath,
        targetSurfaceId,
      });

      console.log('Overlay loaded:', result);

      // Get the actual overlay data from the backend
      const overlayData = await transport.invoke<number[]>('get_surface_overlay_data', {
        handle: result.handle,
      });
      
      // Convert to Float32Array
      const values = new Float32Array(overlayData);
      
      // Calculate data statistics
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (!isNaN(val) && isFinite(val)) {
          min = Math.min(min, val);
          max = Math.max(max, val);
          sum += val;
        }
      }
      const mean = sum / values.length;
      
      // Calculate standard deviation
      let sumSquaredDiff = 0;
      for (let i = 0; i < values.length; i++) {
        const val = values[i];
        if (!isNaN(val) && isFinite(val)) {
          sumSquaredDiff += Math.pow(val - mean, 2);
        }
      }
      const std = Math.sqrt(sumSquaredDiff / values.length);
      
      const range: [number, number] = [min, max];
      
      // Extract filename for display
      const name = filePath.split('/').pop() || 'Unknown Overlay';
      
      // Create data layer
      const dataLayer: SurfaceDataLayer = {
        id: nanoid(),
        name,
        dataHandle: result.handle,
        surfaceId: targetSurfaceId,
        colormap: 'viridis',
        range,
        opacity: 1.0,
        mean,
        std,
      };
      
      // Add to surface store
      const surfaceStore = useSurfaceStore.getState();
      const surface = surfaceStore.surfaces.get(targetSurfaceId);
      
      if (surface) {
        // Add data layer to surface
        surface.layers = surface.layers || new Map();
        surface.layers.set(dataLayer.id, {
          id: dataLayer.id,
          name: dataLayer.name,
          values: values, // Use the actual data values we loaded
          colormap: dataLayer.colormap,
          range: dataLayer.range,
          threshold: dataLayer.threshold,
          opacity: dataLayer.opacity,
          showOnlyPositive: dataLayer.showOnlyPositive,
          showOnlyNegative: dataLayer.showOnlyNegative,
          clusterThreshold: dataLayer.clusterThreshold,
          smoothingKernel: dataLayer.smoothingKernel,
          mean: mean,
          std: std,
        });
        
        // Store the data handle separately for now
        // We'll need to implement a command to get the actual data
        (surface as any).dataHandles = (surface as any).dataHandles || new Map();
        (surface as any).dataHandles.set(dataLayer.id, dataLayer.dataHandle);
        
        // Update the store (there's no updateSurface method, we need to use the store methods)
        surfaceStore.surfaces.set(targetSurfaceId, surface);
        
        // Notify UI of update
        getEventBus().emit('surface.dataLayerAdded' as any, {
          surfaceId: targetSurfaceId,
          layerId: dataLayer.id,
        });
      }
      
      return dataLayer;
    } catch (error) {
      console.error('Failed to load surface overlay:', error);
      
      // Show error notification
      getEventBus().emit('ui.notification', {
        type: 'error',
        message: `Failed to Load Overlay: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
      });
      
      throw error;
    }
  }
  
  /**
   * Remove a data layer from a surface
   */
  removeSurfaceDataLayer(surfaceId: string, layerId: string): void {
    const surfaceStore = useSurfaceStore.getState();
    const surface = surfaceStore.surfaces.get(surfaceId);
    
    if (surface && surface.layers) {
      surface.layers.delete(layerId);
      // Also remove the data handle
      if ((surface as any).dataHandles) {
        (surface as any).dataHandles.delete(layerId);
      }
      surfaceStore.surfaces.set(surfaceId, surface);
      
      getEventBus().emit('surface.dataLayerRemoved' as any, {
        surfaceId,
        layerId,
      });
    }
  }
  
  /**
   * Update data layer properties
   */
  updateDataLayer(
    surfaceId: string,
    layerId: string,
    updates: Partial<SurfaceDataLayer>
  ): void {
    const surfaceStore = useSurfaceStore.getState();
    const surface = surfaceStore.surfaces.get(surfaceId);
    
    if (surface && surface.layers) {
      const layer = surface.layers.get(layerId);
      if (layer) {
        // Update the layer
        const updatedLayer = { ...layer, ...updates };
        surface.layers.set(layerId, updatedLayer);
        surfaceStore.surfaces.set(surfaceId, surface);
        
        getEventBus().emit('surface.dataLayerUpdated' as any, {
          surfaceId,
          layerId,
          updates,
        });
      }
    }
  }
  
  /**
   * Get all data layers for a surface
   */
  getDataLayersForSurface(surfaceId: string): SurfaceDataLayer[] {
    const surfaceStore = useSurfaceStore.getState();
    const surface = surfaceStore.surfaces.get(surfaceId);
    
    if (surface && surface.layers) {
      // Convert from store format to SurfaceDataLayer format
      return Array.from(surface.layers.values()).map(layer => ({
        id: layer.id,
        name: layer.name,
        dataHandle: (surface as any).dataHandles?.get(layer.id) || '',
        surfaceId: surfaceId,
        colormap: layer.colormap,
        range: layer.range,
        threshold: layer.threshold,
        opacity: layer.opacity,
        showOnlyPositive: layer.showOnlyPositive,
        showOnlyNegative: layer.showOnlyNegative,
        mean: layer.mean,
        std: layer.std,
        clusterThreshold: layer.clusterThreshold,
        smoothingKernel: layer.smoothingKernel,
      }));
    }
    
    return [];
  }
  
  /**
   * Apply overlay data to surface mesh
   * This would be called to actually update the Three.js mesh with the data
   */
  async applyOverlayToSurface(
    surfaceId: string,
    layerId: string
  ): Promise<void> {
    const layer = this.getDataLayersForSurface(surfaceId)
      .find(l => l.id === layerId);
    
    if (!layer) {
      throw new Error(`Data layer ${layerId} not found for surface ${surfaceId}`);
    }
    
    // This will be implemented when we integrate with SurfaceViewCanvas
    // For now, just emit an event
    getEventBus().emit('surface.overlayApplied' as any, {
      surfaceId,
      layerId,
      dataHandle: layer.dataHandle,
      colormap: layer.colormap,
      range: layer.range,
      opacity: layer.opacity,
    });
  }
}

// Export singleton instance
export const surfaceOverlayService = SurfaceOverlayService.getInstance();
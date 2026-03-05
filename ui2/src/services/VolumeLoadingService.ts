/**
 * VolumeLoadingService - Unified service for loading volumes from any source
 * Ensures consistent behavior whether loading from file browser, templates, or other sources
 */

import { getEventBus, type EventBus } from '@/events/EventBus';
import { getApiService, type ApiService, type VolumeHandle } from './apiService';
import { useLayerStore } from '@/stores/layerStore';
import { getLayerService, type LayerService } from './LayerService';
import type { Layer } from '@/types/layers';
import type { LayerInfo } from '@/stores/layerStore';
import { VolumeHandleStore } from './VolumeHandleStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { CoordinateTransform } from '@/utils/coordinates';
import type { VolumeBounds } from '@brainflow/api';

const DEBUG_VOLUME_LOADING =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.localStorage.getItem('brainflow2-debug-volume-load') === 'true';

const volumeDebugLog = (...args: unknown[]) => {
  if (DEBUG_VOLUME_LOADING) {
    console.log(...args);
  }
};

export interface VolumeLoadConfig {
  volumeHandle: VolumeHandle;
  displayName: string;
  source: 'file' | 'template' | 'atlas' | 'other';
  sourcePath: string; // Original path or identifier
  layerType?: Layer['type'];
  visible?: boolean;
}

export class VolumeLoadingService {
  private static instance: VolumeLoadingService | null = null;
  private eventBus: EventBus | null = null;
  private apiService: ApiService | null = null;
  private layerService: LayerService | null = null;
  
  private constructor() {
    // Lazy initialization to avoid circular dependencies
  }
  
  private ensureInitialized() {
    if (!this.eventBus) {
      this.eventBus = getEventBus();
    }
    if (!this.apiService) {
      this.apiService = getApiService();
    }
    if (!this.layerService) {
      this.layerService = getLayerService();
    }
  }
  
  public static getInstance(): VolumeLoadingService {
    if (!VolumeLoadingService.instance) {
      VolumeLoadingService.instance = new VolumeLoadingService();
    }
    return VolumeLoadingService.instance;
  }
  
  /**
   * Unified method to load a volume and create a layer
   * Used by FileLoadingService, TemplateService, and any future loading mechanisms
   */
  async loadVolume(config: VolumeLoadConfig): Promise<Layer> {
    // Ensure services are initialized
    this.ensureInitialized();
    
    const startTime = performance.now();
    volumeDebugLog(`[VolumeLoadingService] Starting loadVolume with config:`, JSON.stringify(config));
    const { volumeHandle, displayName, source, sourcePath, layerType, visible = true } = config;
    
    volumeDebugLog(`[VolumeLoadingService ${startTime.toFixed(0)}ms] Loading volume from ${source}:`, {
      id: volumeHandle.id,
      name: displayName,
      path: sourcePath,
      dims: volumeHandle.dims,
      type: volumeHandle.volume_type
    });
    
    try {
      // 1. Store volume handle for future reference
      volumeDebugLog(`[VolumeLoadingService ${performance.now() - startTime}ms] Storing volume handle`);
      VolumeHandleStore.setVolumeHandle(volumeHandle.id, volumeHandle);
      
      // 2. Get volume bounds from backend - CRITICAL for histogram
      volumeDebugLog(`[VolumeLoadingService ${performance.now() - startTime}ms] Getting volume bounds from backend`);
      const volumeBounds = await this.getVolumeBounds(volumeHandle);
      
      if (!volumeBounds) {
        throw new Error('Failed to get volume bounds - this is required for proper visualization');
      }
      
      volumeDebugLog(`[VolumeLoadingService ${performance.now() - startTime}ms] Volume bounds received:`, {
        min: volumeBounds.min,
        max: volumeBounds.max,
        center: volumeBounds.center
      });
      
      // 3. Create layer object
      const currentLayerCount = useLayerStore.getState().layers.length;
      const layer: LayerInfo = {
        id: volumeHandle.id,
        name: displayName,
        volumeId: volumeHandle.id,
        type: layerType || this.inferLayerType(displayName, source),
        visible: visible,
        order: currentLayerCount,
        // Add 4D time series metadata
        volumeType: volumeHandle.volume_type === 'TimeSeries4D' ? 'TimeSeries4D' : 'Volume3D',
        timeSeriesInfo: volumeHandle.time_series_info ? {
          num_timepoints: volumeHandle.time_series_info.num_timepoints,
          tr: volumeHandle.time_series_info.tr,
          temporal_unit: volumeHandle.time_series_info.temporal_unit,
          acquisition_time: volumeHandle.time_series_info.acquisition_time
        } : undefined,
        currentTimepoint: volumeHandle.current_timepoint || 0
      };
      
      volumeDebugLog(`[VolumeLoadingService ${performance.now() - startTime}ms] Created layer object:`, layer);
      
      // 4. Set layer metadata BEFORE adding layer - CRITICAL TIMING
      volumeDebugLog(`[VolumeLoadingService ${performance.now() - startTime}ms] Setting layer metadata with worldBounds`);
      volumeDebugLog(`[VolumeLoadingService] DIAGNOSTIC - volumeHandle:`, {
        id: volumeHandle.id,
        name: volumeHandle.name,
        path: volumeHandle.path,
        dims: volumeHandle.dims,
        dtype: volumeHandle.dtype,
        volume_type: volumeHandle.volume_type
      });
      volumeDebugLog(`[VolumeLoadingService] DIAGNOSTIC - layer:`, {
        id: layer.id,
        volumeId: layer.volumeId,
        source: source,
        sourcePath: sourcePath
      });
      
      useLayerStore.getState().setLayerMetadata(layer.id, {
        worldBounds: {
          min: volumeBounds.min,
          max: volumeBounds.max
        },
        source: source,
        sourcePath: sourcePath,
        loadedAt: new Date().toISOString()
      });
      
      // 5. Emit volume loaded event
      this.eventBus!.emit('volume.loaded', { 
        volumeId: volumeHandle.id, 
        metadata: volumeHandle 
      });
      
      // 6. Initialize views for the volume
      volumeDebugLog(`[VolumeLoadingService ${performance.now() - startTime}ms] Initializing views`);
      await this.initializeViews(volumeHandle, volumeBounds);
      
      // 7. Add layer through layer service  
      volumeDebugLog(`[VolumeLoadingService ${performance.now() - startTime}ms] Adding layer through LayerService`);
      
      // Set loading state for UI feedback (backward compatibility with LayerItem)
      useLayerStore.getState().setLayerLoading(layer.id, true);
      
      let addedLayer: Layer | undefined;
      try {
        addedLayer = await this.layerService!.addLayer(layer);
        
        // 8. Readiness/mapping is handled in LayerApiImpl request path.
        // Avoid forced flush here to keep initial load/render scheduling smooth.
        volumeDebugLog(`[VolumeLoadingService ${performance.now() - startTime}ms] Backend readiness handshake completed`);
        
        // 9. Verify layer was added and selected
        const state = useLayerStore.getState();
        volumeDebugLog(`[VolumeLoadingService ${performance.now() - startTime}ms] Post-addition state:`, {
          totalLayers: state.layers.length,
          selectedLayerId: state.selectedLayerId,
          layerMetadata: state.layerMetadata.has(addedLayer.id)
          // NOTE: layerRender has been moved to ViewState
        });
        
        // 10. Emit completion event
        this.eventBus!.emit('volume.load.complete', {
          volumeId: volumeHandle.id,
          layerId: addedLayer.id,
          source: source,
          duration: performance.now() - startTime
        });
        
        volumeDebugLog(`[VolumeLoadingService ${performance.now() - startTime}ms] Volume loading complete`);
        
        return addedLayer;
        
      } catch (layerError) {
        // Handle layer addition or GPU allocation errors
        console.error(`[VolumeLoadingService] Failed to add layer or allocate GPU resources for ${displayName}:`, layerError);
        throw layerError;
      } finally {
        // Clear loading state regardless of success or failure
        // Use the addedLayer.id if available, otherwise fall back to layer.id
        const layerIdToClean = addedLayer?.id || layer.id;
        useLayerStore.getState().setLayerLoading(layerIdToClean, false);
        volumeDebugLog(`[VolumeLoadingService] Cleared loading state for layer: ${layerIdToClean}`);
      }
      
    } catch (error) {
      console.error(`[VolumeLoadingService] Failed to load volume:`, error);
      
      // NOTE: Loading state cleanup is now handled by the inner finally block
      
      // Clean up any partial state
      try {
        VolumeHandleStore.clearVolumeHandle(volumeHandle.id);
        useLayerStore.getState().clearLayerMetadata(volumeHandle.id);
      } catch (cleanupError) {
        console.error('[VolumeLoadingService] Cleanup error:', cleanupError);
      }
      
      // Emit error event
      this.eventBus!.emit('volume.load.error', {
        volumeId: volumeHandle.id,
        source: source,
        error: error as Error
      });
      
      throw error;
    }
  }
  
  /**
   * Get volume bounds from backend with error handling
   */
  private async getVolumeBounds(volumeHandle: VolumeHandle): Promise<VolumeBounds | null> {
    try {
      const bounds = await this.apiService!.getVolumeBounds(volumeHandle.id);
      return bounds;
    } catch (error) {
      console.error('[VolumeLoadingService] Failed to get volume bounds:', error);
      
      // Fallback: Try to estimate bounds from volume dimensions
      // This is less accurate but better than failing completely
      if (volumeHandle.dims && volumeHandle.dims.length >= 3) {
        const [dimX, dimY, dimZ] = volumeHandle.dims;
        console.warn('[VolumeLoadingService] Using fallback bounds estimation');
        
        return {
          min: [0, 0, 0] as [number, number, number],
          max: [dimX, dimY, dimZ] as [number, number, number],
          center: [dimX / 2, dimY / 2, dimZ / 2] as [number, number, number]
        };
      }
      
      return null;
    }
  }
  
  /**
   * Initialize views for the loaded volume
   */
  private async initializeViews(volumeHandle: VolumeHandle, bounds: VolumeBounds): Promise<void> {
    try {
      // Set crosshair to volume center
      useViewStateStore.getState().setCrosshair(bounds.center, true);
      
      // Calculate field of view
      const extentX = bounds.max[0] - bounds.min[0];
      const extentY = bounds.max[1] - bounds.min[1];
      const extentZ = bounds.max[2] - bounds.min[2];
      const maxExtent = Math.max(extentX, extentY, extentZ);
      const fov = maxExtent;
      
      volumeDebugLog(`[VolumeLoadingService] Field of view: ${fov.toFixed(1)}mm`);
      
      // Get current view dimensions
      const currentViews = useViewStateStore.getState().viewState.views;
      const axialDims = currentViews.axial.dim_px;
      const sagittalDims = currentViews.sagittal.dim_px;
      const coronalDims = currentViews.coronal.dim_px;
      
      const maxWidth = Math.max(axialDims[0], sagittalDims[0], coronalDims[0]);
      const maxHeight = Math.max(axialDims[1], sagittalDims[1], coronalDims[1]);
      const maxPx: [number, number] = [maxWidth || 512, maxHeight || 512];
      
      // Get properly calculated views from the backend
      const newViews = await this.apiService!.getInitialViews(volumeHandle.id, maxPx);
      
      // Update each view in the store
      Object.entries(newViews).forEach(([viewType, plane]) => {
        useViewStateStore.getState().updateView(viewType as any, plane);
      });
      
      volumeDebugLog(`[VolumeLoadingService] Views initialized`);
    } catch (error) {
      console.error('[VolumeLoadingService] Failed to initialize views:', error);
      // Continue without failing - views can be adjusted manually
    }
  }
  
  /**
   * Infer layer type from name and source
   */
  private inferLayerType(name: string, source: string): Layer['type'] {
    const lower = name.toLowerCase();
    
    if (source === 'template') {
      // Template-specific inference
      if (lower.includes('mask') || lower.includes('brain')) {
        return 'mask';
      } else if (lower.includes('gray') || lower.includes('white') || lower.includes('csf')) {
        return 'mask'; // Tissue probability maps
      } else {
        return 'anatomical'; // T1w, T2w, etc.
      }
    } else {
      // File-based inference
      if (lower.includes('mask') || lower.includes('label')) {
        return 'mask';
      } else if (lower.includes('bold') || lower.includes('func') || lower.includes('task')) {
        return 'functional';
      } else {
        return 'anatomical';
      }
    }
  }
}

// Export convenience function
export function getVolumeLoadingService(): VolumeLoadingService {
  return VolumeLoadingService.getInstance();
}

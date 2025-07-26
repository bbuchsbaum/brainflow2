/**
 * FileLoadingService - Handles loading neuroimaging files
 * Coordinates between file browser, backend API, and layer management
 */

import { getEventBus, type EventBus } from '@/events/EventBus';
import { getApiService, type ApiService, type VolumeHandle } from './apiService';
import { useLayerStore } from '@/stores/layerStore';
import { getLayerService, type LayerService } from './LayerService';
import type { Layer } from '@/types/layers';
import { VolumeHandleStore } from './VolumeHandleStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { CoordinateTransform } from '@/utils/coordinates';
import type { VolumeBounds } from '@brainflow/api';

export class FileLoadingService {
  private eventBus: EventBus;
  private apiService: ApiService;
  private layerService: LayerService;
  
  constructor() {
    this.eventBus = getEventBus();
    this.apiService = getApiService();
    this.layerService = getLayerService();
    
    // Listen for file double-click events
    this.initializeEventListeners();
  }
  
  private initializeEventListeners() {
    // Listen for double-click events from file browser
    this.eventBus.on('filebrowser.file.doubleclick', async ({ path }) => {
      await this.loadFile(path);
    });
  }
  
  /**
   * Load a neuroimaging file and add it as a layer
   */
  async loadFile(path: string): Promise<void> {
    const startTime = performance.now();
    console.log(`[FileLoadingService ${startTime.toFixed(0)}ms] loadFile called with path:`, path);
    
    // Check if file has valid extension
    const validExtensions = ['.nii', '.nii.gz', '.gii'];
    const hasValidExtension = validExtensions.some(ext => 
      path.toLowerCase().endsWith(ext)
    );
    
    if (!hasValidExtension) {
      console.warn(`[FileLoadingService] Invalid file extension for:`, path);
      this.eventBus.emit('ui.notification', {
        type: 'warning',
        message: `File type not supported. Supported types: ${validExtensions.join(', ')}`
      });
      return;
    }
    
    // Extract filename from path
    const filename = path.split('/').pop() || path;
    console.log(`[FileLoadingService ${performance.now() - startTime}ms] Loading file:`, filename);
    
    try {
      // Emit loading event
      this.eventBus.emit('file.loading', { path });
      
      // Create temporary layer ID
      const tempLayerId = `loading-${Date.now()}`;
      
      // Set loading state
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Setting loading state for tempLayerId:`, tempLayerId);
      useLayerStore.getState().setLayerLoading(tempLayerId, true);
      
      // Load file via backend
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Calling backend loadFile...`);
      const volumeHandle = await this.apiService.loadFile(path);
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Volume loaded:`, JSON.stringify(volumeHandle));
      
      // Store volume handle for future reference
      VolumeHandleStore.setVolumeHandle(volumeHandle.id, volumeHandle);
      
      // Check current state before creating layer
      const currentLayerCount = useLayerStore.getState().layers.length;
      const currentViewStateLayers = useViewStateStore.getState().viewState.layers.length;
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Current state before layer creation:`);
      console.log(`  - layerStore layers: ${currentLayerCount}`);
      console.log(`  - viewStateStore layers: ${currentViewStateLayers}`);
      
      // Create layer from loaded volume
      const layer: Layer = {
        id: volumeHandle.id,
        name: volumeHandle.name || filename,
        volumeId: volumeHandle.id,
        type: this.inferLayerType(filename),
        visible: true,
        order: currentLayerCount
      };
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Created layer object:`, JSON.stringify(layer));
      console.log(`  - Explicitly setting visible=true`);
      console.log(`  - Layer visible property: ${layer.visible}`);
      
      this.eventBus.emit('volume.loaded', { 
        volumeId: volumeHandle.id, 
        metadata: volumeHandle 
      });
      
      // Initialize views to center on the loaded volume and get world bounds
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Initializing views for volume...`);
      const volumeBounds = await this.initializeViewsForVolume(volumeHandle);
      
      if (!volumeBounds) {
        console.error(`[FileLoadingService ${performance.now() - startTime}ms] Failed to get volume bounds - this is required!`);
        throw new Error('Failed to get volume bounds for loaded file');
      }
      
      // Set the world bounds metadata BEFORE adding the layer
      // This ensures SliceNavigationService has access to bounds when the layer is first rendered
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Setting worldBounds metadata for layer ${layer.id}`);
      useLayerStore.getState().setLayerMetadata(layer.id, {
        worldBounds: {
          min: volumeBounds.min,
          max: volumeBounds.max
        }
      });
      
      // Add layer through layer service
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Calling layerService.addLayer with layer:`, JSON.stringify(layer));
      const addedLayer = await this.layerService.addLayer(layer);
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Layer added successfully with ID: ${addedLayer.id}`);
      
      // Small delay to ensure state propagation
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Check state after layer addition
      const newLayerCount = useLayerStore.getState().layers.length;
      const newViewStateLayers = useViewStateStore.getState().viewState.layers.length;
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] State after layer addition:`);
      console.log(`  - layerStore layers: ${newLayerCount} (was ${currentLayerCount})`);
      console.log(`  - viewStateStore layers: ${newViewStateLayers} (was ${currentViewStateLayers})`);
      
      // Clear temporary loading state
      useLayerStore.getState().setLayerLoading(tempLayerId, false);
      
      // The declarative API means GPU resources are handled automatically
      // when the ViewState is sent to the backend with the new layer
      
      // Emit success event
      this.eventBus.emit('file.loaded', { path, volumeId: volumeHandle.id });
      console.log('FileLoadingService: File load complete');
      
      // Show success notification
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Loaded ${filename}`
      });
      
    } catch (error) {
      console.error('Failed to load file:', error);
      
      // Clear any loading states
      useLayerStore.getState().loadingLayers.forEach(id => {
        useLayerStore.getState().setLayerLoading(id, false);
      });
      
      // Emit error event
      this.eventBus.emit('file.error', { path, error: error as Error });
      
      // Show error notification
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `Failed to load ${filename}: ${(error as Error).message}`
      });
    }
  }
  
  /**
   * Load file from drag-and-drop
   * In Tauri, drag-and-drop provides file paths directly
   */
  async loadDroppedFile(file: File): Promise<void> {
    // In a real Tauri app, we'd get the file path from the drop event
    // For now, we'll show a notification that this needs Tauri file handling
    this.eventBus.emit('ui.notification', {
      type: 'warning',
      message: 'File drag-and-drop requires Tauri file path handling. Please use the file browser for now.'
    });
    
    // TODO: Implement Tauri file drop handling
    // This would involve:
    // 1. Getting the actual file path from the drop event
    // 2. Calling loadFile with that path
  }
  
  /**
   * Initialize views to center on the loaded volume
   * Returns the volume bounds if successfully retrieved
   */
  private async initializeViewsForVolume(volumeHandle: VolumeHandle): Promise<VolumeBounds | null> {
    try {
      // Get the actual world bounds from the backend
      const bounds = await this.apiService.getVolumeBounds(volumeHandle.id);
      
      console.log(`[FileLoadingService] Volume bounds:`, bounds);
      console.log(`  - Min: [${bounds.min[0].toFixed(1)}, ${bounds.min[1].toFixed(1)}, ${bounds.min[2].toFixed(1)}]`);
      console.log(`  - Max: [${bounds.max[0].toFixed(1)}, ${bounds.max[1].toFixed(1)}, ${bounds.max[2].toFixed(1)}]`);
      console.log(`  - Center: [${bounds.center[0].toFixed(1)}, ${bounds.center[1].toFixed(1)}, ${bounds.center[2].toFixed(1)}]`);
      
      // Set crosshair to volume center in world space
      useViewStateStore.getState().setCrosshair(bounds.center, true);
      
      // Calculate appropriate field of view based on world bounds
      const extentX = bounds.max[0] - bounds.min[0];
      const extentY = bounds.max[1] - bounds.min[1];
      const extentZ = bounds.max[2] - bounds.min[2];
      const maxExtent = Math.max(extentX, extentY, extentZ);
      const fov = maxExtent; // No extra padding for maximum space utilization
      
      console.log(`[FileLoadingService] Field of view: ${fov.toFixed(1)}mm`);
      
      // Get current view dimensions from the store
      const currentViews = useViewStateStore.getState().viewState.views;
      // Use the largest view dimensions to ensure good quality
      const axialDims = currentViews.axial.dim_px;
      const sagittalDims = currentViews.sagittal.dim_px;
      const coronalDims = currentViews.coronal.dim_px;
      
      // For flexible layout, each view might have different dimensions
      // For locked layout, axial view is double width
      const maxWidth = Math.max(axialDims[0], sagittalDims[0], coronalDims[0]);
      const maxHeight = Math.max(axialDims[1], sagittalDims[1], coronalDims[1]);
      const maxPx: [number, number] = [maxWidth || 512, maxHeight || 512];
      
      // Get properly calculated views from the backend
      const newViews = await this.apiService.getInitialViews(volumeHandle.id, maxPx as [number, number]);
      
      // Update each view in the store
      Object.entries(newViews).forEach(([viewType, plane]) => {
        useViewStateStore.getState().updateView(viewType as any, plane);
      });
      
      console.log(`[FileLoadingService] Views initialized with backend-calculated geometry`);
      return bounds;
    } catch (error) {
      console.error('Failed to get volume bounds, using fallback:', error);
      
      // Fallback to voxel-based estimation if bounds API fails
      const [dimX, dimY, dimZ] = volumeHandle.dims;
      const centerX = dimX / 2;
      const centerY = dimY / 2; 
      const centerZ = dimZ / 2;
      
      useViewStateStore.getState().setCrosshair([centerX, centerY, centerZ], true);
      
      const maxDim = Math.max(dimX, dimY, dimZ);
      const fov = maxDim;
      
      const currentViews = useViewStateStore.getState().viewState.views;
      const newViews = CoordinateTransform.createOrthogonalViews(
        [centerX, centerY, centerZ],
        [fov, fov],
        [currentViews.axial.dim_px[0], currentViews.axial.dim_px[1]]
      );
      
      Object.entries(newViews).forEach(([viewType, plane]) => {
        useViewStateStore.getState().updateView(viewType as any, plane);
      });
      
      return null; // No bounds available in fallback mode
    }
  }

  /**
   * Infer layer type from filename
   */
  private inferLayerType(filename: string): Layer['type'] {
    const lower = filename.toLowerCase();
    
    if (lower.includes('mask') || lower.includes('label')) {
      return 'mask';
    } else if (lower.includes('bold') || lower.includes('func') || lower.includes('task')) {
      return 'functional';
    } else {
      return 'anatomical';
    }
  }
}

// Singleton instance
let fileLoadingServiceInstance: FileLoadingService | null = null;

/**
 * Get the singleton FileLoadingService instance
 */
export function getFileLoadingService(): FileLoadingService {
  if (!fileLoadingServiceInstance) {
    fileLoadingServiceInstance = new FileLoadingService();
  }
  return fileLoadingServiceInstance;
}

/**
 * Initialize the file loading service
 * Should be called on app startup
 */
export function initializeFileLoadingService(): FileLoadingService {
  return getFileLoadingService();
}
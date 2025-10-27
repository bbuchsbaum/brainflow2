/**
 * FileLoadingService - Handles loading neuroimaging files
 * Coordinates between file browser, backend API, and layer management
 */

import { getEventBus, type EventBus } from '@/events/EventBus';
import { getApiService, type ApiService, type VolumeHandle } from './apiService';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { getVolumeLoadingService, type VolumeLoadingService } from './VolumeLoadingService';
import type { Layer } from '@/types/layers';
import type { LayerInfo } from '@/stores/layerStore';
import { VolumeHandleStore } from './VolumeHandleStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { CoordinateTransform } from '@/utils/coordinates';
import type { VolumeBounds } from '@brainflow/api';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { getLayoutService } from './layoutService';
import { getSurfaceLoadingService, type SurfaceLoadingService } from './SurfaceLoadingService';
import { surfaceOverlayService } from './SurfaceOverlayService';

export class FileLoadingService {
  private eventBus: EventBus;
  private apiService: ApiService;
  private volumeLoadingService: VolumeLoadingService;
  private surfaceLoadingService: SurfaceLoadingService;
  
  constructor() {
    this.eventBus = getEventBus();
    this.apiService = getApiService();
    this.volumeLoadingService = getVolumeLoadingService();
    this.surfaceLoadingService = getSurfaceLoadingService();
    
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
    
    // Check if this is a surface overlay file (.func.gii, .shape.gii, .label.gii)
    const giftiType = surfaceOverlayService.detectGiftiType(filename);
    
    if (giftiType === 'overlay') {
      console.log(`[FileLoadingService] Detected surface overlay file: ${filename}`);
      await this.loadSurfaceOverlay(path, filename);
      return;
    }
    
    // Check if this is a surface geometry file and route to appropriate service (SURF-211)
    if (this.surfaceLoadingService.isSupportedSurfaceFile(path)) {
      await this.surfaceLoadingService.loadSurfaceFile({
        path,
        displayName: filename,
        autoActivate: true,
        validateMesh: true
      });
      return;
    }
    console.log(`[FileLoadingService ${performance.now() - startTime}ms] Loading file:`, filename);
    
    // Check if already loading
    if (useLoadingQueueStore.getState().isLoading(path)) {
      console.warn(`[FileLoadingService] File already loading:`, path);
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `File is already being loaded: ${filename}`
      });
      return;
    }
    
    // Add to loading queue
    const queueId = useLoadingQueueStore.getState().enqueue({
      type: 'file',
      path: path,
      displayName: filename
    });
    
    try {
      // Start loading
      useLoadingQueueStore.getState().startLoading(queueId);
      
      // Emit loading event for backward compatibility
      this.eventBus.emit('file.loading', { path });
      
      // Update progress: starting backend load
      useLoadingQueueStore.getState().updateProgress(queueId, 10);
      
      // Load file via backend
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Calling backend loadFile...`);
      const volumeHandle = await this.apiService.loadFile(path);
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Volume loaded:`, JSON.stringify(volumeHandle));
      
      // Update progress: backend load complete
      useLoadingQueueStore.getState().updateProgress(queueId, 50);
      
      // Use unified volume loading service
      const addedLayer = await this.volumeLoadingService.loadVolume({
        volumeHandle: volumeHandle,
        displayName: volumeHandle.name || filename,
        source: 'file',
        sourcePath: path,
        layerType: this.inferLayerType(filename),
        visible: true
      });
      
      console.log(`[FileLoadingService ${performance.now() - startTime}ms] Layer added successfully with ID: ${addedLayer.id}`);
      
      // Mark as complete in queue
      useLoadingQueueStore.getState().markComplete(queueId, {
        layerId: addedLayer.id,
        volumeId: volumeHandle.id
      });
      
      // Emit success event for backward compatibility
      this.eventBus.emit('file.loaded', { path, volumeId: volumeHandle.id });
      console.log('FileLoadingService: File load complete');
      
      // Show success notification
      this.eventBus.emit('ui.notification', {
        type: 'success',
        message: `Loaded: ${filename}`
      });
      
    } catch (error) {
      console.error(`[FileLoadingService] Failed to load file:`, error);
      
      // Mark as error in queue
      useLoadingQueueStore.getState().markError(queueId, error as Error);
      
      // Emit error event for backward compatibility
      this.eventBus.emit('file.error', { path, error: error as Error });
      
      // Show error notification
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `Failed to load ${filename}: ${(error as Error).message}`
      });
    }
  }
  
  /**
   * Load a surface overlay file (.func.gii, .shape.gii, .label.gii)
   */
  private async loadSurfaceOverlay(path: string, filename: string): Promise<void> {
    console.log(`[FileLoadingService] Loading surface overlay:`, filename);
    
    // Get list of loaded surfaces
    const surfaces = Array.from(useSurfaceStore.getState().surfaces.values());
    
    if (surfaces.length === 0) {
      // No surfaces loaded - show error
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `No surfaces loaded. Please load a surface first before applying overlays.`
      });
      return;
    }
    
    let targetSurfaceId: string;
    
    if (surfaces.length === 1) {
      // Only one surface - use it automatically
      targetSurfaceId = surfaces[0].handle;
      console.log(`[FileLoadingService] Using only available surface:`, targetSurfaceId);
    } else {
      // Multiple surfaces - need to show selection dialog
      // For now, use the active surface or first surface
      targetSurfaceId = useSurfaceStore.getState().activeSurfaceId || surfaces[0].handle;
      console.log(`[FileLoadingService] Using active/first surface:`, targetSurfaceId);
      
      // TODO: Show surface selection dialog
      // In future, we should show a modal dialog to let user select the target surface
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Applying overlay to surface: ${surfaces.find(s => s.handle === targetSurfaceId)?.name}`
      });
    }
    
    try {
      // Load the overlay via SurfaceOverlayService
      const dataLayer = await surfaceOverlayService.loadSurfaceOverlay(path, targetSurfaceId);
      
      console.log(`[FileLoadingService] Overlay loaded successfully:`, dataLayer);
      
      // Apply the overlay to the surface mesh
      await surfaceOverlayService.applyOverlayToSurface(targetSurfaceId, dataLayer.id);
      
    } catch (error) {
      console.error(`[FileLoadingService] Failed to load overlay:`, error);
      
      // Show error notification
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `Failed to load overlay ${filename}: ${(error as Error).message}`
      });
    }
  }

  /**
   * Load a surface file (.gii) and open it in a new surface viewer panel
   */
  private async loadSurfaceFile(path: string, filename: string): Promise<void> {
    console.log(`[FileLoadingService] Loading surface file:`, filename);
    
    try {
      // Show loading notification
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Loading surface: ${filename}`
      });
      
      // Load surface via surface store
      const surfaceHandle = await useSurfaceStore.getState().loadSurface(path);
      console.log(`[FileLoadingService] Surface loaded with handle:`, surfaceHandle);
      
      // Open a new surface viewer panel in GoldenLayout
      const layoutService = getLayoutService();
      layoutService.addComponent({
        type: 'component',
        componentType: 'surfaceView',
        title: filename,
        componentState: {
          surfaceHandle,
          path
        }
      });
      
      // Show success notification
      this.eventBus.emit('ui.notification', {
        type: 'success',
        message: `Surface loaded: ${filename}`
      });
      
    } catch (error) {
      console.error(`[FileLoadingService] Failed to load surface:`, error);
      
      // Show error notification
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `Failed to load surface ${filename}: ${(error as Error).message}`
      });
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

// Singleton accessor functions
let fileLoadingServiceInstance: FileLoadingService | null = null;

export function getFileLoadingService(): FileLoadingService {
  if (!fileLoadingServiceInstance) {
    fileLoadingServiceInstance = new FileLoadingService();
  }
  return fileLoadingServiceInstance;
}

export function initializeFileLoadingService(): FileLoadingService {
  return getFileLoadingService();
}
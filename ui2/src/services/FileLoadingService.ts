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

export class FileLoadingService {
  private eventBus: EventBus;
  private apiService: ApiService;
  private volumeLoadingService: VolumeLoadingService;
  
  constructor() {
    this.eventBus = getEventBus();
    this.apiService = getApiService();
    this.volumeLoadingService = getVolumeLoadingService();
    
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
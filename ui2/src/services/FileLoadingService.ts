/**
 * FileLoadingService - Handles loading neuroimaging files
 * Coordinates between file browser, backend API, and layer management
 */

import { getEventBus, type EventBus } from '@/events/EventBus';
import { getApiService, type ApiService, type VolumeHandle } from './apiService';
import { useLayerStore } from '@/stores/layerStore';
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
      
      // Clear temporary loading state
      useLayerStore.getState().setLayerLoading(tempLayerId, false);
      
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
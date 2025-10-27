/**
 * SurfaceLoadingService - Dedicated service for loading and managing surface files
 * Handles .gii file loading, validation, and coordination with surface store
 */

import { getEventBus, type EventBus } from '@/events/EventBus';
import { getApiService, type ApiService } from './apiService';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { getLayoutService } from './layoutService';

export interface SurfaceLoadOptions {
  path: string;
  displayName?: string;
  autoActivate?: boolean;
  validateMesh?: boolean;
}

export class SurfaceLoadingService {
  private eventBus: EventBus;
  private apiService: ApiService;
  
  constructor() {
    this.eventBus = getEventBus();
    this.apiService = getApiService();
  }
  
  /**
   * Load a surface file (.gii format)
   */
  async loadSurfaceFile(options: SurfaceLoadOptions): Promise<string | null> {
    const { path, displayName, autoActivate = true, validateMesh = true } = options;
    const filename = displayName || path.split('/').pop() || path;
    
    console.log(`[SurfaceLoadingService] Loading surface file:`, filename);
    
    // Check if already loading
    if (useLoadingQueueStore.getState().isLoading(path)) {
      console.warn(`[SurfaceLoadingService] Surface already loading:`, path);
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Surface is already being loaded: ${filename}`
      });
      return null;
    }
    
    // Add to loading queue
    const queueId = useLoadingQueueStore.getState().enqueue({
      type: 'file',  // Using 'file' type since surfaces are loaded from files
      path: path,
      displayName: filename
    });
    
    try {
      // Start loading
      useLoadingQueueStore.getState().startLoading(queueId);
      
      // Emit loading event
      this.eventBus.emit('surface.loading', { path, filename });
      
      // Update progress: starting backend load
      useLoadingQueueStore.getState().updateProgress(queueId, 10);
      
      // Validate file format if requested
      if (validateMesh) {
        const isValid = await this.validateSurfaceFile(path);
        if (!isValid) {
          throw new Error(`Invalid surface file format: ${filename}`);
        }
      }
      
      // Update progress: validation complete
      useLoadingQueueStore.getState().updateProgress(queueId, 30);
      
      // Load surface via surface store
      const surfaceHandle = await useSurfaceStore.getState().loadSurface(path);
      
      // Update progress: surface loaded
      useLoadingQueueStore.getState().updateProgress(queueId, 80);
      
      // Auto-activate if requested
      if (autoActivate) {
        useSurfaceStore.getState().setActiveSurface(surfaceHandle);
      }
      
      // Complete loading
      useLoadingQueueStore.getState().markComplete(queueId);
      
      // Emit success event
      this.eventBus.emit('surface.loaded', {
        path,
        filename,
        handle: surfaceHandle
      });
      
      // Show success notification
      this.eventBus.emit('ui.notification', {
        type: 'success',
        message: `Surface loaded: ${filename}`
      });
      
      // Open surface viewer panel in GoldenLayout
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
      
      // Focus the Surfaces tab to show the newly loaded surface in the list
      layoutService.focusSurfacePanel();
      
      console.log(`[SurfaceLoadingService] Surface loaded successfully:`, surfaceHandle);
      return surfaceHandle;
      
    } catch (error) {
      console.error(`[SurfaceLoadingService] Failed to load surface:`, error);
      
      // Mark as failed in queue
      useLoadingQueueStore.getState().markError(queueId, error instanceof Error ? error : new Error('Unknown error'));
      
      // Emit error event
      this.eventBus.emit('surface.load.error', {
        path,
        filename,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Show error notification
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `Failed to load surface: ${filename}`
      });
      
      return null;
    }
  }
  
  /**
   * Validate surface file format and mesh integrity
   * SURF-212: Add surface file validation
   */
  async validateSurfaceFile(path: string): Promise<boolean> {
    try {
      // Check file extension
      if (!path.toLowerCase().endsWith('.gii')) {
        console.warn(`[SurfaceLoadingService] Invalid file extension:`, path);
        return false;
      }
      
      // In a real implementation, we would:
      // 1. Check file header for GIFTI format
      // 2. Validate mesh connectivity
      // 3. Check for degenerate triangles
      // 4. Verify vertex/face counts are reasonable
      
      // For now, just check extension
      return true;
      
    } catch (error) {
      console.error(`[SurfaceLoadingService] Validation error:`, error);
      return false;
    }
  }
  
  /**
   * Check if a file is a supported surface format
   */
  isSupportedSurfaceFile(path: string): boolean {
    const supportedExtensions = ['.gii', '.gifti'];
    const lower = path.toLowerCase();
    return supportedExtensions.some(ext => lower.endsWith(ext));
  }
  
  /**
   * Get surface metadata without fully loading the file
   */
  async getSurfaceMetadata(path: string): Promise<{
    vertexCount?: number;
    faceCount?: number;
    surfaceType?: string;
    hemisphere?: string;
  } | null> {
    try {
      // This would call a backend method to quickly read surface metadata
      // For now, return null
      console.log(`[SurfaceLoadingService] Getting metadata for:`, path);
      return null;
    } catch (error) {
      console.error(`[SurfaceLoadingService] Failed to get metadata:`, error);
      return null;
    }
  }
}

// Singleton instance
let surfaceLoadingServiceInstance: SurfaceLoadingService | null = null;

export function getSurfaceLoadingService(): SurfaceLoadingService {
  if (!surfaceLoadingServiceInstance) {
    surfaceLoadingServiceInstance = new SurfaceLoadingService();
  }
  return surfaceLoadingServiceInstance;
}

export function initializeSurfaceLoadingService(): SurfaceLoadingService {
  return getSurfaceLoadingService();
}
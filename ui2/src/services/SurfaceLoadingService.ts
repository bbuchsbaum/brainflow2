/**
 * SurfaceLoadingService - Dedicated service for loading and managing surface files
 * Handles .gii file loading, validation, and coordination with surface store
 */

import { getEventBus, type EventBus } from '@/events/EventBus';
import { useSurfaceStore, type LoadedSurface, type SurfaceGeometryData } from '@/stores/surfaceStore';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { getLayoutService } from './layoutService';
import { formatTauriError } from '@/utils/formatTauriError';
import { normalizeSurfaceHemisphere } from '@/utils/surfaceIdentity';
import { getTransport, type BackendTransport } from './transport';

export interface SurfaceLoadOptions {
  path: string;
  displayName?: string;
  autoActivate?: boolean;
  validateMesh?: boolean;
}

interface SurfaceLoadResult {
  type: 'Surface';
  handle: string;
  vertex_count?: number;
  face_count?: number;
  hemisphere?: string;
  surface_type?: string;
}

interface SurfaceGeometryResult {
  vertices: number[];
  faces: number[];
}

interface SurfaceTemplateLoadResult {
  success: boolean;
  surface_handle?: string;
  vertex_count?: number;
  face_count?: number;
  space: string;
  geometry_type: string;
  hemisphere: string;
  error_message?: string;
}

export class SurfaceLoadingService {
  private eventBus: EventBus;
  private transport: BackendTransport;
  
  constructor() {
    this.eventBus = getEventBus();
    this.transport = getTransport();
  }
  
  /**
   * Load a surface file (.gii format)
   */
  async loadSurfaceFile(options: SurfaceLoadOptions): Promise<string | null> {
    const { path, displayName, autoActivate = true, validateMesh = true } = options;
    const filename = displayName || path.split('/').pop() || path;
    
    console.log(`[SurfaceLoadingService] Loading surface file:`, filename);
    useSurfaceStore.getState().setLoadingState(true, null);
    
    // Check if already loading
    if (useLoadingQueueStore.getState().isLoading(path)) {
      console.warn(`[SurfaceLoadingService] Surface already loading:`, path);
      useSurfaceStore.getState().setLoadingState(false, null);
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
      
      const loadedSurface = await this.loadSurfaceFromPath(path);
      const surfaceStore = useSurfaceStore.getState();
      surfaceStore.addSurface(loadedSurface, autoActivate);

      const geometry = await this.fetchSurfaceGeometry(loadedSurface.handle);
      surfaceStore.setSurfaceGeometry(loadedSurface.handle, geometry);
      surfaceStore.setLoadingState(false, null);
      
      // Update progress: surface loaded
      useLoadingQueueStore.getState().updateProgress(queueId, 80);
      
      // Auto-activate if requested
      if (autoActivate) {
        surfaceStore.setActiveSurface(loadedSurface.handle);
      }
      
      // Complete loading
      useLoadingQueueStore.getState().markComplete(queueId);
      
      // Emit success event
      this.eventBus.emit('surface.loaded', {
        path,
        filename,
        handle: loadedSurface.handle
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
          surfaceHandle: loadedSurface.handle,
          path
        }
      });
      
      // Focus the Surfaces tab to show the newly loaded surface in the list
      layoutService.focusSurfacePanel();
      
      console.log(`[SurfaceLoadingService] Surface loaded successfully:`, loadedSurface.handle);
      return loadedSurface.handle;
      
    } catch (error) {
      console.error(`[SurfaceLoadingService] Failed to load surface:`, error);
      useSurfaceStore.getState().setLoadingState(
        false,
        error instanceof Error ? error.message : 'Failed to load surface'
      );
      
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
  /**
   * Load a surface template from TemplateFlow (e.g., fsaverage, fsaverage5)
   * @param request The template request with space, geometry_type, and hemisphere
   * @returns The surface handle if successful, null otherwise
   */
  async loadSurfaceTemplate(request: {
    space: string;
    geometry_type: string;
    hemisphere: string;
  }, options?: {
    openViewer?: boolean;
    focusSurfacePanel?: boolean;
  }): Promise<string | null> {
    const { space, geometry_type, hemisphere } = request;
    const openViewer = options?.openViewer ?? true;
    const focusSurfacePanel = options?.focusSurfacePanel ?? true;

    const normalizedRequest = this.normalizeTemplateRequest(request);
    const effectiveGeometryType = normalizedRequest.geometry_type;

    // Generate a unique path identifier for this template
    const templatePath = `templateflow://${space}_${effectiveGeometryType}_${hemisphere}`;
    const displayName =
      effectiveGeometryType === geometry_type
        ? `${space} ${geometry_type} (${hemisphere})`
        : `${space} ${geometry_type}->${effectiveGeometryType} (${hemisphere})`;

    console.log(`[SurfaceLoadingService] Loading surface template:`, displayName);
    useSurfaceStore.getState().setLoadingState(true, null);

    // Check if already loading
    if (useLoadingQueueStore.getState().isLoading(templatePath)) {
      console.warn(`[SurfaceLoadingService] Surface template already loading:`, templatePath);
      useSurfaceStore.getState().setLoadingState(false, null);
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Surface template is already being loaded: ${displayName}`
      });
      return null;
    }

    // Add to loading queue
    const queueId = useLoadingQueueStore.getState().enqueue({
      type: 'template',
      path: templatePath,
      displayName: displayName
    });

    try {
      // Start loading
      useLoadingQueueStore.getState().startLoading(queueId);

      // Emit loading event
      this.eventBus.emit('surface.template.loading', {
        space,
        geometry_type: effectiveGeometryType,
        hemisphere,
      });

      if (effectiveGeometryType !== geometry_type) {
        this.eventBus.emit('ui.notification', {
          type: 'warning',
          message: `Template '${space}' does not provide '${geometry_type}' surfaces; loading '${effectiveGeometryType}' instead.`,
        });
      }

      // Update progress: starting backend load
      useLoadingQueueStore.getState().updateProgress(queueId, 10);

      // Call the backend to load the surface template
      const result = await this.transport.invoke<SurfaceTemplateLoadResult>('load_surface_template', {
        request: normalizedRequest,
      });

      // Update progress: backend response received
      useLoadingQueueStore.getState().updateProgress(queueId, 50);

      if (!result.success || !result.surface_handle) {
        throw new Error(result.error_message || `Failed to load surface template: ${displayName}`);
      }

      const surface = this.buildTemplateSurface({
        handle: result.surface_handle,
        space: result.space,
        geometryType: result.geometry_type,
        hemisphere: result.hemisphere,
        vertexCount: result.vertex_count || 0,
        faceCount: result.face_count || 0,
      });
      const surfaceStore = useSurfaceStore.getState();
      surfaceStore.addSurface(surface, true);

      const geometry = await this.fetchSurfaceGeometry(surface.handle);
      surfaceStore.setSurfaceGeometry(surface.handle, geometry);
      surfaceStore.setLoadingState(false, null);

      const surfaceHandle = surface.handle;

      // Update progress: surface registered
      useLoadingQueueStore.getState().updateProgress(queueId, 80);

      // Set as active surface
      useSurfaceStore.getState().setActiveSurface(surfaceHandle);

      // Complete loading
      useLoadingQueueStore.getState().markComplete(queueId);

      // Emit success event
      this.eventBus.emit('surface.template.loaded', {
        handle: surfaceHandle,
        space,
        geometry_type: result.geometry_type || effectiveGeometryType,
        hemisphere,
        vertexCount: result.vertex_count || 0,
        faceCount: result.face_count || 0,
      });

      const layoutService = getLayoutService();
      if (openViewer) {
        layoutService.addComponent({
          type: 'component',
          componentType: 'surfaceView',
          title: displayName,
          componentState: {
            surfaceHandle,
            path: templatePath
          }
        });
      }

      if (focusSurfacePanel) {
        layoutService.focusSurfacePanel();
      }

      console.log(`[SurfaceLoadingService] Surface template loaded successfully:`, surfaceHandle);
      return surfaceHandle;

    } catch (error) {
      console.error(`[SurfaceLoadingService] Failed to load surface template:`, error);
      const errorMessage = formatTauriError(error);
      const normalizedError = error instanceof Error ? error : new Error(errorMessage);
      useSurfaceStore.getState().setLoadingState(false, errorMessage);

      // Mark as failed in queue
      useLoadingQueueStore.getState().markError(queueId, normalizedError);

      // Emit error event
      this.eventBus.emit('surface.template.error', {
        space,
        geometry_type: effectiveGeometryType,
        hemisphere,
        error: errorMessage
      });

      return null;
    }
  }

  private async loadSurfaceFromPath(path: string): Promise<LoadedSurface> {
    const result = await this.transport.invoke<SurfaceLoadResult>('load_surface', { path });
    if (result.type !== 'Surface') {
      throw new Error(`Expected Surface type, got ${result.type}`);
    }

    const hemisphere = normalizeSurfaceHemisphere(result.hemisphere) ?? undefined;
    const surfaceType = this.toSurfaceType(result.surface_type);

    return {
      handle: result.handle,
      name: path.split('/').pop() || 'Unknown',
      visible: true,
      geometry: {
        vertices: new Float32Array(0),
        faces: new Uint32Array(0),
        hemisphere,
        surfaceType,
      },
      layers: new Map(),
      displayLayers: new Map(),
      metadata: {
        vertexCount: result.vertex_count || 0,
        faceCount: result.face_count || 0,
        hemisphere: hemisphere ?? result.hemisphere,
        surfaceType: result.surface_type,
        path,
      },
    };
  }

  private async fetchSurfaceGeometry(handle: string): Promise<SurfaceGeometryData> {
    const geometryData = await this.transport.invoke<SurfaceGeometryResult>('get_surface_geometry', { handle });
    return {
      vertices: new Float32Array(geometryData.vertices),
      faces: new Uint32Array(geometryData.faces),
    };
  }

  private buildTemplateSurface(metadata: {
    handle: string;
    space: string;
    geometryType: string;
    hemisphere: string;
    vertexCount: number;
    faceCount: number;
  }): LoadedSurface {
    const normalizedHemisphere =
      normalizeSurfaceHemisphere(metadata.hemisphere) ?? metadata.hemisphere;
    const surfaceType = this.toSurfaceType(metadata.geometryType);

    return {
      handle: metadata.handle,
      name: `${metadata.space} ${metadata.geometryType} (${normalizedHemisphere})`,
      visible: true,
      geometry: {
        vertices: new Float32Array(0),
        faces: new Uint32Array(0),
        hemisphere: normalizeSurfaceHemisphere(metadata.hemisphere) ?? undefined,
        surfaceType,
      },
      layers: new Map(),
      displayLayers: new Map(),
      metadata: {
        vertexCount: metadata.vertexCount,
        faceCount: metadata.faceCount,
        hemisphere: normalizedHemisphere,
        surfaceType: metadata.geometryType,
        path: `templateflow://${metadata.space}_${metadata.geometryType}_${normalizedHemisphere}`,
      },
    };
  }

  private toSurfaceType(value: string | undefined): SurfaceGeometryData['surfaceType'] {
    if (value === 'pial' || value === 'white' || value === 'inflated' || value === 'sphere') {
      return value;
    }
    return undefined;
  }

  private normalizeTemplateRequest(request: {
    space: string;
    geometry_type: string;
    hemisphere: string;
  }): {
    space: string;
    geometry_type: string;
    hemisphere: string;
  } {
    const isFsaverageFamily = /^fsaverage(5|6|7)?$/i.test(request.space);
    const geometry = request.geometry_type.toLowerCase();

    // TemplateFlow fsaverage currently ships white/pial/sphere/midthickness,
    // but no inflated geometry files.
    if (isFsaverageFamily && geometry === 'inflated') {
      return {
        ...request,
        geometry_type: 'pial',
      };
    }

    return request;
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

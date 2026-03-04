/**
 * DisplayLifecycleOrchestrator
 *
 * Canonical owner for display lifecycle ingress:
 * - file-browser double-click
 * - drag/drop file
 * - programmatic file load
 *
 * This service routes each load request to exactly one flow:
 * - volume load
 * - surface geometry load
 * - surface overlay load
 */

import { getEventBus, type EventBus } from '@/events/EventBus';
import { getApiService, type ApiService } from './apiService';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { getVolumeLoadingService, type VolumeLoadingService } from './VolumeLoadingService';
import type { Layer } from '@/types/layers';
import { getSurfaceLoadingService, type SurfaceLoadingService } from './SurfaceLoadingService';
import { surfaceOverlayService } from './SurfaceOverlayService';
import { useSurfaceStore } from '@/stores/surfaceStore';

export type DisplayLoadIngress = 'file-browser' | 'drag-drop' | 'programmatic';

export interface DisplayLoadRequest {
  path: string;
  ingress?: DisplayLoadIngress;
}

type DroppedFile = File & {
  path?: string;
};

const SUPPORTED_EXTENSIONS = ['.nii', '.nii.gz', '.gii', '.gifti'] as const;

export class DisplayLifecycleOrchestrator {
  private static instance: DisplayLifecycleOrchestrator | null = null;
  private readonly eventBus: EventBus;
  private readonly apiService: ApiService;
  private readonly volumeLoadingService: VolumeLoadingService;
  private readonly surfaceLoadingService: SurfaceLoadingService;

  private constructor() {
    this.eventBus = getEventBus();
    this.apiService = getApiService();
    this.volumeLoadingService = getVolumeLoadingService();
    this.surfaceLoadingService = getSurfaceLoadingService();
    this.initializeIngressListeners();
  }

  static getInstance(): DisplayLifecycleOrchestrator {
    if (!DisplayLifecycleOrchestrator.instance) {
      DisplayLifecycleOrchestrator.instance = new DisplayLifecycleOrchestrator();
    }
    return DisplayLifecycleOrchestrator.instance;
  }

  async loadFile(request: DisplayLoadRequest): Promise<void> {
    const startTime = performance.now();
    const path = request.path.trim();
    const ingress = request.ingress ?? 'programmatic';

    if (!path) {
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: 'Cannot load an empty path',
      });
      return;
    }

    if (!this.hasSupportedExtension(path)) {
      this.eventBus.emit('ui.notification', {
        type: 'warning',
        message: `File type not supported. Supported types: ${SUPPORTED_EXTENSIONS.join(', ')}`,
      });
      return;
    }

    const filename = this.extractFilename(path);
    const giftiType = surfaceOverlayService.detectGiftiType(filename);

    console.log(`[DisplayLifecycleOrchestrator] loadFile (${ingress})`, { path, giftiType });

    if (giftiType === 'overlay') {
      await this.loadSurfaceOverlay(path, filename);
      return;
    }

    if (this.surfaceLoadingService.isSupportedSurfaceFile(path)) {
      await this.surfaceLoadingService.loadSurfaceFile({
        path,
        displayName: filename,
        autoActivate: true,
        validateMesh: true,
      });
      return;
    }

    await this.loadVolume(path, filename, startTime);
  }

  async loadDroppedFile(file: File): Promise<void> {
    const path = this.extractDroppedFilePath(file);
    if (!path) {
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `Unable to resolve dropped file path for ${file.name}`,
      });
      return;
    }

    await this.loadFile({
      path,
      ingress: 'drag-drop',
    });
  }

  private initializeIngressListeners(): void {
    this.eventBus.on('filebrowser.file.doubleclick', ({ path }) => {
      void this.loadFile({
        path,
        ingress: 'file-browser',
      });
    });
  }

  private hasSupportedExtension(path: string): boolean {
    const lower = path.toLowerCase();
    return SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
  }

  private extractFilename(path: string): string {
    return path.split('/').pop() || path;
  }

  private extractDroppedFilePath(file: File): string | null {
    const dropped = file as DroppedFile;
    if (typeof dropped.path === 'string' && dropped.path.length > 0) {
      return dropped.path;
    }
    if (typeof file.webkitRelativePath === 'string' && file.webkitRelativePath.length > 0) {
      return file.webkitRelativePath;
    }
    return null;
  }

  private async loadVolume(path: string, filename: string, startTime: number): Promise<void> {
    if (useLoadingQueueStore.getState().isLoading(path)) {
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `File is already being loaded: ${filename}`,
      });
      return;
    }

    const queueId = useLoadingQueueStore.getState().enqueue({
      type: 'file',
      path,
      displayName: filename,
    });

    try {
      useLoadingQueueStore.getState().startLoading(queueId);
      this.eventBus.emit('file.loading', { path });
      useLoadingQueueStore.getState().updateProgress(queueId, 10);

      const volumeHandle = await this.apiService.loadFile(path);
      useLoadingQueueStore.getState().updateProgress(queueId, 50);

      const addedLayer = await this.volumeLoadingService.loadVolume({
        volumeHandle,
        displayName: volumeHandle.name || filename,
        source: 'file',
        sourcePath: path,
        layerType: this.inferLayerType(filename),
        visible: true,
      });

      useLoadingQueueStore.getState().markComplete(queueId, {
        layerId: addedLayer.id,
        volumeId: volumeHandle.id,
      });

      this.eventBus.emit('file.loaded', { path, volumeId: volumeHandle.id });
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Loaded: ${filename}`,
      });

      console.log('[DisplayLifecycleOrchestrator] Volume load complete', {
        path,
        layerId: addedLayer.id,
        durationMs: performance.now() - startTime,
      });
    } catch (error) {
      useLoadingQueueStore.getState().markError(queueId, error as Error);
      this.eventBus.emit('file.error', { path, error: error as Error });
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `Failed to load ${filename}: ${(error as Error).message}`,
      });
    }
  }

  private async loadSurfaceOverlay(path: string, filename: string): Promise<void> {
    const surfaces = Array.from(useSurfaceStore.getState().surfaces.values());

    if (surfaces.length === 0) {
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: 'No surfaces loaded. Please load a surface first before applying overlays.',
      });
      return;
    }

    const targetSurfaceId =
      surfaces.length === 1
        ? surfaces[0].handle
        : useSurfaceStore.getState().activeSurfaceId || surfaces[0].handle;

    if (surfaces.length > 1) {
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Applying overlay to surface: ${surfaces.find((surface) => surface.handle === targetSurfaceId)?.name}`,
      });
    }

    try {
      const dataLayer = await surfaceOverlayService.loadSurfaceOverlay(path, targetSurfaceId);
      await surfaceOverlayService.applyOverlayToSurface(targetSurfaceId, dataLayer.id);
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Loaded overlay: ${filename}`,
      });
    } catch (error) {
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `Failed to load overlay ${filename}: ${(error as Error).message}`,
      });
    }
  }

  private inferLayerType(filename: string): Layer['type'] {
    const lower = filename.toLowerCase();
    if (lower.includes('mask') || lower.includes('label')) {
      return 'mask';
    }
    if (lower.includes('bold') || lower.includes('func') || lower.includes('task')) {
      return 'functional';
    }
    return 'anatomical';
  }
}

let displayLifecycleOrchestratorInstance: DisplayLifecycleOrchestrator | null = null;

export function getDisplayLifecycleOrchestrator(): DisplayLifecycleOrchestrator {
  if (!displayLifecycleOrchestratorInstance) {
    displayLifecycleOrchestratorInstance = DisplayLifecycleOrchestrator.getInstance();
  }
  return displayLifecycleOrchestratorInstance;
}

export function initializeDisplayLifecycleOrchestrator(): DisplayLifecycleOrchestrator {
  return getDisplayLifecycleOrchestrator();
}

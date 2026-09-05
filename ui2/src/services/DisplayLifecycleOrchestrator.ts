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

import { formatTauriError, toError } from '@/utils/formatTauriError';
import { fileLoadScheduler } from './LoadScheduler';
import { getEventBus, type EventBus } from '@/events/EventBus';
import { getApiService, type ApiService } from './apiService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { getVolumeLoadingService, type VolumeLoadingService } from './VolumeLoadingService';
import type { Layer } from '@/types/layers';
import { getSurfaceLoadingService, type SurfaceLoadingService } from './SurfaceLoadingService';
import { surfaceOverlayService, type SurfaceDataLayer } from './SurfaceOverlayService';
import { useSurfaceStore } from '@/stores/surfaceStore';
import {
  getActiveSurfaceCommandContext,
  resolveSurfaceTargetSurfaceId,
} from '@/utils/surfaceCommandContext';
import type { DisplayOpenIntent } from '@/types/loadIntent';
import { parseBidsFilename, formatBidsDisplayName } from '@/utils/bids';

export type DisplayLoadIngress =
  | 'file-browser'
  | 'drag-drop'
  | 'programmatic'
  | 'file-dialog';

export interface DisplayLoadRequest {
  path: string;
  ingress?: DisplayLoadIngress;
  intent?: DisplayOpenIntent;
}

type DisplayLoadRoute = 'surface-overlay' | 'surface' | 'volume';

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
    const intent = request.intent ?? 'default';

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
    const route = this.resolveLoadRoute(path, filename);

    console.log(`[DisplayLifecycleOrchestrator] loadFile (${ingress})`, { path, route, intent });

    switch (route) {
      case 'surface-overlay':
        await this.loadSurfaceOverlay(path, filename);
        return;
      case 'surface':
        await this.surfaceLoadingService.loadSurfaceFile({
          path,
          displayName: filename,
          autoActivate: true,
          validateMesh: true,
        });
        return;
      case 'volume':
        await this.loadVolumeForIntent(path, filename, startTime, intent);
        return;
    }
  }

  async retryVolumeLoad(
    path: string,
    intent: DisplayOpenIntent = 'default',
    workspaceId = useViewStateStore.getState().activeWorkspaceKey
  ): Promise<boolean> {
    const filename = this.extractFilename(path);
    const layer = await this.loadVolumeForIntent(path, filename, performance.now(), intent);
    return layer !== null;
  }

  async retrySurfaceOverlayLoad(path: string, targetSurfaceId: string): Promise<boolean> {
    const filename = this.extractFilename(path);
    const layer = await this.loadSurfaceOverlayToTarget(path, filename, targetSurfaceId);
    return layer !== null;
  }

  async loadDroppedFile(file: File, intent: DisplayOpenIntent = 'add-layer'): Promise<void> {
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
      intent,
    });
  }

  private initializeIngressListeners(): void {
    // Legacy double-click event (default intent)
    this.eventBus.on('filebrowser.file.doubleclick', ({ path }) => {
      void this.loadFile({
        path,
        ingress: 'file-browser',
      });
    });

    // New intent-aware open event from context menu
    this.eventBus.on('filebrowser.file.open', ({ path, intent }: { path: string; intent?: DisplayOpenIntent }) => {
      void this.loadFile({
        path,
        ingress: 'file-browser',
        intent: intent ?? 'default',
      });
    });
  }

  private async loadVolumeForIntent(
    path: string,
    filename: string,
    startTime: number,
    intent: DisplayOpenIntent
  ): Promise<Layer | null> {
    const requestedWorkspaceId = useViewStateStore.getState().activeWorkspaceKey;
    const workspaceStore = useWorkspaceStore.getState();
    const activeWorkspace = workspaceStore.activeWorkspaceId
      ? workspaceStore.getWorkspace(workspaceStore.activeWorkspaceId)
      : null;

    switch (intent) {
      case 'default':
      case 'add-layer': {
        const addedLayer = await this.loadVolume(path, filename, startTime, intent, requestedWorkspaceId);

        if (addedLayer && activeWorkspace?.type === 'comparison') {
          const { useComparisonStore } = await import('@/stores/comparisonStore');
          const { useLayerStore } = await import('@/stores/layerStore');
          const layerNames = new Map<string, string>();
          useLayerStore.getState().layers.forEach((layer) => {
            layerNames.set(layer.id, layer.name ?? layer.id);
          });
          useComparisonStore.getState().ensurePanelsForLayers(
            activeWorkspace.id,
            [addedLayer.id],
            layerNames
          );
        }
        return addedLayer;
      }

      case 'new-workspace': {
        await useWorkspaceStore.getState().createWorkspace('orthogonal-locked');
        return this.loadVolume(path, filename, startTime, intent);
      }

      case 'comparison': {
        const { useComparisonStore } = await import('@/stores/comparisonStore');
        const { useViewStateStore } = await import('@/stores/viewStateStore');
        const { useLayerStore } = await import('@/stores/layerStore');

        const sourceWorkspaceId = workspaceStore.activeWorkspaceId;
        const sourceLayerIds = sourceWorkspaceId
          ? useViewStateStore
              .getState()
              .getWorkspaceViewState(sourceWorkspaceId)
              .layers.map((layer) => layer.id)
          : [];
        const comparisonWorkspaceId = await this.ensureComparisonWorkspace();
        const addedLayer = await this.loadVolume(path, filename, startTime, intent);

        if (addedLayer) {
          const layerNames = new Map<string, string>();
          useLayerStore.getState().layers.forEach((layer) => {
            layerNames.set(layer.id, layer.name ?? layer.id);
          });
          useComparisonStore.getState().ensurePanelsForLayers(
            comparisonWorkspaceId,
            [...sourceLayerIds, addedLayer.id],
            layerNames
          );
        }
        return addedLayer;
      }
    }

    return null;
  }

  private async ensureComparisonWorkspace(): Promise<string> {
    const { useWorkspaceStore } = await import('@/stores/workspaceStore');
    const workspaceStore = useWorkspaceStore.getState();
    const existing = Array.from(workspaceStore.workspaces.values()).find(
      (workspace) => workspace.type === 'comparison'
    );

    if (existing) {
      workspaceStore.activateWorkspace(existing.id);
      return existing.id;
    }

    return workspaceStore.createWorkspace('comparison');
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

  private resolveLoadRoute(path: string, filename: string): DisplayLoadRoute {
    const giftiType = surfaceOverlayService.detectGiftiType(filename);
    const isOverlay = giftiType === 'overlay';
    const isSurface = !isOverlay && this.surfaceLoadingService.isSupportedSurfaceFile(path);

    const routeFlags: Record<DisplayLoadRoute, boolean> = {
      'surface-overlay': isOverlay,
      surface: isSurface,
      volume: !isOverlay && !isSurface,
    };

    const activeRoutes = (Object.entries(routeFlags) as Array<[DisplayLoadRoute, boolean]>)
      .filter(([, active]) => active)
      .map(([route]) => route);

    if (activeRoutes.length !== 1) {
      throw new Error(
        `[DisplayLifecycleOrchestrator] Route invariant violated for '${path}': expected exactly one route, got ${activeRoutes.join(', ') || 'none'}`
      );
    }

    return activeRoutes[0];
  }

  private async loadVolume(
    path: string,
    filename: string,
    startTime: number,
    intent: DisplayOpenIntent = 'default',
    workspaceId = useViewStateStore.getState().activeWorkspaceKey
  ): Promise<Layer | null> {
    if (useLoadingQueueStore.getState().isLoading(path)) {
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `File is already being loaded: ${filename}`,
      });
      return null;
    }

    const queueId = useLoadingQueueStore.getState().enqueue({
      type: 'volume-load',
      path,
      displayName: filename,
      retry: {
        kind: 'volume-load',
        path,
        intent,
      },
    });

    const release = await fileLoadScheduler.acquire();
    try {
      useLoadingQueueStore.getState().startLoading(queueId);
      this.eventBus.emit('file.loading', { path });
      useLoadingQueueStore.getState().updateProgress(queueId, undefined, 'Reading image');

      const volumeHandle = await this.apiService.loadFile(path);
      useLoadingQueueStore.getState().updateProgress(queueId, undefined, 'Preparing display');

      const addedLayer = await this.volumeLoadingService.loadVolume({
        volumeHandle,
        workspaceId,
        displayName: this.smartLayerName(volumeHandle.name || filename),
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
      return addedLayer;
    } catch (error) {
      if (/cancelled/i.test(formatTauriError(error))) {
        useLoadingQueueStore.getState().cancel(queueId);
        return null;
      }
      const failure = toError(error);
      useLoadingQueueStore.getState().markError(queueId, failure);
      this.eventBus.emit('file.error', { path, error: failure });
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `Failed to load ${filename}: ${failure.message}`,
      });
      return null;
    } finally {
      release();
    }
  }

  private async loadSurfaceOverlay(path: string, filename: string): Promise<void> {
    const surfaceState = useSurfaceStore.getState();
    const surfaces = Array.from(surfaceState.surfaces.values());

    if (surfaces.length === 0) {
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: 'No surfaces loaded. Please load a surface first before applying overlays.',
      });
      return;
    }

    const commandContext = getActiveSurfaceCommandContext();
    const targetSurfaceId =
      surfaces.length === 1
        ? surfaces[0].handle
        : resolveSurfaceTargetSurfaceId(commandContext, surfaceState.surfaces) || surfaces[0].handle;
    const targetSurface = surfaces.find((surface) => surface.handle === targetSurfaceId);

    if (!targetSurface) {
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: 'Unable to determine target surface for overlay application.',
      });
      return;
    }

    if (surfaces.length > 1) {
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Applying overlay to surface: ${targetSurface.name}`,
      });
    }

    await this.loadSurfaceOverlayToTarget(path, filename, targetSurfaceId);
  }

  private async loadSurfaceOverlayToTarget(
    path: string,
    filename: string,
    targetSurfaceId: string
  ): Promise<SurfaceDataLayer | null> {
    const queuePath = `surface-overlay-load:${targetSurfaceId}:${path}`;
    const queueStore = useLoadingQueueStore.getState();
    if (queueStore.isLoading(queuePath)) {
      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Overlay is already being applied: ${filename}`,
      });
      return null;
    }

    const queueId = queueStore.enqueue({
      type: 'surface-overlay-load',
      path: queuePath,
      displayName: filename,
      retry: {
        kind: 'surface-overlay-load',
        path,
        targetSurfaceId,
      },
    });

    try {
      queueStore.startLoading(queueId);
      queueStore.updateProgress(queueId, 10);

      const overlayLayer = await surfaceOverlayService.loadSurfaceOverlay(path, targetSurfaceId);
      queueStore.updateProgress(queueId, 85);
      queueStore.markComplete(queueId, {
        layerId: overlayLayer.id,
      });

      this.eventBus.emit('ui.notification', {
        type: 'info',
        message: `Loaded overlay: ${filename}`,
      });
      return overlayLayer;
    } catch (error) {
      const failure = toError(error);
      queueStore.markError(queueId, failure);
      this.eventBus.emit('ui.notification', {
        type: 'error',
        message: `Failed to load overlay ${filename}: ${failure.message}`,
      });
      return null;
    }
  }

  /** Attempt BIDS filename parsing for a human-readable layer name; fall back to raw filename. */
  private smartLayerName(filename: string): string {
    const parsed = parseBidsFilename(filename);
    return parsed ? formatBidsDisplayName(parsed) : filename;
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

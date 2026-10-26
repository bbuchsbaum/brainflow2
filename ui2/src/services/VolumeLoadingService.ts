/**
 * VolumeLoadingService - Unified service for loading volumes from any source
 * Ensures consistent behavior whether loading from file browser, templates, or other sources
 */

import { toError } from '@/utils/formatTauriError';
import { getEventBus, type EventBus } from '@/events/EventBus';
import { getApiService, type ApiService, type VolumeHandle } from './apiService';
import { useLayerStore } from '@/stores/layerStore';
import { useFileBrowserStore } from '@/stores/fileBrowserStore';
import { getLayerService, type LayerService, type LayerLoadContext } from './LayerService';
import type { Layer } from '@/types/layers';
import type { LayerInfo } from '@/stores/layerStore';
import { VolumeHandleStore } from './VolumeHandleStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ViewPlane } from '@/types/coordinates';
import type { VolumeBounds } from '@brainflow/api';
import { alignPlaneToCrosshair } from '@/stores/viewStateGeometry';
import { getLabelTableService } from './LabelTableService';
import { looksLikeSegmentation } from '@/utils/labelTable';
import { inferStatisticFromName } from '@/utils/statistic';

/**
 * Volumes worth checking for a label-table sidecar: label layers (by name or
 * NIfTI label intent) and integer-typed images.
 */
export function mayHaveLabelTable(
  type: Layer['type'],
  handle: Pick<VolumeHandle, 'dtype' | 'is_label_map'>,
): boolean {
  if (type === 'label' || handle.is_label_map) return true;
  return /^(u?int\d*|[ui]\d+)$/i.test(handle.dtype ?? '');
}

/**
 * Default crosshair for a newly loaded volume: the backend's voxel-centred
 * `center_voxel_world` (voxel `floor((dims - 1) / 2)`), falling back to the
 * geometric `center` for backends that do not send it.
 */
export function defaultCrosshairWorld(bounds: VolumeBounds): [number, number, number] {
  const voxelCentre = bounds.center_voxel_world;
  if (Array.isArray(voxelCentre) && voxelCentre.length === 3 && voxelCentre.every(Number.isFinite)) {
    return [voxelCentre[0], voxelCentre[1], voxelCentre[2]];
  }
  return [bounds.center[0], bounds.center[1], bounds.center[2]];
}

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
  workspaceId?: string;
  displayName: string;
  source: 'file' | 'template' | 'atlas' | 'other';
  sourcePath: string; // Original path or identifier
  layerType?: Layer['type'];
  visible?: boolean;
  atlasMetadata?: LayerInfo['atlasMetadata'];
  imageSetId?: string;
  replacement?: Pick<LayerLoadContext, 'replaceLayerId' | 'memberRender' | 'isCurrent' | 'beforeCommit' | 'afterCommit'>;
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

    const workspaceId = config.workspaceId ?? useViewStateStore.getState().activeWorkspaceKey;
    const startTime = performance.now();
    volumeDebugLog(
      `[VolumeLoadingService] Starting loadVolume with config:`,
      JSON.stringify(config),
    );
    const {
      volumeHandle,
      displayName,
      source,
      sourcePath,
      layerType,
      visible = true,
      atlasMetadata,
    } = config;

    volumeDebugLog(
      `[VolumeLoadingService ${startTime.toFixed(0)}ms] Loading volume from ${source}:`,
      {
        id: volumeHandle.id,
        name: displayName,
        path: sourcePath,
        dims: volumeHandle.dims,
        type: volumeHandle.volume_type,
      },
    );

    try {
      // 0. Dedup: if an atlas layer with the same metadata already exists, reuse it
      if (source === 'atlas' && atlasMetadata) {
        const existingLayers = useLayerStore.getState().layers;
        const duplicate = existingLayers.find(
          (l: any) =>
            l.source === 'atlas' &&
            l.sourcePath === sourcePath &&
            l.atlasMetadata?.id === atlasMetadata.id,
        );
        if (duplicate) {
          volumeDebugLog(`[VolumeLoadingService] Reusing existing atlas layer: ${duplicate.id}`);
          return duplicate as Layer;
        }
      }

      // 1. Store volume handle for future reference
      volumeDebugLog(
        `[VolumeLoadingService ${performance.now() - startTime}ms] Storing volume handle`,
      );
      VolumeHandleStore.setVolumeHandle(volumeHandle.id, volumeHandle);

      // 2. Kick off the two independent backend round trips concurrently.
      // get_volume_bounds and get_initial_views both only need the volume id
      // (the target pixel size comes from the view store, not from the bounds),
      // so awaiting them sequentially just stacks two IPC latencies on the
      // load-to-display critical path. Starting the initial-views fetch here
      // overlaps it with the bounds fetch. The promise swallows its own errors
      // so it can never become an unhandled rejection if the bounds step throws.
      const initialViewsPromise = this.prefetchInitialViews(volumeHandle);

      // 3. Get volume bounds from backend - CRITICAL for histogram
      volumeDebugLog(
        `[VolumeLoadingService ${performance.now() - startTime}ms] Getting volume bounds from backend`,
      );
      const volumeBounds = await this.getVolumeBounds(volumeHandle);

      if (!volumeBounds) {
        throw new Error('Failed to get volume bounds - this is required for proper visualization');
      }

      volumeDebugLog(
        `[VolumeLoadingService ${performance.now() - startTime}ms] Volume bounds received:`,
        {
          min: volumeBounds.min,
          max: volumeBounds.max,
          center: volumeBounds.center,
        },
      );

      // 3. Create layer object
      const currentLayerCount = useLayerStore.getState().layers.length;
      const layer: LayerInfo = {
        id: volumeHandle.id,
        name: displayName,
        volumeId: volumeHandle.id,
        // NIfTI intent 1002 (NIFTI_INTENT_LABEL) marks a label volume even
        // when its name does not.
        type:
          layerType ||
          (volumeHandle.is_label_map
            ? 'label'
            : // Infer from the file name, not the display name: BIDS display
              // names drop the entities that mark a label image
              // ("atlas-x_dseg.nii.gz" is shown as "Segmentation").
              this.inferLayerType(
                source === 'file' && sourcePath
                  ? (sourcePath.split(/[\\/]/).pop() ?? displayName)
                  : displayName,
                source,
              )),
        visible: visible,
        order: currentLayerCount,
        atlasMetadata,
        source,
        sourcePath,
        imageSetId: config.imageSetId,
        // Add 4D time series metadata
        volumeType: volumeHandle.volume_type === 'TimeSeries4D' ? 'TimeSeries4D' : 'Volume3D',
        timeSeriesInfo: volumeHandle.time_series_info
          ? {
              num_timepoints: volumeHandle.time_series_info.num_timepoints,
              tr: volumeHandle.time_series_info.tr,
              temporal_unit: volumeHandle.time_series_info.temporal_unit,
              acquisition_time: volumeHandle.time_series_info.acquisition_time,
            }
          : undefined,
        currentTimepoint: volumeHandle.current_timepoint || 0,
        // No intent in the header: FSL-style names (zstat/tstat) give a
        // marked guess ("z?"), never a silent statistic.
        statistic:
          volumeHandle.statistic ??
          (source === 'file' && sourcePath
            ? (inferStatisticFromName(sourcePath.split(/[\\/]/).pop() ?? '') ?? undefined)
            : undefined),
        isLabelMap: volumeHandle.is_label_map === true ? true : undefined,
      };

      if (source === 'file' && sourcePath) {
        useFileBrowserStore
          .getState()
          .markFourD(sourcePath, volumeHandle.volume_type === 'TimeSeries4D');
      }

      volumeDebugLog(
        `[VolumeLoadingService ${performance.now() - startTime}ms] Created layer object:`,
        layer,
      );

      // 4. Set layer metadata BEFORE adding layer - CRITICAL TIMING
      volumeDebugLog(
        `[VolumeLoadingService ${performance.now() - startTime}ms] Setting layer metadata with worldBounds`,
      );
      volumeDebugLog(`[VolumeLoadingService] DIAGNOSTIC - volumeHandle:`, {
        id: volumeHandle.id,
        name: volumeHandle.name,
        path: volumeHandle.path,
        dims: volumeHandle.dims,
        dtype: volumeHandle.dtype,
        volume_type: volumeHandle.volume_type,
      });
      volumeDebugLog(`[VolumeLoadingService] DIAGNOSTIC - layer:`, {
        id: layer.id,
        volumeId: layer.volumeId,
        source: source,
        sourcePath: sourcePath,
      });

      useLayerStore.getState().setLayerMetadata(layer.id, {
        worldBounds: {
          min: volumeBounds.min,
          max: volumeBounds.max,
        },
        source: source,
        sourcePath: sourcePath,
        loadedAt: new Date().toISOString(),
      });

      const newViews = await initialViewsPromise;
      if (!newViews || !['axial', 'coronal', 'sagittal'].every((view) => newViews[view])) {
        throw new Error('Unable to calculate initial volume views');
      }
      if (!useViewStateStore.getState().workspaceViewStates.has(workspaceId)) {
        throw new Error('The workspace that requested this volume has been closed');
      }

      // 7. Add layer through layer service
      volumeDebugLog(
        `[VolumeLoadingService ${performance.now() - startTime}ms] Adding layer through LayerService`,
      );

      // Set loading state for UI feedback (backward compatibility with LayerItem)
      useLayerStore.getState().setLayerLoading(layer.id, true);

      // Default placement is a voxel centre (`center_voxel_world`), not the
      // geometric centre, which falls on a voxel edge along even dimensions.
      // The initial planes come from get_initial_views through the geometric
      // centre, so slide each along its normal onto the default crosshair.
      const initialCrosshair = defaultCrosshairWorld(volumeBounds);
      const initialViews = newViews as import('@/types/viewState').ViewState['views'];
      for (const plane of Object.values(initialViews)) {
        alignPlaneToCrosshair(plane, initialCrosshair);
      }

      let addedLayer: Layer | undefined;
      try {
        addedLayer = await this.layerService!.addLayer(layer, {
          workspaceId,
          ...config.replacement,
          initialGeometry: {
            views: initialViews,
            crosshair: { world_mm: initialCrosshair, visible: true },
          },
        });
        this.eventBus!.emit('volume.loaded', {
          volumeId: volumeHandle.id,
          metadata: volumeHandle,
        });

        // A label/integer volume with a label-table sidecar (BIDS dseg.tsv,
        // FreeSurfer LUT) gets a discrete colour table and region names.
        // Non-fatal: without a sidecar the layer keeps its plain rendering.
        if (source === 'file' && sourcePath && mayHaveLabelTable(addedLayer.type, volumeHandle)) {
          try {
            const table = await getLabelTableService().applySidecar(addedLayer.id, sourcePath);
            // A declared label map without a table still renders as
            // categories (generated colours, ids as names).
            const maxLabel = useLayerStore.getState().layerMetadata.get(addedLayer.id)?.dataRange?.max;
            if (!table && volumeHandle.is_label_map && typeof maxLabel === 'number') {
              await getLabelTableService().applyGeneratedPalette(addedLayer.id, maxLabel);
            }
          } catch (error) {
            console.warn('[VolumeLoadingService] Label table sidecar failed (non-fatal):', error);
          }
        }

        // 8. Readiness/mapping is handled in LayerApiImpl request path.
        // Avoid forced flush here to keep initial load/render scheduling smooth.
        volumeDebugLog(
          `[VolumeLoadingService ${performance.now() - startTime}ms] Backend readiness handshake completed`,
        );

        // 9. Verify layer was added and selected
        const state = useLayerStore.getState();
        volumeDebugLog(
          `[VolumeLoadingService ${performance.now() - startTime}ms] Post-addition state:`,
          {
            totalLayers: state.layers.length,
            selectedLayerId: state.selectedLayerId,
            layerMetadata: state.layerMetadata.has(addedLayer.id),
            // NOTE: layerRender has been moved to ViewState
          },
        );

        // 10. Emit completion event
        this.eventBus!.emit('volume.load.complete', {
          volumeId: volumeHandle.id,
          layerId: addedLayer.id,
          source: source,
          duration: performance.now() - startTime,
        });

        volumeDebugLog(
          `[VolumeLoadingService ${performance.now() - startTime}ms] Volume loading complete`,
        );

        return addedLayer;
      } catch (layerError) {
        // Handle layer addition or GPU allocation errors
        console.error(
          `[VolumeLoadingService] Failed to add layer or allocate GPU resources for ${displayName}:`,
          layerError,
        );
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
        useLayerStore.getState().clearLayerMetadata?.(volumeHandle.id);
      } catch (cleanupError) {
        console.error('[VolumeLoadingService] Cleanup error:', cleanupError);
      }

      try {
        await this.apiService!.unloadVolume(volumeHandle.id);
      } catch (cleanupError) {
        console.warn('[VolumeLoadingService] Failed to unload provisional volume:', cleanupError);
      }

      // Preserve structured bridge details in the log, Activity and callers.
      const failure = toError(error);
      this.eventBus!.emit('volume.load.error', {
        volumeId: volumeHandle.id,
        source: source,
        error: failure,
      });

      throw failure;
    }
  }

  /**
   * Get volume bounds from backend with error handling
   */
  private async getVolumeBounds(volumeHandle: VolumeHandle): Promise<VolumeBounds> {
    const bounds = await this.apiService!.getVolumeBounds(volumeHandle.id);
    if (![bounds.min, bounds.max, bounds.center].every((v) => v.length === 3 && v.every(Number.isFinite)) ||
        bounds.min.some((value, axis) => value > bounds.max[axis])) {
      throw new Error('Volume has invalid world-space bounds');
    }
    return bounds;
  }

  /**
   * Computes the target pixel size from the current view store and starts the
   * backend get_initial_views request, so it can run concurrently with the
   * bounds fetch. Errors are swallowed (resolving to null) so the returned
   * promise is always safe to leave un-awaited until initializeViews consumes
   * it; on failure initializeViews falls back to a direct fetch.
   */
  private prefetchInitialViews(
    volumeHandle: VolumeHandle,
  ): Promise<Record<string, ViewPlane> | null> {
    try {
      const maxPx = this.computeInitialViewsMaxPx();
      return this.apiService!.getInitialViews(volumeHandle.id, maxPx).catch((error) => {
        console.error('[VolumeLoadingService] Failed to prefetch initial views:', error);
        return null;
      });
    } catch (error) {
      console.error('[VolumeLoadingService] Failed to start initial views prefetch:', error);
      return Promise.resolve(null);
    }
  }

  /**
   * Derives the maximum pixel dimensions across the three orthogonal views from
   * the view store, used as the target size for backend-calculated views.
   */
  private computeInitialViewsMaxPx(): [number, number] {
    const currentViews = useViewStateStore.getState().viewState.views;
    const axialDims = currentViews.axial.dim_px;
    const sagittalDims = currentViews.sagittal.dim_px;
    const coronalDims = currentViews.coronal.dim_px;

    const maxWidth = Math.max(axialDims[0], sagittalDims[0], coronalDims[0]);
    const maxHeight = Math.max(axialDims[1], sagittalDims[1], coronalDims[1]);
    return [maxWidth || 512, maxHeight || 512];
  }

  /**
   * Infer layer type from name and source
   */
  private inferLayerType(name: string, source: string): Layer['type'] {
    return inferLayerTypeFromName(name, source);
  }
}

export { looksLikeSegmentation } from '@/utils/labelTable';

/**
 * Infer a layer type from a volume's name and load source. Discrete
 * segmentation/atlas/parcellation files resolve to 'label' so they render with
 * nearest sampling instead of being trilinearly averaged into garbage.
 */
export function inferLayerTypeFromName(name: string, source: string): Layer['type'] {
  const lower = name.toLowerCase();

  if (source === 'template') {
    // Template-specific inference
    if (lower.includes('mask') || lower.includes('brain')) {
      return 'mask';
    } else if (lower.includes('gray') || lower.includes('white') || lower.includes('csf')) {
      return 'mask'; // Tissue probability maps
    }
    return 'anatomical'; // T1w, T2w, etc.
  }

  // File-based inference
  if (looksLikeSegmentation(lower)) {
    return 'label'; // discrete region IDs -> nearest sampling, no averaging
  }
  if (lower.includes('mask')) {
    return 'mask';
  }
  if (lower.includes('bold') || lower.includes('func') || lower.includes('task')) {
    return 'functional';
  }
  return 'anatomical';
}

// Export convenience function
export function getVolumeLoadingService(): VolumeLoadingService {
  return VolumeLoadingService.getInstance();
}

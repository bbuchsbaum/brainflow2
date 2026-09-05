/**
 * LayerApiImpl - Backend implementation of LayerApi
 * Connects LayerService to Tauri backend commands
 */

import type { LayerApi, LayerLoadContext } from './LayerService';
import type { Layer, LayerRender } from '@/types/layers';
import { getApiService } from './apiService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ViewLayer } from '@/types/viewState';
import { VolumeHandleStore } from './VolumeHandleStore';
import type { LayerInfo, VolumeMetadata } from '@/stores/layerStore';
import { colormapNameToId } from '@/components/ui/colormapOptions';
import { histogramService } from './HistogramService';
import {
  computeAdaptiveIntensityRange,
  computeFallbackIntensityRange,
  type IntensityRangeOptions,
} from './IntensityRangeComputer';
import { getEventBus } from '@/events/EventBus';
import { layerEvictionService } from './LayerEvictionService';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { useComparisonStore } from '@/stores/comparisonStore';

const DEBUG_LAYER_API =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.localStorage.getItem('brainflow2-debug-layer-api') === 'true';

const layerDebugLog = (...args: unknown[]) => {
  if (DEBUG_LAYER_API) {
    console.log(...args);
  }
};

export class LayerApiImpl implements LayerApi {
  private apiService = getApiService();

  private buildLayerMetadata(
    existingMetadata: Partial<VolumeMetadata>,
    gpuInfo: any,
    renderProps: LayerRender | undefined,
    gpuResident: boolean,
  ): VolumeMetadata {
    return {
      ...existingMetadata,
      dataRange: gpuInfo.data_range ?? existingMetadata.dataRange,
      centerWorld: gpuInfo.center_world,
      isBinaryLike: gpuInfo.is_binary_like,
      dimensions: gpuInfo.dim,
      spacing: gpuInfo.spacing,
      origin: gpuInfo.origin,
      voxelToWorld: gpuInfo.voxel_to_world,
      worldToVoxel: gpuInfo.world_to_voxel,
      dataType: gpuInfo.tex_format,
      renderProps: renderProps ?? existingMetadata.renderProps,
      gpuResident,
      evicted: gpuResident ? false : Boolean(existingMetadata.evicted),
    };
  }

  private async reconcileGpuResidency(layerId: string): Promise<void> {
    layerEvictionService.touchLayer(layerId);
    await layerEvictionService.checkAndEvict();
  }

  private async ensureGpuResidentForLayer(id: string): Promise<void> {
    const layer = useLayerStore.getState().getLayer(id);
    if (!layer) {
      return;
    }

    const existingMetadata = useLayerStore.getState().getLayerMetadata(id);
    if (existingMetadata?.gpuResident !== false) {
      return;
    }

    const gpuInfo = await this.apiService.requestLayerGpuResources(id, layer.volumeId, false);

    try {
      const isReady = await this.apiService.waitForLayerReady(id, 500, 20);
      if (!isReady) {
        console.warn(`[LayerApiImpl] Backend readiness timed out for promoted layer ${id}`);
      }
    } catch (readinessError) {
      console.warn(
        `[LayerApiImpl] Readiness probe unavailable for promoted layer ${id}`,
        readinessError,
      );
    }

    const nextMetadata = this.buildLayerMetadata(
      existingMetadata ?? {},
      gpuInfo,
      existingMetadata?.renderProps,
      true,
    );
    useLayerStore.getState().setLayerMetadata(id, nextMetadata);
    getEventBus().emit('layer.gpu.ready', { layerId: id });
  }

  private toViewLayer(layer: Layer): ViewLayer {
    const layerMetadata = useLayerStore.getState().getLayerMetadata(layer.id);
    const existing = useViewStateStore
      .getState()
      .viewState.layers.find((item) => item.id === layer.id);
    if (existing) {
      return {
        ...existing,
        name: layer.name,
        volumeId: layer.volumeId,
        visible: layer.visible,
      };
    }

    const dataRange = layerMetadata?.dataRange;
    const defaultMin = dataRange?.min ?? 0;
    const defaultMax = dataRange?.max ?? 100;
    const isLabelLike = layer.type === 'label' || layerMetadata?.source === 'atlas';
    const metadataRenderProps = (layerMetadata as any)?.renderProps as LayerRender | undefined;
    const intensity: [number, number] = metadataRenderProps?.intensity ?? [defaultMin, defaultMax];
    const threshold: [number, number] = metadataRenderProps?.threshold ?? [
      isLabelLike ? 0 : defaultMin,
      isLabelLike ? 0 : defaultMin,
    ];

    return {
      id: layer.id,
      name: layer.name,
      volumeId: layer.volumeId,
      visible: layer.visible,
      opacity: layer.visible ? (metadataRenderProps?.opacity ?? 1.0) : 0.0,
      colormap: metadataRenderProps?.colormap ?? 'gray',
      intensity,
      threshold,
      blendMode: 'alpha',
      interpolation: metadataRenderProps?.interpolation ?? (isLabelLike ? 'nearest' : 'linear'),
      layerMode:
        metadataRenderProps?.layerMode ??
        (layer.type === 'mask' ? 'mask' : isLabelLike ? 'label' : 'scalar'),
    };
  }

  private upsertViewLayer(layer: Layer, context?: LayerLoadContext): void {
    const nextLayer = this.toViewLayer(layer);
    useViewStateStore.getState().setViewState((state) => {
      const existingIndex = state.layers.findIndex((item) => item.id === nextLayer.id);
      if (existingIndex >= 0) {
        state.layers[existingIndex] = nextLayer;
        return;
      }
      if (state.layers.length === 0 && context?.initialGeometry) {
        state.views = context.initialGeometry.views;
        state.crosshair = context.initialGeometry.crosshair;
      }
      state.layers.push(nextLayer);
    }, context?.workspaceId);
  }

  private removeViewLayer(id: string): void {
    const store = useViewStateStore.getState();
    for (const workspaceId of store.workspaceViewStates.keys()) {
      store.setViewState((state) => {
        state.layers = state.layers.filter((layer) => layer.id !== id);
      }, workspaceId);
    }
  }

  private setViewLayerVisibility(id: string, visible: boolean): void {
    useViewStateStore.getState().setViewState((state) => {
      const layer = state.layers.find((item) => item.id === id);
      if (!layer) {
        return;
      }
      layer.visible = visible;
      layer.opacity = visible ? 1.0 : 0.0;
    });
  }

  private reorderViewLayers(layerIds: string[]): void {
    useViewStateStore.getState().setViewState((state) => {
      const order = new Map(layerIds.map((id, index) => [id, index]));
      state.layers.sort((left, right) => {
        const leftIndex = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      });
    });
  }

  async addLayer(layer: Omit<Layer, 'id'>, context?: LayerLoadContext): Promise<Layer> {
    const workspaceId = useViewStateStore.getState().activeWorkspaceKey;
    context ??= workspaceId === undefined ? undefined : { workspaceId };
    const addLayerStartTime = performance.now();
    layerDebugLog(
      `[LayerApiImpl ${addLayerStartTime.toFixed(0)}ms] addLayer called with:`,
      JSON.stringify(layer),
    );

    // Use volumeId as layer id for now
    const newLayer: Layer = {
      ...layer,
      id: layer.volumeId,
    };
    layerDebugLog(
      `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Created layer with id=${newLayer.id}`,
    );

    // Request GPU resources for the layer FIRST
    // Hidden layers only fetch metadata on initial load; visible layers allocate full GPU resources.
    layerDebugLog(
      `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Starting GPU resource allocation for layer ${newLayer.id}, volume ${newLayer.volumeId}`,
    );
    const gpuStartTime = performance.now();
    const metadataOnly = !newLayer.visible;

    // Declare renderProps outside try block so it's accessible throughout the function
    let renderProps: LayerRender | undefined;
    // [perf] Hoisted so the background histogram refinement can run after the
    // layer is committed (off the first-pixel path).
    let rangeOptions: IntensityRangeOptions | undefined;

    try {
      const gpuInfo = await this.apiService.requestLayerGpuResources(
        newLayer.id,
        newLayer.volumeId,
        metadataOnly,
      );
      const gpuElapsed = performance.now() - gpuStartTime;
      layerDebugLog(
        `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] GPU resources allocated in ${gpuElapsed.toFixed(0)}ms:`,
        JSON.stringify(gpuInfo),
      );

      if (!metadataOnly) {
        try {
          const isReady = await this.apiService.waitForLayerReady(newLayer.id, 500, 20);
          if (!isReady) {
            console.warn(
              `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Backend readiness timed out for layer ${newLayer.id}; continuing with best effort`,
            );
          }
        } catch (readinessError) {
          console.warn(
            `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Readiness probe unavailable for layer ${newLayer.id}; continuing`,
            readinessError,
          );
        }
        getEventBus().emit('layer.gpu.ready', { layerId: newLayer.id });
      }

      const earlyMetadata = useLayerStore.getState().getLayerMetadata(newLayer.id) || {};
      const isLabelLike = newLayer.type === 'label';
      const dataRange = gpuInfo.data_range ?? { min: 0, max: 100 };
      rangeOptions = {
        layerType: newLayer.type,
        source: (earlyMetadata as any).source,
        isBinaryLike: gpuInfo.is_binary_like,
        dataRange,
      };

      // [perf] Use the synchronous fallback range so the layer can be committed
      // and the first slice rendered immediately. For visible layers the
      // histogram-derived adaptive range (a full-volume backend scan, ~26ms +
      // IPC) is computed in the background and applied as a refinement once the
      // layer is on screen (see refineIntensityFromHistogram). It used to be
      // awaited here, which put a 34MB clone + full scan on the first-pixel path.
      const rangeResult = computeFallbackIntensityRange(rangeOptions);

      renderProps = {
        opacity: newLayer.visible ? 1.0 : 0.0,
        intensity: rangeResult.intensity,
        threshold: rangeResult.threshold,
        colormap: rangeResult.suggestedColormap ?? 'gray',
        interpolation: isLabelLike ? 'nearest' : 'linear',
        layerMode: newLayer.type === 'mask' ? 'mask' : isLabelLike ? 'label' : 'scalar',
      };

      if (earlyMetadata.source === 'parcel-table' && earlyMetadata.renderProps) {
        renderProps = { ...earlyMetadata.renderProps };
        rangeOptions = undefined; // Table ranges are per parcel, not per voxel.
      }

      layerDebugLog(
        `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Created render properties:`,
        JSON.stringify(renderProps),
      );

      if (context && !useViewStateStore.getState().workspaceViewStates.has(context.workspaceId)) {
        throw new Error('The workspace that requested this volume has been closed');
      }
      if (context?.isCurrent && !context.isCurrent()) throw new Error('Image selection cancelled');
      if (context?.replaceLayerId && !useLayerStore.getState().getLayer(context.replaceLayerId)) {
        throw new Error('The image set was removed while loading');
      }
      context?.beforeCommit?.();
      const metadata = this.buildLayerMetadata(earlyMetadata, gpuInfo, renderProps, !metadataOnly);
      layerDebugLog(
        `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Setting layer metadata:`,
        JSON.stringify(metadata),
      );
      useLayerStore.getState().setLayerMetadata(newLayer.id, metadata);
    } catch (error) {
      const elapsed = performance.now() - addLayerStartTime;
      console.error(`[LayerApiImpl ${elapsed}ms] Failed to allocate GPU resources:`, error);
      try {
        await this.apiService.releaseLayerGpuResources(newLayer.id);
      } catch (cleanupError) {
        console.warn('[LayerApiImpl] Failed to release provisional GPU resources:', cleanupError);
      }
      throw error;
    }

    // Only add layer after GPU resources are ready and metadata is present.
    // Then project both stores directly from this API call.
    layerDebugLog(
      `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Adding layer to store with render properties`,
    );

    const stateBefore = useLayerStore.getState().layers.length;
    const viewStateBefore = useViewStateStore.getState().viewState.layers.length;
    layerDebugLog(
      `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] State before addLayer:`,
    );
    layerDebugLog(`  - layerStore: ${stateBefore} layers`);
    layerDebugLog(`  - viewStateStore: ${viewStateBefore} layers`);

    // Add to layer store first.
    if (context?.replaceLayerId) {
      this.publishReplacement(context.replaceLayerId, newLayer, context);
    } else {
      useLayerStore.getState().addLayer(newLayer);
      this.upsertViewLayer(newLayer, context);
    }
    context?.afterCommit?.(newLayer);

    const stateAfter = useLayerStore.getState().layers.length;
    const viewStateAfter = useViewStateStore.getState().viewState.layers.length;
    layerDebugLog(
      `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] State after addLayer:`,
    );
    layerDebugLog(`  - layerStore: ${stateAfter} layers (was ${stateBefore})`);
    layerDebugLog(`  - viewStateStore: ${viewStateAfter} layers (was ${viewStateBefore})`);

    layerDebugLog(
      `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] Current layers in layerStore:`,
      useLayerStore.getState().layers.map((layer: LayerInfo) => ({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
      })),
    );

    // [perf] Refine the intensity window from the histogram in the background so
    // it never blocks the first paint. Fire-and-forget; on failure the layer
    // keeps the synchronous fallback range it was committed with.
    if (!metadataOnly && rangeOptions && !context?.memberRender?.[context.workspaceId]) {
      this.refineIntensityFromHistogram(newLayer, rangeOptions, context?.workspaceId).catch((err) =>
        console.warn(
          `[LayerApiImpl] Background intensity refinement failed for ${newLayer.id}:`,
          err,
        ),
      );
    }

    if (!metadataOnly) {
      await this.reconcileGpuResidency(newLayer.id).catch((error) => {
        console.warn('[LayerApiImpl] Post-load residency reconciliation failed:', error);
      });
    }

    if (context?.replaceLayerId) {
      // Rendering already points at the replacement. Retire the old allocation only now.
      await this.removeLayer(context.replaceLayerId).catch((error) => {
        console.warn('[LayerApiImpl] Could not retire the previous image-set member:', error);
      });
    }

    layerDebugLog(
      `[LayerApiImpl ${performance.now() - addLayerStartTime}ms] addLayer completed in ${(performance.now() - addLayerStartTime).toFixed(0)}ms`,
    );
    return newLayer;
  }

  private publishReplacement(oldId: string, next: Layer, context: LayerLoadContext): void {
    const previous = useLayerStore.getState().getLayer(oldId)!;
    next.visible = previous.visible;
    next.order = previous.order;
    const defaults = this.toViewLayer(next);
    const selection = useInspectorSelectionStore.getState();
    const wasSelected = selection.activeItemId === oldId;
    useLayerStore.getState().replaceLayer(oldId, next);
    const views = useViewStateStore.getState();
    for (const [workspaceId, state] of views.workspaceViewStates) {
      if (!state.layers.some((layer) => layer.id === oldId)) continue;
      views.setViewState((draft) => {
        const index = draft.layers.findIndex((layer) => layer.id === oldId);
        if (index < 0) return;
        const old = draft.layers[index];
        draft.layers[index] = {
          ...defaults,
          ...context.memberRender?.[workspaceId],
          id: next.id,
          volumeId: next.volumeId,
          name: next.name,
          visible: old.visible,
          opacity: old.opacity,
          order: old.order,
        };
      }, workspaceId);
    }
    useComparisonStore.getState().replaceLayer(oldId, next.id);
    if (wasSelected) useInspectorSelectionStore.setState({ activeItemId: next.id });
  }

  /**
   * [perf] Computes the histogram-derived adaptive intensity window off the
   * first-pixel path and applies it to an already-committed, on-screen layer.
   *
   * The layer renders first with the cheap fallback range; this refinement then
   * narrows the window once the (full-volume) histogram scan returns. It patches
   * the view-state layer's render fields directly because `toViewLayer` reuses
   * the existing view layer's render props on re-upsert, so re-projecting would
   * not pick up the new values.
   */
  private async refineIntensityFromHistogram(
    layer: Layer,
    rangeOptions: IntensityRangeOptions,
    workspaceId = useViewStateStore.getState().activeWorkspaceKey,
  ): Promise<void> {
    const target = () => {
      const state = useViewStateStore.getState();
      return workspaceId === undefined ? state.viewState : state.workspaceViewStates.get(workspaceId);
    };
    const initial = target()?.layers.find((item) => item.id === layer.id);
    if (!initial) return;
    const initialRender = JSON.stringify(initial);
    // Guard both immutable store edits and external mutation of render arrays.
    let histogram;
    try {
      histogram = await histogramService.computeHistogram({
        layerId: layer.id,
        binCount: 256,
        excludeZeros: true,
      });
    } catch (histError) {
      console.warn(
        `[LayerApiImpl] Histogram unavailable for ${layer.id}, keeping fallback intensity:`,
        histError,
      );
      return;
    }

    // The layer may have been removed while the histogram was computing.
    const store = useLayerStore.getState();
    if (!store.getLayer(layer.id) || JSON.stringify(target()?.layers.find((item) => item.id === layer.id)) !== initialRender) {
      return;
    }

    const rangeResult = computeAdaptiveIntensityRange(histogram, rangeOptions);
    const isLabelLike = layer.type === 'label';
    const refined: LayerRender = {
      opacity: layer.visible ? 1.0 : 0.0,
      intensity: rangeResult.intensity,
      threshold: rangeResult.threshold,
      colormap: rangeResult.suggestedColormap ?? 'gray',
      interpolation: isLabelLike ? 'nearest' : 'linear',
      layerMode: layer.type === 'mask' ? 'mask' : isLabelLike ? 'label' : 'scalar',
    };

    const meta = store.getLayerMetadata(layer.id);
    if (meta) {
      store.setLayerMetadata(layer.id, { ...meta, renderProps: refined });
    }
    this.applyViewLayerRender(layer.id, refined, workspaceId);
    layerDebugLog(
      `[LayerApiImpl] Refined intensity from histogram (${rangeResult.method}) for ${layer.id}:`,
      rangeResult.intensity,
    );
  }

  /**
   * Patches the render fields of an existing view-state layer in place. Used by
   * the background histogram refinement; mirrors the in-place mutation pattern of
   * setViewLayerVisibility.
   */
  private applyViewLayerRender(id: string, render: LayerRender, workspaceId?: string): void {
    useViewStateStore.getState().setViewState((state) => {
      const layer = state.layers.find((item) => item.id === id);
      if (!layer) {
        return;
      }
      layer.intensity = render.intensity;
      layer.threshold = render.threshold;
      if (render.colormap) {
        layer.colormap = render.colormap;
      }
      if (render.interpolation) {
        layer.interpolation = render.interpolation;
      }
      if (render.layerMode) {
        layer.layerMode = render.layerMode;
      }
    }, workspaceId);
  }

  async removeLayer(id: string): Promise<void> {
    const layer = useLayerStore.getState().getLayer(id);
    const volumeId = layer?.volumeId ?? id;
    const displayName = layer?.name ?? volumeId;
    const queuePath = `volume-unload:${volumeId}`;
    const queueStore = useLoadingQueueStore.getState();

    if (queueStore.isLoading(queuePath)) {
      return;
    }

    const queueId = queueStore.enqueue({
      type: 'volume-unload',
      path: queuePath,
      displayName,
      retry: {
        kind: 'volume-unload',
        layerId: id,
      },
    });

    try {
      queueStore.startLoading(queueId);
      queueStore.updateProgress(queueId, 10);

      // Release GPU resources first
      await this.apiService.releaseLayerGpuResources(id);
      queueStore.updateProgress(queueId, 45);

      // Best-effort volume-registry cleanup for symmetric unload flow.
      try {
        await this.apiService.unloadVolume(volumeId);
      } catch (error) {
        console.warn(`[LayerApiImpl] unloadVolume failed for ${volumeId}:`, error);
      }

      queueStore.updateProgress(queueId, 85);
      VolumeHandleStore.clearVolumeHandle(volumeId);

      // Remove from both stores explicitly.
      useLayerStore.getState().removeLayer(id);
      this.removeViewLayer(id);
      queueStore.markComplete(queueId);
    } catch (error) {
      queueStore.markError(
        queueId,
        error instanceof Error ? error : new Error('Failed to remove volume'),
      );
      throw error;
    }
  }

  async updateLayer(id: string, updates: Partial<Layer>): Promise<Layer> {
    // For now, layer metadata is managed on frontend only
    // Backend only cares about render properties

    // If visibility changed, update opacity
    if ('visible' in updates) {
      if (updates.visible) {
        await this.ensureGpuResidentForLayer(id);
      }
      await this.patchLayerRender(id, {
        opacity: updates.visible ? 1.0 : 0.0,
      });
      this.setViewLayerVisibility(id, updates.visible ?? true);
      if (updates.visible) {
        await this.reconcileGpuResidency(id);
      }
    }

    // Return the updated layer (frontend manages the actual state)
    return { id, ...updates } as Layer;
  }

  async patchLayerRender(id: string, patch: Partial<LayerRender>): Promise<void> {
    // Map frontend render properties to backend format
    const backendPatch: Record<string, any> = {};

    if ('opacity' in patch) {
      backendPatch.opacity = patch.opacity;
    }

    if ('intensity' in patch) {
      // Use snake_case for Rust backend
      backendPatch.intensity_min = patch.intensity![0];
      backendPatch.intensity_max = patch.intensity![1];
    }

    if ('threshold' in patch) {
      // Use snake_case for Rust backend
      backendPatch.threshold_low = patch.threshold![0];
      backendPatch.threshold_high = patch.threshold![1];
    }

    if ('colormap' in patch) {
      // Resolve to the backend BuiltinColormap id via the shared canonical map.
      backendPatch.colormap_id = colormapNameToId(patch.colormap);
      layerDebugLog(
        `[LayerApiImpl] Mapping colormap '${patch.colormap}' to ID ${backendPatch.colormap_id}`,
      );
    }

    // Guard against empty patches
    if (Object.keys(backendPatch).length === 0) {
      console.warn('[LayerApiImpl] Skipping empty patch for layer:', id);
      return;
    }

    // Log the patch being sent for debugging
    layerDebugLog('[LayerApiImpl] Sending patch to backend:', { id, backendPatch });

    // Send patch to backend
    await this.apiService.patchLayer(id, backendPatch);
  }

  async reorderLayers(layerIds: string[]): Promise<void> {
    // Backend doesn't currently support explicit ordering
    // This would need to be implemented in the render loop
    // For now, just log the intended order
    layerDebugLog('Layer order update requested:', layerIds);
    const layerById = new Map<string, LayerInfo>(
      useLayerStore.getState().layers.map((layer: LayerInfo) => [layer.id, layer]),
    );
    const ordered: LayerInfo[] = layerIds
      .map((id, index) => {
        const layer = layerById.get(id);
        if (!layer) {
          return undefined;
        }
        return { ...layer, order: index };
      })
      .filter((layer): layer is LayerInfo => layer !== undefined);

    const covered = new Set(ordered.map((layer) => layer.id));
    const tail: LayerInfo[] = useLayerStore
      .getState()
      .layers.filter((layer: LayerInfo) => !covered.has(layer.id))
      .map((layer: LayerInfo, index: number) => ({ ...layer, order: ordered.length + index }));

    useLayerStore.getState().reorderLayers([...ordered, ...tail]);
    this.reorderViewLayers(layerIds);
  }

  async loadLayerData(id: string): Promise<void> {
    const layer = useLayerStore.getState().getLayer(id);
    if (!layer) {
      throw new Error(`Layer not found: ${id}`);
    }

    layerDebugLog('Layer data request for:', id);
    await this.ensureGpuResidentForLayer(id);
    await this.reconcileGpuResidency(id);
  }
}

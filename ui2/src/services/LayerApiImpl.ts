/**
 * LayerApiImpl - Backend implementation of LayerApi
 * Connects LayerService to Tauri backend commands
 */

import type { StatisticInfo } from '@brainflow/api';
import type { LayerApi, LayerLoadContext } from './LayerService';
import type { Layer, LayerRender } from '@/types/layers';
import { getApiService } from './apiService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ViewLayer } from '@/types/viewState';
import { layerFrameBoxes } from './layerFrameBoxes';
import { edgeBoxFromAffine, type WorldBox } from '@/utils/worldFrame';
import { VolumeHandleStore } from './VolumeHandleStore';
import type { LayerInfo, VolumeMetadata } from '@/stores/layerStore';
import { colormapNameToId } from '@/components/ui/colormapOptions';
import { histogramService } from './HistogramService';
import type { HistogramData } from '@/types/histogram';
import { pooledWindow, runGroupIds, shareRunWindow } from './series/runWindow';
import {
  computeAdaptiveIntensityRange,
  computeFallbackIntensityRange,
  computePercentileFromBins,
  statisticDefaultRange,
  statisticDefaultRangeFromHistogram,
  type IntensityRangeOptions,
} from './IntensityRangeComputer';
import { getEventBus } from '@/events/EventBus';
import { layerEvictionService } from './LayerEvictionService';
import { useLoadingQueueStore } from '@/stores/loadingQueueStore';
import { useInspectorSelectionStore, focusVolumeLayer } from '@/stores/inspectorSelectionStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';
import { useSeriesStore } from '@/stores/seriesStore';
import { planLayerPlacement, placementOrder } from './layerPlacement';

const DEBUG_LAYER_API =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.localStorage.getItem('brainflow2-debug-layer-api') === 'true';

const layerDebugLog = (...args: unknown[]) => {
  if (DEBUG_LAYER_API) {
    console.log(...args);
  }
};

/** The statistic the loader attached (VolumeLoadingService), if any. */
function statisticOf(layer: object): StatisticInfo | undefined {
  return (layer as { statistic?: StatisticInfo }).statistic;
}

/** Layers whose first paint used the statistic default (never refined). */
const statisticFirstPaint = new Set<string>();

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

    // The layer may be removed while it is promoted: its new lease must not
    // outlive it, and its metadata must not be written back.
    const removal = this.removalSeq.get(id) ?? 0;
    const removed = () =>
      (this.removalSeq.get(id) ?? 0) !== removal || !useLayerStore.getState().getLayer(id);
    const discardIfRemoved = async (): Promise<boolean> => {
      if (!removed()) return false;
      // A layer re-added under the same id owns the lease now; keep it.
      if (!useLayerStore.getState().getLayer(id)) {
        await this.apiService.releaseLayerGpuResources(id).catch((error) => {
          console.warn(`[LayerApiImpl] Could not release the lease of removed layer ${id}:`, error);
        });
      }
      return true;
    };

    const gpuInfo = await this.apiService.requestLayerGpuResources(id, layer.volumeId, false);
    if (await discardIfRemoved()) return;

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
    if (await discardIfRemoved()) return;

    const currentMetadata = useLayerStore.getState().getLayerMetadata(id) ?? existingMetadata;
    const nextMetadata = this.buildLayerMetadata(
      currentMetadata ?? {},
      gpuInfo,
      currentMetadata?.renderProps,
      true,
    );
    useLayerStore.getState().setLayerMetadata(id, nextMetadata);
    getEventBus().emit('layer.gpu.ready', { layerId: id });
  }

  private toViewLayer(layer: Layer): ViewLayer {
    const layerMetadata = useLayerStore.getState().getLayerMetadata(layer.id);
    // The store's visibility wins over the object captured at load: a run the
    // Series view hid while it was still loading must not be added visible
    // (native R2-2: run 2 drawn over the focused run 1).
    const visible = useLayerStore.getState().getLayer(layer.id)?.visible ?? layer.visible;
    const existing = useViewStateStore
      .getState()
      .viewState.layers.find((item) => item.id === layer.id);
    if (existing) {
      return {
        ...existing,
        name: layer.name,
        volumeId: layer.volumeId,
        visible,
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
      visible,
      // Visibility is `visible` alone: the opacity is the user's and
      // survives hide/show (QA §5.3: 48% came back as 100%).
      opacity: metadataRenderProps?.opacity ?? 1.0,
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
    if (context?.initialGeometry && !layerFrameBoxes.get(layer.id)) {
      // Without an affine, the volume's own initial views frame its box (up
      // to the load-time pixel slack).
      layerFrameBoxes.recordFromViews(layer.id, context.initialGeometry.views);
    }
    // The view-state store refits the panes to the union of the visible
    // layers' boxes when the shown layers change (reframeForLayerChange).
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
    layerFrameBoxes.delete(id);
  }

  private setViewLayerVisibility(id: string, visible: boolean): void {
    useViewStateStore.getState().setViewState((state) => {
      const layer = state.layers.find((item) => item.id === id);
      if (!layer) {
        return;
      }
      layer.visible = visible;
      // A layer hidden by older builds (or a session saved by them) had
      // its opacity zeroed; showing it must draw it.
      if (visible && !(layer.opacity > 0)) layer.opacity = 1.0;
    });
  }

  private reorderViewLayers(layerIds: string[], workspaceId?: string): void {
    useViewStateStore.getState().setViewState((state) => {
      const order = new Map(layerIds.map((id, index) => [id, index]));
      state.layers.sort((left, right) => {
        const leftIndex = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      });
    }, workspaceId);
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
    // Stack position and start opacity of a new (not replacement) layer.
    let placement: { index: number; opacity?: number } | undefined;
    // Exact voxel-edge world box, for framing the union of visible layers.
    let frameBox: WorldBox | null = null;

    try {
      const gpuInfo = await this.apiService.requestLayerGpuResources(
        newLayer.id,
        newLayer.volumeId,
        metadataOnly,
      );
      frameBox = edgeBoxFromAffine(gpuInfo.voxel_to_world, gpuInfo.dim);
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
      if (!context?.replaceLayerId) {
        placement = planLayerPlacement(
          useLayerStore.getState().layers,
          newLayer,
          (id) =>
            id === newLayer.id
              ? {
                  ...earlyMetadata,
                  isBinaryLike: gpuInfo.is_binary_like,
                  dataRange: gpuInfo.data_range ?? undefined,
                }
              : useLayerStore.getState().getLayerMetadata(id),
        );
      }
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
      // A statistic map (declared or inferred) is shown as one from the
      // first paint: symmetric window ±max|v|, |z| ≤ 3.1 hidden (see
      // statisticDefaultRange). It is final: no histogram refinement later
      // changes it, so nothing but the user moves its window (native v6).
      const statisticRange = isLabelLike ? null : statisticDefaultRange(statisticOf(newLayer), dataRange);
      const rangeResult = overlayDisplay(
        newLayer,
        statisticRange ?? computeFallbackIntensityRange(rangeOptions),
        dataRange,
        !!statisticRange,
      );
      if (statisticRange) statisticFirstPaint.add(newLayer.id);

      renderProps = {
        // Hidden layers keep their opacity; `visible` gates drawing.
        opacity: placement?.opacity ?? 1.0,
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
      const built = this.buildLayerMetadata(earlyMetadata, gpuInfo, renderProps, !metadataOnly);
      const defaultCut = statisticRange ? Math.max(Math.abs(statisticRange.threshold[0]), Math.abs(statisticRange.threshold[1])) : 0;
      const metadata = defaultCut > 0 ? { ...built, statisticDefaultThreshold: defaultCut } : built;
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

    if (frameBox) layerFrameBoxes.record(newLayer.id, frameBox);
    // Add to layer store first.
    if (context?.replaceLayerId) {
      this.publishReplacement(context.replaceLayerId, newLayer, context);
    } else {
      useLayerStore.getState().addLayer(newLayer);
      this.upsertViewLayer(newLayer, context);
      this.placeNewLayer(newLayer.id, context?.workspaceId);
      // A single user-opened layer is the one the user works on next (not a
      // batch, a session restore or a programmatic load).
      if (
        newLayer.visible &&
        context?.autoSelect?.() &&
        (context.workspaceId ?? workspaceId) === useViewStateStore.getState().activeWorkspaceKey
      ) {
        focusVolumeLayer(newLayer.id);
      }
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
    if (
      !metadataOnly &&
      rangeOptions &&
      !context?.memberRender?.[context.workspaceId] &&
      !statisticFirstPaint.has(newLayer.id)
    ) {
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
    if (layerFrameBoxes.get(next.id) && next.id !== oldId) {
      layerFrameBoxes.delete(oldId);
    } else if (context.initialGeometry) {
      layerFrameBoxes.recordFromViews(next.id, context.initialGeometry.views);
      if (next.id !== oldId) layerFrameBoxes.delete(oldId);
    } else {
      layerFrameBoxes.move(oldId, next.id);
    }
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
    // Only a change to the window, threshold or colour map means the user (or
    // another refinement) took over; visibility toggles do not (native R2-1: a
    // run hidden by the Series view while its histogram ran kept its first-paint
    // window and never joined the pooled EPI window).
    const renderKey = (item: typeof initial | undefined) =>
      item ? JSON.stringify([item.intensity, item.threshold, item.colormap]) : '';
    const initialRender = renderKey(initial);
    // Guard both immutable store edits and external mutation of render arrays.
    let histogram;
    try {
      histogram = await histogramService.computeHistogram({
        layerId: layer.id,
        binCount: 256,
        excludeZeros: true,
        // A 4D series is windowed over all its frames (v2 R3), not the first.
        ...(isFourDIntensityLayer(layer as Parameters<typeof isFourDIntensityLayer>[0]) ? { allFrames: true } : {}),
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
    if (!store.getLayer(layer.id) || renderKey(target()?.layers.find((item) => item.id === layer.id)) !== initialRender) {
      return;
    }

    // A statistic whose data range was not finite (NaN / Inf): the
    // statistic rule from the histogram's 0.1 / 99.9 percentiles.
    const statisticRefined = layer.type === 'label' ? null : statisticDefaultRangeFromHistogram(statisticOf(layer), histogram);
    const rangeResult = overlayDisplay(
      layer,
      statisticRefined ?? computeAdaptiveIntensityRange(histogram, rangeOptions),
      rangeOptions.dataRange ?? { min: 0, max: 0 },
      !!statisticRefined,
      histogram,
    );
    const isLabelLike = layer.type === 'label';
    // A BOLD series is windowed like an EPI viewer (round 3 C1): p2–p98 over
    // every voxel of every frame, background zeros included (the brain mid
    // grey, a response toward white), pooled across its runs.
    let intensity = rangeResult.intensity;
    if (!statisticRefined && rangeResult.suggestedColormap === 'gray' && isFourDIntensityLayer(layer)) {
      const ids = runGroupIds(layer.id);
      const epi = await this.epiWindow(ids);
      if (!store.getLayer(layer.id) || renderKey(target()?.layers.find((item) => item.id === layer.id)) !== initialRender) return;
      if (epi) {
        intensity = shareRunWindow(
          layer.id,
          epi,
          (id) => target()?.layers.find((item) => item.id === id)?.intensity,
          (id, window) =>
            useViewStateStore.getState().setViewState((state) => {
              const sibling = state.layers.find((item) => item.id === id);
              if (sibling) sibling.intensity = [window[0], window[1]];
            }),
          ids,
        );
      }
    }
    const meta = store.getLayerMetadata(layer.id);
    const refined: LayerRender = {
      // The refinement changes the window only; the opacity is the user's.
      opacity: meta?.renderProps?.opacity ?? 1.0,
      intensity,
      threshold: rangeResult.threshold,
      colormap: rangeResult.suggestedColormap ?? 'gray',
      interpolation: isLabelLike ? 'nearest' : 'linear',
      layerMode: layer.type === 'mask' ? 'mask' : isLabelLike ? 'label' : 'scalar',
    };

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
   * EPI window of a run group (native R3-2): every run's all-frame histogram,
   * zeros included, on the group's common range with the same bins, summed,
   * then p2–p98 of the sum (runWindow.pooledWindow). One run: its own.
   */
  private async epiWindow(ids: readonly string[]): Promise<[number, number] | null> {
    const BINS = 1024;
    try {
      const own = await Promise.all(
        ids.map((layerId) => histogramService.computeHistogram({ layerId, binCount: BINS, excludeZeros: false, allFrames: true })),
      );
      const usable = own.filter((h) => h.totalCount > 0 && h.bins.length);
      if (!usable.length) return null;
      const range: [number, number] = [
        Math.min(...usable.map((h) => h.minValue)),
        Math.max(...usable.map((h) => h.maxValue)),
      ];
      const common =
        ids.length > 1
          ? await Promise.all(
              ids.map((layerId) =>
                histogramService.computeHistogram({ layerId, binCount: BINS, range, excludeZeros: false, allFrames: true }),
              ),
            )
          : usable;
      return pooledWindow(common, computePercentileFromBins as Parameters<typeof pooledWindow>[1]);
    } catch {
      return null;
    }
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

  /** Removal in flight per layer: a second request joins it. */
  private readonly removals = new Map<string, Promise<void>>();
  /** Bumped when a layer's removal starts (stale promotion guard). */
  private readonly removalSeq = new Map<string, number>();

  removeLayer(id: string): Promise<void> {
    const inFlight = this.removals.get(id);
    if (inFlight) return inFlight;
    this.removalSeq.set(id, (this.removalSeq.get(id) ?? 0) + 1);
    const removal = this.removeLayerOnce(id).finally(() => {
      if (this.removals.get(id) === removal) this.removals.delete(id);
    });
    this.removals.set(id, removal);
    return removal;
  }

  private async removeLayerOnce(id: string): Promise<void> {
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

      // Release GPU resources first. A failed release must not strand the
      // layer in the stores (it would stay listed and keep its overlays), so
      // the teardown below runs either way.
      try {
        await this.apiService.releaseLayerGpuResources(id);
      } catch (error) {
        console.warn(`[LayerApiImpl] releaseLayerGpuResources failed for ${id}:`, error);
      }
      queueStore.updateProgress(queueId, 45);

      // Best-effort volume-registry cleanup for symmetric unload flow.
      try {
        await this.apiService.unloadVolume(volumeId);
      } catch (error) {
        console.warn(`[LayerApiImpl] unloadVolume failed for ${volumeId}:`, error);
      }

      queueStore.updateProgress(queueId, 85);
      VolumeHandleStore.clearVolumeHandle(volumeId);

      // Remove from both stores explicitly, then forget per-layer UI state.
      useLayerStore.getState().removeLayer(id);
      this.removeViewLayer(id);
      this.forgetLayer(id);
      queueStore.markComplete(queueId);
    } catch (error) {
      queueStore.markError(
        queueId,
        error instanceof Error ? error : new Error('Failed to remove volume'),
      );
      throw error;
    }
  }

  /**
   * Places a just-committed layer by the stack rule (`layerPlacement.ts`):
   * on top of its band (anatomy, continuous, statistic, label).
   */
  private placeNewLayer(layerId: string, workspaceId?: string): void {
    const store = useLayerStore.getState();
    const order = placementOrder(store.layers, layerId, (id) => store.getLayerMetadata(id));
    if (!order) return;
    const byId = new Map(store.layers.map((layer) => [layer.id, layer]));
    store.reorderLayers(order.map((id) => byId.get(id)!).filter(Boolean));
    this.reorderViewLayers(order, workspaceId);
  }

  /** Per-layer state outside the layer and view stores. */
  private forgetLayer(id: string): void {
    statisticFirstPaint.delete(id);
    this.visibilitySeq.delete(id);
    useComparisonStore.getState().forgetLayer(id);
    useDisplayOptionsStore.getState().clearOptions(id);
    if (useSeriesStore.getState().regionPick?.layerId === id) {
      useSeriesStore.getState().update({ regionPick: null });
    }
  }

  /** Latest visibility request per layer (updateLayer ordering). */
  private readonly visibilitySeq = new Map<string, number>();

  async updateLayer(id: string, updates: Partial<Layer>): Promise<Layer> {
    // For now, layer metadata is managed on frontend only
    // Backend only cares about render properties

    // If visibility changed, update opacity
    if ('visible' in updates) {
      // A newer visibility request for the layer supersedes this one: a show
      // that finishes its GPU promotion after a later hide must not re-show the
      // layer (show → hide in quick succession left it drawn).
      const seq = (this.visibilitySeq.get(id) ?? 0) + 1;
      this.visibilitySeq.set(id, seq);
      const current = () => this.visibilitySeq.get(id) === seq;
      if (updates.visible) {
        await this.ensureGpuResidentForLayer(id);
      }
      if (!current()) return { id, ...updates } as Layer;
      // The backend layer draws at the user's opacity when shown.
      const viewOpacity = useViewStateStore
        .getState()
        .viewState.layers.find((layer) => layer.id === id)?.opacity;
      await this.patchLayerRender(id, {
        opacity: updates.visible ? (viewOpacity ?? 1.0) : 0.0,
      });
      if (!current()) return { id, ...updates } as Layer;
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

  async reorderLayers(layerIds: string[], workspaceId?: string): Promise<void> {
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
    this.reorderViewLayers(layerIds, workspaceId);
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

/**
 * The display of a 4D, non-statistic, non-label series (phase 4 v1 user 6,
 * round 3 F1). Two kinds:
 * - an image (a BIDS `_bold` / "bold" name, or any series that never goes
 *   below zero): an EPI, greyscale with a robust p2–p98 window over all frames;
 * - signed / zero-centred maps (FIR betas) added ON TOP of another volume: an
 *   intensity overlay, the hot ramp with the bulk (≤ p90 + 10% of the way to
 *   the robust high) hidden so the anatomy shows through. The window keeps to
 *   the data (round 3: no LUT ends outside it): from max(data min, a − ¼ of
 *   the visible span), so the lowest visible value sits above black, to the
 *   series maximum, so a focal peak is not a flat white core.
 * A window narrower than 5% of the data span (a near-constant series, a
 * sub-bin window) widens to the data span. The base volume and statistics
 * keep their own rules.
 */
export function overlayDisplay<T extends { intensity: [number, number]; threshold: [number, number]; suggestedColormap?: string }>(
  layer: {
    id: string;
    type?: string;
    volumeType?: string;
    timeSeriesInfo?: { num_timepoints: number } | null;
    name?: string;
    sourcePath?: string;
  },
  range: T,
  dataRange: { min: number; max: number },
  isStatistic: boolean,
  histogram?: { bins: HistogramData['bins']; totalCount: number; minValue?: number; maxValue?: number },
): T {
  if (isStatistic || layer.type === 'label' || layer.type === 'mask') return range;
  const fourD = (layer.timeSeriesInfo?.num_timepoints ?? 0) >= 2 || layer.volumeType === 'TimeSeries4D';
  if (!fourD) return range;
  const has = histogram && histogram.totalCount > 0 && histogram.bins.length > 0;
  const pct = (q: number) => computePercentileFromBins(histogram!.bins, histogram!.totalCount, q);
  const lo = has && Number.isFinite(histogram!.minValue) ? histogram!.minValue! : dataRange.min;
  const hi = has && Number.isFinite(histogram!.maxValue) ? histogram!.maxValue! : dataRange.max;
  const floor = (a: number, b: number): [number, number] =>
    b - a >= 0.05 * (hi - lo) || !(hi > lo) ? [a, b] : [lo, hi];

  const named = /_bold(\.nii(\.gz)?)?$/i.test(layer.sourcePath ?? '') || /(^|[^a-z])bold([^a-z]|$)/i.test(layer.name ?? '');
  const p2 = has ? pct(2) : null;
  const p98 = has ? pct(98) : null;
  // Only signed / zero-centred series (FIR betas, contrasts) are overlays; any
  // all-positive series is an image — real EPI (swraf*.nii, rest.nii) has a
  // noisy, non-zero background, so its p2 sits near 0 (REVIEW M3).
  const signed = Math.min(lo, p2 ?? lo) < 0;
  const boldLike = named || !signed;
  if (boldLike) {
    const intensity = p2 !== null && p98 !== null ? floor(p2, p98) : range.intensity;
    return { ...range, intensity, threshold: [0, 0], suggestedColormap: 'gray' };
  }

  const below = useLayerStore
    .getState()
    .layers.some((l) => l.id !== layer.id && l.type !== 'label' && (l.order ?? 0) < (useLayerStore.getState().getLayer(layer.id)?.order ?? Infinity));
  if (!below) return range;
  // A focal response is a tiny share of all voxels × frames: the robust high
  // is at least 80% of the series maximum.
  const robust = has ? ([pct(90), Math.max(pct(99.9), 0.8 * hi)] as const) : null;
  const [a, b] = floor(
    ...((robust && robust[1] > robust[0] ? [robust[0] + 0.1 * (robust[1] - robust[0]), robust[1]] : range.intensity) as [number, number]),
  );
  const span = b > a ? (b - a) / (HOT_ROBUST_HIGH - HOT_VISIBLE_FROM) : 0;
  const intensity: [number, number] =
    span > 0 ? [Math.max(lo, a - HOT_VISIBLE_FROM * span), Math.max(b, Math.min(hi, a + (1 - HOT_VISIBLE_FROM) * span))] : [a, b];
  return { ...range, intensity, suggestedColormap: 'hot', threshold: [Math.min(lo, a), a] };
}

/** Hot LUT position of the lowest visible value when the data reach below it: dark red, not black. */
export const HOT_VISIBLE_FROM = 0.15;
/** Hot LUT position of the robust high: yellow; values above it fade towards white at the maximum. */
export const HOT_ROBUST_HIGH = 0.75;

/** A layer whose display window should come from all its frames (4D, not a statistic). */
export function isFourDIntensityLayer(layer: { type?: string; volumeType?: string; timeSeriesInfo?: { num_timepoints: number } | null }): boolean {
  if (layer.type === 'label' || layer.type === 'mask') return false;
  return (layer.timeSeriesInfo?.num_timepoints ?? 0) >= 2 || layer.volumeType === 'TimeSeries4D';
}

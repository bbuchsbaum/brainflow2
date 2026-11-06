/**
 * Redraw the orthogonal views when a layer they draw becomes GPU-resident.
 *
 * A frame leaves out a visible layer it cannot allocate (the budget is full),
 * and the UI then makes room and uploads it (LayerEvictionService, the
 * front-workspace restore). The upload changes nothing in the ViewState, so no
 * render follows it: the view kept the frame that left the layer out, showing
 * 1-5 of 10 layers until the next interaction (R4 native forced-pressure run,
 * 2026-11-06). Every upload path announces `layer.gpu.ready`; one redraw
 * follows each burst of them, once it settles.
 */

import { getEventBus } from '@/events/EventBus';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { ViewState } from '@/types/viewState';
import { applyRenderLayerScope } from './RenderLayerScope';

export interface LayerReadyRedrawOptions {
  /** Whether the orthogonal views draw this layer now. */
  drawsLayer: (layerId: string) => boolean;
  /** Draw every orthogonal view again from the current state. */
  redraw: () => void;
  /** Quiet time after the last ready layer before the redraw. */
  settleMs?: number;
}

/** Start redrawing on `layer.gpu.ready`; returns the unsubscribe. */
export function subscribeLayerReadyRedraw(options: LayerReadyRedrawOptions): () => void {
  const settleMs = options.settleMs ?? 32;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const off = getEventBus().on('layer.gpu.ready', ({ layerId }) => {
    if (!options.drawsLayer(layerId)) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      options.redraw();
    }, settleMs);
  });
  return () => {
    off();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

/** Whether the orthogonal views draw `layerId` in the current state. */
export function orthogonalViewsDrawLayer(layerId: string): boolean {
  return applyRenderLayerScope(useViewStateStore.getState().viewState).layers.some(
    (layer) => layer.id === layerId && layer.visible,
  );
}

/** Redraw the orthogonal views through `renderService` when a layer they draw becomes resident. */
export function installLayerReadyRedraw(renderService: {
  forceRenderAll: (viewState: ViewState) => Promise<void>;
}): () => void {
  return subscribeLayerReadyRedraw({
    drawsLayer: orthogonalViewsDrawLayer,
    redraw: () => {
      renderService.forceRenderAll(useViewStateStore.getState().viewState).catch((error) => {
        console.error('[redrawOnLayerReady] Layer-ready render failed:', error);
      });
    },
  });
}

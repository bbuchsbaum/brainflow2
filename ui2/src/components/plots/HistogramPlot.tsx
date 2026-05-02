/**
 * HistogramPlot — Phase 4b of the integrated workspace refactor.
 *
 * Extracts the histogram from `PlotPanel` as a `PlotMode` registered behind
 * the `PlotHost` boundary. The plot mode is the plot-host contract's first
 * concrete consumer; Phase 4c registers `CrosshairTimeSeriesPlot` next.
 *
 * Behavior parity with the existing PlotPanel histogram path:
 *   - data is fetched via the singleton `histogramService` with `binCount: 256`
 *     and `excludeZeros: true`, preserving its cache and pending-request
 *     deduplication;
 *   - the layer.render.changed listener is wired but the body itself does not
 *     trigger a recompute — `HistogramService` already invalidates its own
 *     cache on render.changed, and React rerenders the chart with the new
 *     render properties from `viewStateStore`;
 *   - `HistogramChart` is rendered with the same prop wiring (intensity,
 *     threshold, colormap, log scale, tooltips, intensity/threshold edits).
 *
 * The mode is deliberately driven by `ctx.layerId` (host-supplied) rather than
 * reading the layer store directly; the host owns layer-selection wiring.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { HistogramChart } from './HistogramChart';
import { histogramService } from '@/services/HistogramService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getEventBus } from '@/events/EventBus';
import type { HistogramData } from '@/types/histogram';

import type { PlotModeContext } from './plotHost.types';

/** Padding (px) reserved around the histogram chart inside the mode body. */
const HISTOGRAM_BODY_PADDING = 32;
/** Minimum chart dimensions enforced when the body is collapsed. */
const HISTOGRAM_MIN_WIDTH = 100;
const HISTOGRAM_MIN_HEIGHT = 80;

interface HistogramPlotBodyProps {
  ctx: PlotModeContext;
}

export function HistogramPlotBody({ ctx }: HistogramPlotBodyProps) {
  const layerId = ctx.layerId;

  // Select the layer object by reference so the snapshot is stable across
  // unrelated state updates; derive render props in a memo. Returning a fresh
  // object literal from the selector would cause useSyncExternalStore to
  // detect a change on every render → infinite update loop.
  const viewStateLayer = useViewStateStore((state) =>
    layerId ? state.viewState.layers.find((l) => l.id === layerId) : undefined,
  );
  const layerRender = useMemo(() => {
    if (!viewStateLayer) return undefined;
    return {
      intensity: viewStateLayer.intensity,
      threshold: viewStateLayer.threshold,
      colormap: viewStateLayer.colormap,
      opacity: viewStateLayer.opacity,
    };
  }, [viewStateLayer]);

  const [histogramData, setHistogramData] = useState<HistogramData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [useLogScale, setUseLogScale] = useState(false);

  const loadHistogram = useCallback(async () => {
    if (!layerId) {
      setHistogramData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await histogramService.computeHistogram({
        layerId,
        binCount: 256,
        excludeZeros: true,
      });
      setHistogramData(data);
    } catch (err) {
      const original = err as Error;
      const enhanced = new Error(
        `Failed to compute histogram for layer ${layerId}: ${original.message}`,
      );
      enhanced.cause = original;
      setError(enhanced);
    } finally {
      setLoading(false);
    }
  }, [layerId]);

  useEffect(() => {
    if (!layerId) {
      setHistogramData(null);
      return;
    }
    loadHistogram();
  }, [layerId, loadHistogram]);

  // Mirror the existing PlotPanel listener exactly: subscribe per-layer, do
  // NOT trigger a recompute. HistogramService owns cache invalidation on
  // render.changed; React's rerender propagates the new render properties.
  useEffect(() => {
    if (!layerId) return;
    const eventBus = getEventBus();
    const unsubscribe = eventBus.on(
      'layer.render.changed',
      (_event: { layerId: string; renderProps: Record<string, unknown> }) => {
        // No-op by design (see file header).
        void _event;
      },
    );
    return () => {
      unsubscribe();
    };
  }, [layerId]);

  const handleIntensityChange = useCallback(
    (window: [number, number]) => {
      if (!layerId) return;
      useViewStateStore.getState().setViewState((state) => {
        const layers = state.layers.map((l) =>
          l.id === layerId ? { ...l, intensity: window } : l,
        );
        return { ...state, layers };
      });
    },
    [layerId],
  );

  const handleThresholdChange = useCallback(
    (threshold: [number, number]) => {
      if (!layerId) return;
      useViewStateStore.getState().setViewState((state) => {
        const layers = state.layers.map((l) =>
          l.id === layerId ? { ...l, threshold } : l,
        );
        return { ...state, layers };
      });
    },
    [layerId],
  );

  const chartWidth = Math.max(ctx.width - HISTOGRAM_BODY_PADDING, HISTOGRAM_MIN_WIDTH);
  const chartHeight = Math.max(ctx.height - HISTOGRAM_BODY_PADDING, HISTOGRAM_MIN_HEIGHT);

  return (
    <div
      data-testid="histogram-plot-body"
      style={{
        position: 'absolute',
        inset: 0,
        padding: '16px',
        overflow: 'hidden',
        background: 'transparent',
      }}
    >
      <HistogramChart
        data={histogramData}
        width={chartWidth}
        height={chartHeight}
        intensityWindow={layerRender?.intensity}
        threshold={layerRender?.threshold}
        colormap={layerRender?.colormap}
        showAxes
        showTooltips
        useLogScale={useLogScale}
        onIntensityChange={handleIntensityChange}
        onThresholdChange={handleThresholdChange}
        onLogScaleChange={setUseLogScale}
        loading={loading}
        error={error}
      />
    </div>
  );
}

export default HistogramPlotBody;

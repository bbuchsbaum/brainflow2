/**
 * HistogramPlot — whole-volume intensity histogram.
 *
 * Step 2: migrated onto the sample → frame → encoder pipeline. The body samples
 * a whole-volume frame via `sampleProvider` (which calls the existing
 * `compute_layer_histogram` path and stashes the rich histogram payload on
 * `frame.meta.histogram`) and renders it through {@link EncodedPlotView}. The
 * `hist` mark drives the same interactive `HistogramChart` as before — intensity
 * window / threshold drag, log scale, tooltips — so there is
 * no interactivity regression; the layer render props + edit callbacks are
 * threaded to the mark via the encoder context.
 *
 * Behaviour parity preserved: `computeHistogram` is called with the legacy
 * `{ binCount: 256, excludeZeros: true }` shape; the `layer.render.changed`
 * listener is wired but does not recompute (HistogramService owns cache
 * invalidation; React rerenders with new render props from `viewStateStore`).
 */

import { writeLayerDisplayField } from '@/utils/layerDisplayWrite';
import { useCallback, useEffect, useMemo, useState } from "react";

import { getEventBus } from "@/events/EventBus";
import { sampleProvider } from "@/services/SampleProvider";
import { useViewStateStore } from "@/stores/viewStateStore";
import { useLayerStore } from "@/stores/layerStore";
import { statisticUnits, statisticVariable } from "@/utils/statistic";
import { column } from "@/plotting";
import type { SampleFrame } from "@/plotting";

import { EncodedPlotView } from "./EncodedPlotView";
import { RegionCountBars } from "./RegionCountBars";
import type { EncoderContext } from "./encoder/types";
import type { PlotModeContext } from "./plotHost.types";

/** Mode id — also the key under which this mode's spec/params are persisted. */
export const HISTOGRAM_MODE_ID = "histogram";

/**
 * Body padding (px) reserved around the encoded plot. Kept tight vertically:
 * the default bottom dock leaves ~150 px for the body, and the encoding strip
 * plus axis must still leave room for the bars.
 */
const HISTOGRAM_BODY_PADDING_X = 12;
const HISTOGRAM_BODY_PADDING_Y = 6;
/** Minimum chart dimensions enforced when the body is collapsed. */
const HISTOGRAM_MIN_WIDTH = 100;
const HISTOGRAM_MIN_HEIGHT = 80;

/**
 * Placeholder whole-volume frame rendered before the histogram resolves. It
 * carries the `hist` suggestion so the encoder mounts the (empty) HistogramChart
 * immediately rather than flashing an empty box. (The mode gates out the
 * no-layer case, so the body only mounts once a layer is selected.)
 */
const EMPTY_HIST_FRAME: SampleFrame = {
  columns: [
    column("binStart", "quantitative"),
    column("binEnd", "quantitative"),
    column("binCenter", "quantitative"),
    column("count", "quantitative"),
  ],
  rows: [],
  meta: {
    locus: "wholeVolume",
    suggested: { mark: "hist", encoding: { x: "binCenter", y: "count" } },
  },
};

interface HistogramPlotBodyProps {
  ctx: PlotModeContext;
}

export function HistogramPlotBody({ ctx }: HistogramPlotBodyProps) {
  const layerId = ctx.layerId;

  // Select the layer object by reference so the snapshot is stable; derive the
  // render props in a memo (an inline object selector would loop).
  const viewStateLayer = useViewStateStore((state) =>
    layerId ? state.viewState.layers.find((l) => l.id === layerId) : undefined,
  );
  const layerRender = useMemo(() => {
    if (!viewStateLayer) return undefined;
    return {
      intensity: viewStateLayer.intensity,
      threshold: viewStateLayer.threshold,
      colormap: viewStateLayer.colormap,
    };
  }, [viewStateLayer]);

  // Axis title: the statistic's variable ("z") for statistic maps.
  const statistic = useLayerStore((state) =>
    layerId ? state.layers.find((l) => l.id === layerId)?.statistic : undefined,
  );
  const dataRange = useLayerStore((state) =>
    layerId ? state.layerMetadata.get(layerId)?.dataRange : undefined,
  );
  const units = statisticUnits(statistic, dataRange);
  // Label maps get per-region counts (one histogram bin per id), not an id histogram.
  const labelInfo = useLayerStore((state) =>
    layerId ? state.layers.find((l) => l.id === layerId) : undefined,
  );
  const isLabelMap =
    !!labelInfo && (labelInfo.type === "label" || labelInfo.isLabelMap === true);
  const legend = labelInfo?.atlasPaletteLegend;
  const labelBins =
    isLabelMap && dataRange && Number.isFinite(dataRange.max) && Number.isFinite(dataRange.min)
      ? Math.min(4096, Math.max(1, Math.round(dataRange.max - dataRange.min) + 1))
      : null;
  const xTitle = units ? statisticVariable(units) : null;

  const [frame, setFrame] = useState<SampleFrame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [useLogScale, setUseLogScale] = useState(false);

  // Stale-result guard: a slow histogram for a previous layer must not
  // overwrite the current layer's frame if it resolves out of order.
  useEffect(() => {
    if (!layerId) {
      setFrame(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    sampleProvider
      .sample({
        datasetId: layerId,
        locus: { kind: "wholeVolume" },
        binCount: labelBins ?? 256,
      })
      .then((result) => {
        if (cancelled) return;
        setFrame(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const original = err as Error;
        const enhanced = new Error(
          `Failed to compute histogram for layer ${layerId}: ${original.message}`,
        );
        enhanced.cause = original;
        setError(enhanced);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [layerId, labelBins]);

  // Subscribe per-layer, do NOT recompute (parity with prior behaviour).
  useEffect(() => {
    if (!layerId) return;
    const eventBus = getEventBus();
    const unsubscribe = eventBus.on(
      "layer.render.changed",
      (_event: { layerId: string; renderProps: Record<string, unknown> }) => {
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
      // Panel-aware in an unlinked Compare (the Inspector's rule).
      writeLayerDisplayField(layerId, 'intensity', window);
    },
    [layerId],
  );

  const handleThresholdChange = useCallback(
    (threshold: [number, number]) => {
      if (!layerId) return;
      writeLayerDisplayField(layerId, 'threshold', threshold);
    },
    [layerId],
  );

  // Padding applies on both sides of each axis, so subtract twice.
  const chartWidth = Math.max(
    ctx.width - HISTOGRAM_BODY_PADDING_X * 2,
    HISTOGRAM_MIN_WIDTH,
  );
  const chartHeight = Math.max(
    ctx.height - HISTOGRAM_BODY_PADDING_Y * 2,
    HISTOGRAM_MIN_HEIGHT,
  );

  const context: EncoderContext = useMemo(
    () => ({
      intensityWindow: layerRender?.intensity,
      threshold: layerRender?.threshold,
      colormap: layerRender?.colormap,
      useLogScale,
      onIntensityChange: handleIntensityChange,
      onThresholdChange: handleThresholdChange,
      onLogScaleChange: setUseLogScale,
      xTitle,
      loading,
      error,
    }),
    [
      layerRender,
      useLogScale,
      xTitle,
      handleIntensityChange,
      handleThresholdChange,
      loading,
      error,
    ],
  );

  if (isLabelMap && layerId) {
    return (
      <div data-testid="histogram-plot-body" style={{ position: "absolute", inset: 0 }}>
        {frame ? (
          <RegionCountBars layerId={layerId} frame={frame} legend={legend} />
        ) : (
          <p className="p-3 text-bf-xs text-bf-text-muted">{loading ? "Counting voxels…" : null}</p>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="histogram-plot-body"
      style={{
        position: "absolute",
        inset: 0,
        padding: `${HISTOGRAM_BODY_PADDING_Y}px ${HISTOGRAM_BODY_PADDING_X}px`,
        overflow: "hidden",
        background: "transparent",
      }}
    >
      <EncodedPlotView
        modeId={HISTOGRAM_MODE_ID}
        frame={frame ?? EMPTY_HIST_FRAME}
        width={chartWidth}
        height={chartHeight}
        context={context}
      />
    </div>
  );
}

export default HistogramPlotBody;

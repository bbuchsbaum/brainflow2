/**
 * RegionStatsPlot — atlas region × statistic plot (the `roi`/`regions` locus).
 *
 * Reduces the active scalar layer over every parcellation region of the active
 * atlas (via `compute_region_stats`) into a `(region, value, voxelCount)` frame,
 * then hands it to {@link EncodedPlotView} — which renders it as a bar chart via
 * the existing encoder (region is nominal, value quantitative → inferred `bar`).
 * The reducer is user-selectable (mean/median/min/max/sum) through the panel.
 */

import { useEffect, useState } from "react";

import { sampleProvider } from "@/services/SampleProvider";
import { usePlotSpecStore } from "@/stores/plotSpecStore";
import type { SampleFrame } from "@/plotting";

import { EncodedPlotView } from "./EncodedPlotView";
import { useAtlasLayerId } from "./regionStatsPlot.helpers";
import type { PlotModeContext } from "./plotHost.types";

const PLOT_PADDING = 12;
const MIN_PLOT_W = 80;
const MIN_PLOT_H = 60;

/** Mode id — also the key under which this mode's spec/params are persisted. */
export const REGION_STATS_MODE_ID = "region-stats";

export function RegionStatsPlotBody({ ctx }: { ctx: PlotModeContext }) {
  const { layerId: scalarLayerId, width, height } = ctx;
  const atlasLayerId = useAtlasLayerId();
  const reduce = usePlotSpecStore(
    (s) => s.reduceByMode[REGION_STATS_MODE_ID] ?? "mean",
  );
  const [frame, setFrame] = useState<SampleFrame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!scalarLayerId || !atlasLayerId) {
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
        datasetId: scalarLayerId,
        locus: { kind: "regions", atlasLayerId },
        reduce,
      })
      .then((result) => {
        if (cancelled) return;
        setFrame(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scalarLayerId, atlasLayerId, reduce]);

  const plotWidth = Math.max(width - PLOT_PADDING * 2, MIN_PLOT_W);
  const plotHeight = Math.max(height - PLOT_PADDING * 2, MIN_PLOT_H);

  return (
    <div
      data-testid="region-stats-plot-body"
      style={{
        position: "absolute",
        inset: 0,
        padding: `${PLOT_PADDING}px`,
        overflow: "hidden",
      }}
    >
      {loading && frame === null && (
        <div
          data-testid="region-stats-loading"
          className="bf-role-section"
          style={{ color: "var(--app-text-muted)" }}
        >
          Computing region statistics…
        </div>
      )}
      {error && (
        <div
          data-testid="region-stats-error"
          className="bf-role-section"
          style={{ color: "var(--app-error)" }}
        >
          {error.message}
        </div>
      )}
      {frame && (
        <EncodedPlotView
          modeId={REGION_STATS_MODE_ID}
          frame={frame}
          width={plotWidth}
          height={plotHeight}
          showReduce
        />
      )}
    </div>
  );
}

export default RegionStatsPlotBody;

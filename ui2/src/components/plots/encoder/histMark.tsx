/**
 * The `hist` mark — the one mark that is not a generic cartesian primitive.
 *
 * It drives the existing interactive {@link HistogramChart} (intensity-window /
 * threshold drag, colormap gradient, log scale, tooltips), so migrating the
 * histogram onto the spec pipeline loses none of that. The rich histogram
 * payload travels on `frame.meta.histogram` (stashed by
 * `SampleProvider.sampleWholeVolume`); if it is absent the chart is
 * reconstructed from the plain grammar columns (binStart/binEnd/count + meta
 * stats), so a hand-built whole-volume frame still renders.
 */

import { getColumn, numericColumn } from "@/plotting";
import type { SampleFrame } from "@/plotting";
import type { HistogramData } from "@/types/histogram";

import { HistogramChart } from "../HistogramChart";
import type { MarkRenderer } from "./types";

function readNumberMeta(
  frame: SampleFrame,
  key: string,
  fallback: number,
): number {
  const v = frame.meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Pull the rich {@link HistogramData} from meta, or rebuild it from columns. */
export function frameToHistogramData(frame: SampleFrame): HistogramData | null {
  const stashed = frame.meta?.histogram as HistogramData | undefined;
  if (stashed && Array.isArray(stashed.bins)) return stashed;

  if (!getColumn(frame, "count") || frame.rows.length === 0) return null;
  const counts = numericColumn(frame, "count");
  const binStart = getColumn(frame, "binStart")
    ? numericColumn(frame, "binStart")
    : [];
  const binEnd = getColumn(frame, "binEnd")
    ? numericColumn(frame, "binEnd")
    : [];
  const maxCount = counts.reduce((m, c) => (c > m ? c : m), 0);
  const total = readNumberMeta(
    frame,
    "totalCount",
    counts.reduce((a, c) => a + (Number.isFinite(c) ? c : 0), 0),
  );

  const bins = counts.map((count, i) => ({
    x0: binStart[i] ?? i,
    x1: binEnd[i] ?? i + 1,
    count,
    normalizedCount: maxCount > 0 ? count / maxCount : 0,
    percentage: total > 0 ? (count / total) * 100 : 0,
  }));

  return {
    bins,
    totalCount: total,
    // When bin edges are absent, fall back to a bin-index range rather than
    // [0, 0] (which would collapse the intensity/threshold overlay).
    minValue: readNumberMeta(frame, "min", binStart[0] ?? 0),
    maxValue: readNumberMeta(
      frame,
      "max",
      binEnd[binEnd.length - 1] ?? counts.length,
    ),
    mean: readNumberMeta(frame, "mean", 0),
    std: readNumberMeta(frame, "std", 0),
    binCount: readNumberMeta(frame, "binCount", counts.length),
    layerId: (frame.meta?.datasetId as string) ?? "",
  };
}

export const histMark: MarkRenderer = ({ frame, width, height, context }) => {
  const data = frameToHistogramData(frame);
  return (
    <HistogramChart
      data={data}
      width={width}
      height={height}
      intensityWindow={context?.intensityWindow}
      threshold={context?.threshold}
      colormap={context?.colormap}
      showAxes
      showTooltips
      useLogScale={context?.useLogScale ?? false}
      onIntensityChange={context?.onIntensityChange}
      onThresholdChange={context?.onThresholdChange}
      onLogScaleChange={context?.onLogScaleChange}
      loading={context?.loading}
      error={context?.error}
    />
  );
};

export default histMark;

/**
 * InlineHistogramPreview — the always-on, glance-sized histogram sparkline in
 * the Inspector DATA section.
 *
 * Per Design.md §1.5 the Inspector stays summary-only: this is a tiny,
 * axis-less, label-less thumbnail (not the full chart), and clicking it hands
 * off to the bottom Plot dock via the `onOpen` callback. It reuses the cached
 * `histogramService` (48 coarse bins, zeros excluded so the background spike
 * doesn't flatten the brain tissue) so it is cheap after the first fetch and
 * shares the dock's cache.
 *
 * It renders nothing while loading, on error, or when there is no usable
 * distribution — so it never shows broken or empty chrome and never shifts the
 * layout with a partial render.
 */

import React from "react";

import { histogramService } from "@/services/HistogramService";
import type { HistogramData } from "@/types/histogram";

const PREVIEW_BINS = 48;
const VIEW_W = 100;
const VIEW_H = 28;

export interface InlineHistogramPreviewProps {
  layerId: string;
  /**
   * Optional click handler. When provided the preview renders as a button that
   * hands off to the Plot dock; when omitted (the current parked state) it is a
   * non-interactive readout.
   */
  onOpen?: () => void;
}

export function InlineHistogramPreview({
  layerId,
  onOpen,
}: InlineHistogramPreviewProps) {
  const [data, setData] = React.useState<HistogramData | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setData(null);
    histogramService
      .computeHistogram({ layerId, binCount: PREVIEW_BINS, excludeZeros: true })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [layerId]);

  const bars = React.useMemo(() => {
    if (!data || data.bins.length === 0) return null;
    const maxNorm = data.bins.reduce(
      (m, b) => Math.max(m, b.normalizedCount),
      0,
    );
    if (maxNorm <= 0) return null;
    const n = data.bins.length;
    const slot = VIEW_W / n;
    const barW = Math.max(0.5, slot * 0.86);
    return data.bins.map((bin, i) => {
      const h = (bin.normalizedCount / maxNorm) * VIEW_H;
      return (
        <rect
          key={i}
          x={i * slot}
          y={VIEW_H - h}
          width={barW}
          height={h}
          rx={0.4}
        />
      );
    });
  }, [data]);

  if (!bars) return null;

  const chart = (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="block h-7 w-full"
      fill="currentColor"
      aria-hidden
    >
      {bars}
    </svg>
  );

  // Parked state: no dock to open into → render a non-interactive readout.
  if (!onOpen) {
    return (
      <div
        data-testid="inline-histogram-preview"
        className="mt-2 block w-full rounded-md border border-border/40 bg-card/30 px-1.5 py-1 text-sky-600/80 dark:text-sky-300/80"
      >
        {chart}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="inline-histogram-preview"
      aria-label="Open full plot in the bottom dock"
      title="Open full plot in the bottom dock"
      className="mt-2 block w-full rounded-md border border-border/40 bg-card/30 px-1.5 py-1 text-sky-600/80 transition-colors hover:border-border/70 hover:bg-accent/30 dark:text-sky-300/80"
    >
      {chart}
    </button>
  );
}

export default InlineHistogramPreview;

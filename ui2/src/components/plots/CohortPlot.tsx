/**
 * CohortPlot — by-factor distributions over a Set-Studio cohort.
 *
 * Samples one reduced scalar per member at the crosshair (the `set` locus →
 * backend `sample_set_at_world`, CPU-loaded, no GPU pollution), joins the
 * design table by member id (`joinDesignTable`), and renders the result through
 * {@link EncodedPlotView}. The default encoding is a box plot grouped by the
 * first design factor (covariate scatter / other marks are a panel switch
 * away). Sphere radius + reducer are panel controls.
 */

import { useEffect, useState } from "react";

import { sampleProvider } from "@/services/SampleProvider";
import { usePlotSpecStore } from "@/stores/plotSpecStore";
import { joinDesignTable, pickGroupingColumn } from "@/plotting";
import type { SampleFrame } from "@/plotting";

import { EncodedPlotView } from "./EncodedPlotView";
import { useActiveCohort } from "./cohortPlot.helpers";
import type { PlotModeContext } from "./plotHost.types";

const PLOT_PADDING = 12;
const MIN_PLOT_W = 80;
const MIN_PLOT_H = 60;
/**
 * Debounce (ms) for cohort sampling. A full-cohort `sample_set_at_world` loads
 * every member volume, so — unlike the single-voxel time-series — it must not
 * fire on every intermediate crosshair position; we wait for the crosshair to
 * settle. (Tauri commands can't be aborted mid-flight; the cancel flag only
 * suppresses stale state commits.)
 */
const COHORT_SAMPLE_DEBOUNCE_MS = 200;

/** Mode id — also the key under which this mode's spec/params are persisted. */
export const COHORT_MODE_ID = "cohort";

export function CohortPlotBody({ ctx }: { ctx: PlotModeContext }) {
  const { crosshairMm, width, height } = ctx;
  const cohort = useActiveCohort();
  const reduce = usePlotSpecStore(
    (s) => s.reduceByMode[COHORT_MODE_ID] ?? "mean",
  );
  const radiusMm = usePlotSpecStore(
    (s) => s.sphereRadiusMmByMode[COHORT_MODE_ID] ?? 0,
  );
  const [frame, setFrame] = useState<SampleFrame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!cohort || !crosshairMm) {
      setFrame(null);
      setError(null);
      setLoading(false);
      return;
    }
    const worldMm: [number, number, number] = [
      crosshairMm[0],
      crosshairMm[1],
      crosshairMm[2],
    ];
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Debounce: only sample once the crosshair/params settle, so dragging the
    // crosshair doesn't launch overlapping full-cohort backend jobs.
    const timer = setTimeout(() => {
      sampleProvider
        .sample({
          datasetId: cohort.setId,
          locus: { kind: "set", worldMm, radiusMm, members: cohort.members },
          reduce,
        })
        .then((base) => {
          if (cancelled) return;
          const joined = joinDesignTable(base, "member", cohort.designTable);
          // Default to a box grouped by the design column that actually *groups*
          // the members (lowest-cardinality factor — not the per-subject id, and
          // numeric-coded factors count); fall back to a per-member bar when no
          // column groups them. When a factor is chosen, drop members with no
          // factor value (e.g. outside the truncated design preview) so they
          // don't form a spurious "null" group.
          const factor = pickGroupingColumn(joined, cohort.designColumns);
          const next: SampleFrame = factor
            ? {
                ...joined,
                rows: joined.rows.filter(
                  (r) => r[factor] !== null && r[factor] !== "",
                ),
                meta: {
                  ...(joined.meta ?? {}),
                  suggested: {
                    mark: "box",
                    encoding: { x: factor, y: "value" },
                  },
                },
              }
            : {
                ...joined,
                meta: {
                  ...(joined.meta ?? {}),
                  suggested: {
                    mark: "bar",
                    encoding: { x: "member", y: "value" },
                  },
                },
              };
          setFrame(next);
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        });
    }, COHORT_SAMPLE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cohort, crosshairMm, radiusMm, reduce]);

  const plotWidth = Math.max(width - PLOT_PADDING * 2, MIN_PLOT_W);
  const plotHeight = Math.max(height - PLOT_PADDING * 2, MIN_PLOT_H);

  return (
    <div
      data-testid="cohort-plot-body"
      style={{
        position: "absolute",
        inset: 0,
        padding: `${PLOT_PADDING}px`,
        overflow: "hidden",
      }}
    >
      {loading && frame === null && (
        <div
          data-testid="cohort-loading"
          className="bf-role-section"
          style={{ color: "var(--app-text-muted)" }}
        >
          Sampling cohort…
        </div>
      )}
      {error && (
        <div
          data-testid="cohort-error"
          className="bf-role-section"
          style={{ color: "var(--app-error)" }}
        >
          {error.message}
        </div>
      )}
      {frame && (
        <EncodedPlotView
          modeId={COHORT_MODE_ID}
          frame={frame}
          width={plotWidth}
          height={plotHeight}
          showLocus
        />
      )}
    </div>
  );
}

export default CohortPlotBody;

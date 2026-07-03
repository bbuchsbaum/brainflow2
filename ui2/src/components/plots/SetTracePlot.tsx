/**
 * SetTracePlot — cross-set trace over a Set-Studio cohort.
 *
 * Samples one ROI-reduced scalar *plus a dispersion band* per member at the
 * crosshair (the `set` locus with a `band` → backend `sample_set_trace_at_world`,
 * CPU-loaded, no GPU pollution) and renders the members as a line with a shaded
 * CI/error ribbon (switchable to a carpet/grayplot `heatmap`). The member axis is
 * ontology-labelled when the cohort's design table supplies covariates.
 *
 * This is the sibling of {@link CohortPlotBody}: the cohort plot answers "how do
 * member values *distribute* by factor" (a box), while the trace answers "how
 * does the value *move across members* at this locus, with what confidence" (a
 * line + band). Same sampling seam; different default mark and band request.
 */

import { useEffect, useState } from 'react';

import { sampleProvider } from '@/services/SampleProvider';
import { usePlotSpecStore } from '@/stores/plotSpecStore';
import type { SampleFrame, TraceBand } from '@/plotting';

import { EncodedPlotView } from './EncodedPlotView';
import { useActiveCohort } from './cohortPlot.helpers';
import {
  buildTraceMembers,
  DEFAULT_TRACE_RADIUS_MM,
  SET_TRACE_MODE_ID,
} from './setTracePlot.helpers';
import type { PlotModeContext } from './plotHost.types';

const PLOT_PADDING = 12;
const MIN_PLOT_W = 80;
const MIN_PLOT_H = 60;

/**
 * Debounce (ms) for cohort trace sampling. Like the cohort box, a full-cohort
 * trace loads every member volume, so it must not fire on every intermediate
 * crosshair position; we wait for the crosshair/params to settle.
 */
const TRACE_SAMPLE_DEBOUNCE_MS = 200;

export function SetTracePlotBody({ ctx }: { ctx: PlotModeContext }) {
  const { crosshairMm, width, height } = ctx;
  const cohort = useActiveCohort();
  const reduce = usePlotSpecStore((s) => s.reduceByMode[SET_TRACE_MODE_ID] ?? 'mean');
  const band: TraceBand = usePlotSpecStore((s) => s.bandByMode[SET_TRACE_MODE_ID] ?? 'sem95');
  const radiusMm = usePlotSpecStore(
    (s) => s.sphereRadiusMmByMode[SET_TRACE_MODE_ID] ?? DEFAULT_TRACE_RADIUS_MM,
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
    const worldMm: [number, number, number] = [crosshairMm[0], crosshairMm[1], crosshairMm[2]];
    const members = buildTraceMembers(cohort);
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      sampleProvider
        .sample({
          datasetId: cohort.setId,
          locus: { kind: 'set', worldMm, radiusMm, members },
          reduce,
          band,
        })
        .then((next) => {
          if (cancelled) return;
          setFrame(next);
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        });
    }, TRACE_SAMPLE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cohort, crosshairMm, radiusMm, reduce, band]);

  const plotWidth = Math.max(width - PLOT_PADDING * 2, MIN_PLOT_W);
  const plotHeight = Math.max(height - PLOT_PADDING * 2, MIN_PLOT_H);

  return (
    <div
      data-testid="set-trace-plot-body"
      style={{
        position: 'absolute',
        inset: 0,
        padding: `${PLOT_PADDING}px`,
        overflow: 'hidden',
      }}
    >
      {loading && frame === null && (
        <div
          data-testid="set-trace-loading"
          className="bf-role-section"
          style={{ color: 'var(--app-text-muted)' }}
        >
          Sampling trace…
        </div>
      )}
      {error && (
        <div
          data-testid="set-trace-error"
          className="bf-role-section"
          style={{ color: 'var(--app-error)' }}
        >
          {error.message}
        </div>
      )}
      {frame && (
        <EncodedPlotView
          modeId={SET_TRACE_MODE_ID}
          frame={frame}
          width={plotWidth}
          height={plotHeight}
          showLocus
        />
      )}
    </div>
  );
}

export default SetTracePlotBody;

/**
 * CrosshairTimeSeriesPlot — voxel / sphere time-series plot.
 *
 * Step 2: the body's sole job is *sampling* — it builds a {@link SampleRequest}
 * from the active layer + crosshair + the sphere-radius/reducer params,
 * resolves it to a {@link SampleFrame} via `sampleProvider`, and hands the
 * frame to {@link EncodedPlotView}, which owns the spec, the encoding panel,
 * and the mark rendering. Radius 0 (the default) samples the single nearest
 * voxel; a positive radius averages (or otherwise reduces) a sphere of voxels
 * around the crosshair per timepoint.
 *
 * Owns PRD Risk #3 (sampling cost) by:
 *   - throttling fetches to <= 30 Hz (33 ms minimum gap);
 *   - skipping requests when the active layer is 3D, the crosshair is unset,
 *     or the world->voxel transform yields out-of-bounds coordinates;
 *   - de-duplicating on (voxel/world, radius, reduce) and cancelling stale
 *     inflight requests via a monotonic token.
 */

import { useEffect, useRef, useState } from "react";

import { sampleProvider } from "@/services/SampleProvider";
import { usePlotSpecStore } from "@/stores/plotSpecStore";
import type { Locus, SampleFrame } from "@/plotting";

import { EncodedPlotView } from "./EncodedPlotView";
import {
  TIMESERIES_THROTTLE_MS,
  resolveTimeseriesVoxel,
} from "./crosshairTimeSeriesPlot.helpers";
import type { PlotModeContext } from "./plotHost.types";

const PLOT_PADDING = 12;
const MIN_PLOT_W = 80;
const MIN_PLOT_H = 60;

/** Mode id — also the key under which this mode's spec/params are persisted. */
export const TIME_SERIES_MODE_ID = "crosshair-time-series";

interface TimeSeriesPlotBodyProps {
  ctx: PlotModeContext;
}

interface ThrottleState {
  pending: ReturnType<typeof setTimeout> | null;
  lastDispatch: number;
  inflightToken: number;
}

export function CrosshairTimeSeriesPlotBody({ ctx }: TimeSeriesPlotBodyProps) {
  const { layerId, crosshairMm, width, height } = ctx;
  const radiusMm = usePlotSpecStore(
    (s) => s.sphereRadiusMmByMode[TIME_SERIES_MODE_ID] ?? 0,
  );
  const reduce = usePlotSpecStore(
    (s) => s.reduceByMode[TIME_SERIES_MODE_ID] ?? "mean",
  );
  const [frame, setFrame] = useState<SampleFrame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const throttleRef = useRef<ThrottleState>({
    pending: null,
    lastDispatch: 0,
    inflightToken: 0,
  });
  const lastKeyRef = useRef<string>("");

  useEffect(() => {
    const target = resolveTimeseriesVoxel(layerId, crosshairMm);
    if (!target || !layerId || !crosshairMm) {
      // Drop stale data when the target becomes invalid (e.g. crosshair leaves
      // the volume). Bump the inflight token so a request already in flight
      // cannot resurrect stale data over the just-cleared state.
      throttleRef.current.inflightToken += 1;
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
    // Dedupe key. For a point (radius 0) the nearest voxel is authoritative, so
    // key on the rounded voxel — sub-voxel crosshair moves don't change the
    // sample. For a sphere, membership and per-voxel distances depend on the
    // fractional world position, so key on the (quantized) world position.
    const locusKey =
      radiusMm > 0
        ? `s:${worldMm.map((v) => v.toFixed(2)).join(",")}`
        : `v:${target.voxel.join(",")}`;
    const key = `${target.volumeId}:${locusKey}:${radiusMm}:${reduce}`;
    if (key === lastKeyRef.current && frame !== null) {
      // Same locus as the previous successful sample — skip duplicate request.
      return;
    }

    if (throttleRef.current.pending) {
      clearTimeout(throttleRef.current.pending);
      throttleRef.current.pending = null;
    }

    const elapsed = Date.now() - throttleRef.current.lastDispatch;
    const delay =
      elapsed >= TIMESERIES_THROTTLE_MS ? 0 : TIMESERIES_THROTTLE_MS - elapsed;

    const locus: Locus =
      radiusMm > 0
        ? { kind: "sphere", worldMm, radiusMm }
        : { kind: "point", worldMm };

    const token = ++throttleRef.current.inflightToken;
    const dispatch = () => {
      throttleRef.current.pending = null;
      throttleRef.current.lastDispatch = Date.now();
      lastKeyRef.current = key;

      setLoading(true);
      setError(null);
      sampleProvider
        .sample({ datasetId: layerId, locus, reduce })
        .then((result) => {
          if (token !== throttleRef.current.inflightToken) return;
          setFrame(result);
          setLoading(false);
        })
        .catch((err) => {
          if (token !== throttleRef.current.inflightToken) return;
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        });
    };

    if (delay === 0) {
      dispatch();
    } else {
      throttleRef.current.pending = setTimeout(dispatch, delay);
    }

    const throttleHandle = throttleRef;
    return () => {
      if (throttleHandle.current.pending) {
        clearTimeout(throttleHandle.current.pending);
        throttleHandle.current.pending = null;
      }
      // Invalidate any in-flight request on teardown so a late resolve is
      // ignored (no setState after the effect re-runs or the body unmounts).
      throttleHandle.current.inflightToken += 1;
    };
    // `frame` is intentionally excluded — including it would refire the effect
    // after each successful sample. The dedupe above uses a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId, crosshairMm, radiusMm, reduce]);

  const plotWidth = Math.max(width - PLOT_PADDING * 2, MIN_PLOT_W);
  const plotHeight = Math.max(height - PLOT_PADDING * 2, MIN_PLOT_H);

  return (
    <div
      data-testid="crosshair-ts-plot-body"
      style={{
        position: "absolute",
        inset: 0,
        padding: `${PLOT_PADDING}px`,
        overflow: "hidden",
      }}
    >
      {loading && frame === null && (
        <div
          data-testid="crosshair-ts-loading"
          className="bf-role-section"
          style={{ color: "var(--app-text-muted)" }}
        >
          Sampling…
        </div>
      )}
      {error && (
        <div
          data-testid="crosshair-ts-error"
          className="bf-role-section"
          style={{ color: "var(--app-error)" }}
        >
          {error.message}
        </div>
      )}
      {frame && (
        <EncodedPlotView
          modeId={TIME_SERIES_MODE_ID}
          frame={frame}
          width={plotWidth}
          height={plotHeight}
          showLocus
        />
      )}
    </div>
  );
}

export default CrosshairTimeSeriesPlotBody;

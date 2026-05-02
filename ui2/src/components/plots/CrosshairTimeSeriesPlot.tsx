/**
 * CrosshairTimeSeriesPlot — Phase 4c of the integrated workspace refactor.
 *
 * Plot-host-registered mode that samples the voxel time-series at the active
 * crosshair via the `sample_voxel_timeseries` Tauri command. Owns PRD Risk #3
 * (sampling cost) by:
 *   - throttling fetches to ≤ 30 Hz (33 ms minimum gap);
 *   - skipping requests when the active layer is 3D, the crosshair is unset,
 *     or the world→voxel transform yields out-of-bounds coordinates;
 *   - reusing the request shape proven by `services/hoverProviders/sparklineProvider.ts`
 *     (`{ volumeId, voxelX, voxelY, voxelZ }`).
 *
 * The body component owns its own loading/error/empty states for in-flight
 * conditions; the host's empty-state machine handles the static gates
 * (`no-layer`, `no-crosshair`, `unsupported-layer`) via the mode's `supports`.
 */

import { useEffect, useRef, useState } from 'react';

import { getTransport } from '@/services/transport';

import {
  TIMESERIES_THROTTLE_MS,
  resolveTimeseriesVoxel,
} from './crosshairTimeSeriesPlot.helpers';
import type { PlotModeContext } from './plotHost.types';

const PLOT_PADDING = 16;
const MIN_PLOT_W = 80;
const MIN_PLOT_H = 40;

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
  const [data, setData] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const throttleRef = useRef<ThrottleState>({
    pending: null,
    lastDispatch: 0,
    inflightToken: 0,
  });
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    const target = resolveTimeseriesVoxel(layerId, crosshairMm);
    if (!target) {
      // Drop stale data when target becomes invalid (e.g. crosshair leaves volume).
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const key = `${target.volumeId}:${target.voxel.join(',')}`;
    if (key === lastKeyRef.current && data !== null) {
      // Same voxel as the previous successful sample — skip duplicate request.
      return;
    }

    if (throttleRef.current.pending) {
      clearTimeout(throttleRef.current.pending);
      throttleRef.current.pending = null;
    }

    const elapsed = Date.now() - throttleRef.current.lastDispatch;
    const delay = elapsed >= TIMESERIES_THROTTLE_MS ? 0 : TIMESERIES_THROTTLE_MS - elapsed;

    const token = ++throttleRef.current.inflightToken;
    const dispatch = () => {
      throttleRef.current.pending = null;
      throttleRef.current.lastDispatch = Date.now();
      lastKeyRef.current = key;

      setLoading(true);
      setError(null);
      getTransport()
        .invoke<number[]>('sample_voxel_timeseries', {
          volumeId: target.volumeId,
          voxelX: target.voxel[0],
          voxelY: target.voxel[1],
          voxelZ: target.voxel[2],
        })
        .then((result) => {
          if (token !== throttleRef.current.inflightToken) return;
          setData(result);
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
    };
    // `data` is intentionally excluded — including it would cause the effect
    // to refire after each successful sample. The dedupe above uses a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId, crosshairMm]);

  const plotWidth = Math.max(width - PLOT_PADDING * 2, MIN_PLOT_W);
  const plotHeight = Math.max(height - PLOT_PADDING * 2, MIN_PLOT_H);

  return (
    <div
      data-testid="crosshair-ts-plot-body"
      style={{
        position: 'absolute',
        inset: 0,
        padding: `${PLOT_PADDING}px`,
        overflow: 'hidden',
      }}
    >
      {loading && data === null && (
        <div
          data-testid="crosshair-ts-loading"
          className="bf-role-section"
          style={{ color: 'var(--app-text-muted)' }}
        >
          Sampling…
        </div>
      )}
      {error && (
        <div
          data-testid="crosshair-ts-error"
          className="bf-role-section"
          style={{ color: 'var(--app-error)' }}
        >
          {error.message}
        </div>
      )}
      {data && data.length >= 2 && (
        <TimeSeriesLineChart data={data} width={plotWidth} height={plotHeight} />
      )}
    </div>
  );
}

interface TimeSeriesLineChartProps {
  data: number[];
  width: number;
  height: number;
}

function TimeSeriesLineChart({ data, width, height }: TimeSeriesLineChartProps) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const xStep = width / Math.max(data.length - 1, 1);
  const points = data
    .map((v, i) => {
      const x = i * xStep;
      const y = height - 1 - ((v - min) / range) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join('L');
  const zeroY = max > 0 && min < 0 ? height - 1 - ((0 - min) / range) * (height - 2) : null;

  return (
    <svg
      data-testid="crosshair-ts-svg"
      width={width}
      height={height}
      role="img"
      aria-label="Voxel time-series"
      style={{ display: 'block' }}
    >
      <line
        x1={0}
        y1={height / 2}
        x2={width}
        y2={height / 2}
        stroke="var(--app-plot-grid)"
        strokeWidth={0.5}
      />
      {zeroY !== null && (
        <line
          x1={0}
          y1={zeroY}
          x2={width}
          y2={zeroY}
          stroke="var(--app-plot-zero)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
      <path
        d={`M${points}`}
        fill="none"
        stroke="var(--app-plot-line)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default CrosshairTimeSeriesPlotBody;

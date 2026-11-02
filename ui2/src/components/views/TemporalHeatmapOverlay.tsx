/**
 * TemporalHeatmapOverlay
 *
 * Renders a temporal metric map (variance or mean) of the current view plane
 * as a colour overlay on a slice view. The map is requested on a plane grid
 * and drawn through the slice's own image placement, on a separate canvas
 * composited at configurable opacity. Outside the volume it is transparent.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  TemporalMetric,
  TemporalMetricMap,
  TemporalPlaneGrid,
} from '@/services/TemporalHeatmapService';
import { getTemporalHeatmapService, temporalGridKey } from '@/services/TemporalHeatmapService';
import type { ViewPlane } from '@/types/coordinates';
import { formatTauriError } from '@/utils/formatTauriError';
import {
  heatmapCanvasTransform,
  heatmapGrid,
  heatmapRgba,
  voxelSizeMm,
  type HeatmapPlacement,
} from './temporalHeatmapGeometry';

/** Quiet time before a map missing from the cache is requested (crosshair drags). */
export const HEATMAP_REQUEST_DEBOUNCE_MS = 120;

const METRIC_LABEL: Record<TemporalMetric, string> = { variance: 'Variance', mean: 'Mean' };

interface TemporalHeatmapOverlayProps {
  volumeId: string;
  metric: TemporalMetric;
  width: number;
  height: number;
  /** The view plane and the image placement the slice is drawn with. */
  viewPlane: ViewPlane;
  placement: HeatmapPlacement | null;
  /** The volume's voxel-to-world affine (column-major 4×4): sets the grid resolution. */
  voxelToWorld: readonly number[] | null | undefined;
  /**
   * The slice canvas's backing-store ratio (HiDPI): this canvas matches it,
   * so the transform, in the slice placement's backing pixels, lines up.
   */
  pixelRatio?: number;
  opacity?: number;
  className?: string;
}

interface LoadedMap {
  volumeId: string;
  metric: TemporalMetric;
  grid: TemporalPlaneGrid;
  map: TemporalMetricMap;
}

export function TemporalHeatmapOverlay({
  volumeId,
  metric,
  width,
  height,
  viewPlane,
  placement,
  voxelToWorld,
  pixelRatio = 1,
  opacity = 0.6,
  className = '',
}: TemporalHeatmapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<LoadedMap | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The key is stable across new plane objects with the same values.
  const requestedGrid = heatmapGrid(viewPlane, voxelSizeMm(voxelToWorld));
  const requestKey = temporalGridKey(volumeId, metric, requestedGrid);

  // The newest request wins: its cleanup drops anything earlier, at any stage.
  useEffect(() => {
    const grid = requestedGrid;
    const service = getTemporalHeatmapService();
    const cached = service.peekPlaneMap(volumeId, metric, grid);
    setError(null);
    if (cached) {
      setLoaded({ volumeId, metric, grid, map: cached });
      setPending(false);
      return;
    }
    let current = true;
    setPending(true);
    const timer = setTimeout(() => {
      service
        .getPlaneMap(volumeId, metric, grid)
        .then((map) => {
          if (!current) return;
          setLoaded({ volumeId, metric, grid, map });
          setPending(false);
        })
        .catch((err: unknown) => {
          if (!current) return;
          setLoaded(null);
          setPending(false);
          setError(formatTauriError(err));
        });
    }, HEATMAP_REQUEST_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `requestKey` covers the grid by value
  }, [requestKey, volumeId, metric]);

  // A map of another volume or metric is never shown; an earlier plane's stays
  // in place (it is transformed to this view) until its replacement arrives.
  const shown = loaded && loaded.volumeId === volumeId && loaded.metric === metric ? loaded : null;

  // One offscreen pixel per grid pixel; only a new map recolours.
  const offscreen = useMemo(() => {
    if (!shown) return null;
    const { data, width: gridWidth, height: gridHeight } = shown.map;
    const surface = document.createElement('canvas');
    surface.width = gridWidth;
    surface.height = gridHeight;
    const context = surface.getContext('2d');
    if (!context) return null;
    const image = context.createImageData(gridWidth, gridHeight);
    image.data.set(heatmapRgba(data));
    context.putImageData(image, 0, 0);
    return surface;
  }, [shown?.map]); // eslint-disable-line react-hooks/exhaustive-deps -- only the map's pixels matter

  const transform = shown ? heatmapCanvasTransform(shown.grid, viewPlane, placement) : null;
  const transformKey = transform ? transform.join(',') : '';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!offscreen || !transform) return;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(...transform);
    ctx.drawImage(offscreen, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `transform` is keyed by value
  }, [offscreen, transformKey, width, height, pixelRatio]);

  const label = METRIC_LABEL[metric];
  return (
    <>
      <canvas
        ref={canvasRef}
        width={Math.max(1, Math.round(width * pixelRatio))}
        height={Math.max(1, Math.round(height * pixelRatio))}
        style={{ opacity, imageRendering: 'pixelated', width, height }}
        className={`absolute inset-0 pointer-events-none ${className}`}
        data-testid="temporal-heatmap"
      />
      {pending && (
        <span
          className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 select-none rounded-sm bg-bf-bg-canvas/90 px-1 text-bf-xs text-bf-text-secondary"
          data-testid="temporal-heatmap-pending"
          role="status"
        >
          {`Computing ${label.toLowerCase()} map…`}
        </span>
      )}
      {error && (
        <span
          className="pointer-events-none absolute bottom-1 left-1/2 max-w-[90%] -translate-x-1/2 truncate rounded-sm bg-bf-bg-canvas/90 px-1 text-bf-xs text-bf-danger"
          data-testid="temporal-heatmap-error"
          role="alert"
          title={error}
        >
          {`${label} map failed: ${error}`}
        </span>
      )}
    </>
  );
}

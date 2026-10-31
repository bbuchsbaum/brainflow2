/**
 * TemporalHeatmapOverlay
 *
 * Renders a 2D temporal metric map (variance or mean) as a color overlay
 * on top of a slice view canvas. Uses a viridis-inspired sequential colormap.
 * The overlay is drawn to a separate canvas and composited at configurable opacity.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { TemporalMetric, SliceAxis, TemporalMetricResult } from '@/services/TemporalHeatmapService';
import { getTemporalHeatmapService } from '@/services/TemporalHeatmapService';
import type { ViewPlane } from '@/types/coordinates';
import {
  heatmapCanvasTransform,
  heatmapPixelIndex,
  type HeatmapPlacement,
} from './temporalHeatmapGeometry';

interface TemporalHeatmapOverlayProps {
  volumeId: string;
  metric: TemporalMetric;
  axis: SliceAxis;
  sliceIndex: number;
  width: number;
  height: number;
  /** The view plane and the image placement the slice is drawn with. */
  viewPlane: ViewPlane;
  placement: HeatmapPlacement | null;
  /** The volume's voxel-to-world affine (column-major 4×4). */
  voxelToWorld: readonly number[] | null | undefined;
  opacity?: number;
  className?: string;
}

// Viridis colormap sampled at 256 points (R, G, B in 0-255)
// Approximated via polynomial — avoids importing a large color table.
function viridisRgb(t: number): [number, number, number] {
  // Clamp to [0,1]
  const x = Math.max(0, Math.min(1, t));
  const r = Math.round(255 * (0.267 + x * (-0.003 + x * (1.785 - x * 1.977))));
  const g = Math.round(255 * (0.005 + x * (1.404 + x * (-1.384 + x * 0.747))));
  const b = Math.round(255 * (0.329 + x * (1.498 + x * (-2.418 + x * 1.317))));
  return [
    Math.max(0, Math.min(255, r)),
    Math.max(0, Math.min(255, g)),
    Math.max(0, Math.min(255, b)),
  ];
}

export function TemporalHeatmapOverlay({
  volumeId,
  metric,
  axis,
  sliceIndex,
  width,
  height,
  viewPlane,
  placement,
  voxelToWorld,
  opacity = 0.6,
  className = '',
}: TemporalHeatmapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [result, setResult] = useState<TemporalMetricResult | null>(null);

  // The metric map of this slice (cached by the service).
  useEffect(() => {
    let current = true;
    getTemporalHeatmapService()
      .getMetricMap(volumeId, metric, axis, sliceIndex)
      .then((map) => {
        if (current) setResult(map);
      })
      .catch((err) => {
        console.error('TemporalHeatmapOverlay: failed to fetch metric map', err);
        if (current) setResult(null);
      });
    return () => {
      current = false;
    };
  }, [volumeId, metric, axis, sliceIndex]);

  // Placed through the image's own mapping (QA 2026-10-31: it was stretched
  // over the canvas, off the image whenever it was letterboxed).
  const transform = heatmapCanvasTransform(axis, sliceIndex, voxelToWorld, viewPlane, placement);
  const transformKey = transform ? transform.join(',') : '';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = width;
    canvas.height = height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!result || !transform) return;

    const { data, width: dataW, height: dataH } = result;
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const v of data) {
      if (isFinite(v)) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }
    const range = maxVal - minVal;

    // One offscreen pixel per voxel: column a, row b.
    const offscreen = document.createElement('canvas');
    offscreen.width = dataW;
    offscreen.height = dataH;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;
    const imageData = offCtx.createImageData(dataW, dataH);
    const pixels = imageData.data;
    for (let i = 0; i < data.length; i++) {
      const t = range > 0 ? (data[i] - minVal) / range : 0;
      const [r, g, b] = viridisRgb(t);
      const p = heatmapPixelIndex(i, dataH, dataW) * 4;
      pixels[p] = r;
      pixels[p + 1] = g;
      pixels[p + 2] = b;
      pixels[p + 3] = 255; // full alpha; canvas opacity handles overall blend
    }
    offCtx.putImageData(imageData, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(...transform);
    ctx.drawImage(offscreen, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `transform` is keyed by value
  }, [result, transformKey, width, height]);

  return (
    <>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ opacity, imageRendering: 'pixelated' }}
        className={`absolute inset-0 pointer-events-none ${className}`}
        data-testid="temporal-heatmap"
        hidden={!transform}
      />
      {!transform && placement && voxelToWorld && (
        <span
          className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 select-none rounded-sm bg-bf-bg-canvas/90 px-1 text-bf-xs text-bf-text-muted"
          data-testid="temporal-heatmap-note"
        >
          Heatmap needs an axis-aligned view
        </span>
      )}
    </>
  );
}

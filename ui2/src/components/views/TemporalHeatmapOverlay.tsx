/**
 * TemporalHeatmapOverlay
 *
 * Renders a 2D temporal metric map (variance or mean) as a color overlay
 * on top of a slice view canvas. Uses a viridis-inspired sequential colormap.
 * The overlay is drawn to a separate canvas and composited at configurable opacity.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import type { TemporalMetric, SliceAxis } from '@/services/TemporalHeatmapService';
import { getTemporalHeatmapService } from '@/services/TemporalHeatmapService';

interface TemporalHeatmapOverlayProps {
  volumeId: string;
  metric: TemporalMetric;
  axis: SliceAxis;
  sliceIndex: number;
  width: number;
  height: number;
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
  opacity = 0.6,
  className = '',
}: TemporalHeatmapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const renderHeatmap = useCallback(async () => {
    if (!canvasRef.current || width <= 0 || height <= 0) return;

    const service = getTemporalHeatmapService();
    let result;
    try {
      result = await service.getMetricMap(volumeId, metric, axis, sliceIndex);
    } catch (err) {
      console.error('TemporalHeatmapOverlay: failed to fetch metric map', err);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = width;
    canvas.height = height;

    // Build RGBA pixel buffer from metric data
    const { data, width: dataW, height: dataH } = result;

    // Compute min/max for normalization
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const v of data) {
      if (isFinite(v)) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }
    const range = maxVal - minVal;

    // Create an offscreen ImageData at the data resolution, then scale to canvas
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
      const p = i * 4;
      pixels[p] = r;
      pixels[p + 1] = g;
      pixels[p + 2] = b;
      pixels[p + 3] = 255; // full alpha; canvas opacity handles overall blend
    }

    offCtx.putImageData(imageData, 0, 0);

    // Scale to output canvas size
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(offscreen, 0, 0, dataW, dataH, 0, 0, width, height);
  }, [volumeId, metric, axis, sliceIndex, width, height]);

  useEffect(() => {
    renderHeatmap();
  }, [renderHeatmap]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ opacity, imageRendering: 'pixelated' }}
      className={`absolute inset-0 pointer-events-none ${className}`}
    />
  );
}

/**
 * Sparkline Provider
 *
 * For 4D fMRI volumes: fetches the voxel timeseries at the hover location
 * and renders a tiny SVG sparkline as a hover info entry.
 */

import type { HoverInfoProvider, HoverInfoEntry, HoverContext } from '@/types/hoverInfo';
import { useLayerStore } from '@/stores/layerStore';
import { invoke } from '@tauri-apps/api/core';

const SPARKLINE_W = 60;
const SPARKLINE_H = 24;
const DEBOUNCE_MS = 200;
const CACHE_MAX = 50;

// LRU-style cache: key = "volumeId:x,y,z"
const cache = new Map<string, string>();

function evictCacheIfNeeded(): void {
  if (cache.size > CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) {
      cache.delete(firstKey);
    }
  }
}

/** Build a tiny SVG path string from a number array. Returns an <svg> element string. */
function buildSparklineSvg(values: number[]): string {
  if (values.length < 2) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const xStep = SPARKLINE_W / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * xStep;
    // SVG Y=0 is top; map max value to top (y=1) and min to bottom (y=H-1)
    const y = SPARKLINE_H - 1 - ((v - min) / range) * (SPARKLINE_H - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const d = `M${points.join('L')}`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SPARKLINE_W}" height="${SPARKLINE_H}" ` +
    `style="display:inline-block;vertical-align:middle">` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>` +
    `</svg>`
  );
}

/** Transform world mm coords to voxel coords using the 4x4 worldToVoxel matrix (flat, row-major). */
function worldToVoxel(
  worldToVoxelMatrix: number[],
  world: [number, number, number]
): [number, number, number] {
  const m = worldToVoxelMatrix;
  const [wx, wy, wz] = world;
  // 4x4 homogeneous multiply: result = M * [wx, wy, wz, 1]
  const vx = m[0] * wx + m[1] * wy + m[2] * wz + m[3];
  const vy = m[4] * wx + m[5] * wy + m[6] * wz + m[7];
  const vz = m[8] * wx + m[9] * wy + m[10] * wz + m[11];
  return [vx, vy, vz];
}

// Debounce state
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResolve: ((result: HoverInfoEntry[] | null) => void) | null = null;
let pendingCtx: HoverContext | null = null;

async function fetchSparkline(ctx: HoverContext): Promise<HoverInfoEntry[] | null> {
  if (!ctx.activeLayerId) return null;

  const state = useLayerStore.getState();
  const layer = state.getLayer(ctx.activeLayerId);
  if (!layer) return null;

  // Only proceed for 4D volumes
  const layerInfo = layer as typeof layer & { timeSeriesInfo?: { num_timepoints: number } };
  if (!layerInfo.timeSeriesInfo || layerInfo.timeSeriesInfo.num_timepoints < 2) return null;

  const metadata = state.getLayerMetadata(ctx.activeLayerId);
  if (!metadata?.worldToVoxel) return null;

  const [vx, vy, vz] = worldToVoxel(metadata.worldToVoxel, ctx.worldCoord);
  const x = Math.round(vx);
  const y = Math.round(vy);
  const z = Math.round(vz);

  // Bounds check using dimensions if available
  if (metadata.dimensions) {
    const [dx, dy, dz] = metadata.dimensions;
    if (x < 0 || y < 0 || z < 0 || x >= dx || y >= dy || z >= dz) return null;
  }

  const volumeId = layer.volumeId;
  const cacheKey = `${volumeId}:${x},${y},${z}`;

  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return [
      {
        label: 'Timeseries',
        value: cached,
        priority: 25,
        group: 'intensity',
      },
    ];
  }

  try {
    const timeseries = await invoke<number[]>('plugin:api-bridge|sample_voxel_timeseries', {
      volumeId,
      voxelX: x,
      voxelY: y,
      voxelZ: z,
    });

    if (!timeseries || timeseries.length < 2) return null;

    const svg = buildSparklineSvg(timeseries);
    evictCacheIfNeeded();
    cache.set(cacheKey, svg);

    return [
      {
        label: 'Timeseries',
        value: svg,
        priority: 25,
        group: 'intensity',
      },
    ];
  } catch {
    // Volume may be 3D or coordinate out of bounds — silently skip
    return null;
  }
}

export const sparklineProvider: HoverInfoProvider = {
  id: 'sparkline',
  displayName: 'Timeseries Sparkline',
  priority: 25,

  getInfo(ctx: HoverContext): Promise<HoverInfoEntry[] | null> {
    return new Promise((resolve) => {
      // Cancel previous pending debounce
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        if (pendingResolve) {
          pendingResolve(null);
          pendingResolve = null;
        }
      }

      pendingCtx = ctx;
      pendingResolve = resolve;

      debounceTimer = setTimeout(async () => {
        debounceTimer = null;
        const currentCtx = pendingCtx;
        const currentResolve = pendingResolve;
        pendingCtx = null;
        pendingResolve = null;

        if (!currentCtx || !currentResolve) return;

        const result = await fetchSparkline(currentCtx);
        currentResolve(result);
      }, DEBOUNCE_MS);
    });
  },
};

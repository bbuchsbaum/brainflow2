/**
 * Value of a volume layer at a world point (the crosshair), for the status
 * bar's Value slot and the colorbar caret. Uses the existing backend command
 * `sample_layer_value_at_world` (nearest voxel) through `SamplingService`.
 *
 * - Debounced, so dragging the crosshair does not flood the backend.
 * - Requests are shared through a small cache keyed by layer, timepoint and
 *   position (0.001 mm), so the status bar and a colorbar asking for the same
 *   value make one backend call.
 * - Outside the layer's volume, or for a non-finite sample, the value is
 *   null (shown as "—"): the backend answers 0 out of bounds, which would be
 *   a fabricated reading.
 */
import { useEffect, useState } from 'react';
import { sampleLayerAtWorld } from '@/services/SamplingService';
import { useLayerStore, type VolumeMetadata } from '@/stores/layerStore';
import { transformWorldToVoxelColumnMajor } from '@/utils/voxelTransform';

export type WorldPoint = readonly [number, number, number];

const CACHE_LIMIT = 64;
const cache = new Map<string, Promise<number | null>>();

export const VALUE_SAMPLE_DEBOUNCE_MS = 60;

function sampleKey(layerId: string, world: WorldPoint, timepoint: number): string {
  return `${layerId}|${timepoint}|${world.map((v) => v.toFixed(3)).join(',')}`;
}

/**
 * True exactly where the backend (`sample_world_coordinate_impl`, i.e.
 * `volume_queries::sample_nearest`) returns a real voxel: with the
 * continuous voxel coordinate `v` (inverse affine), the nearest index
 * `floor(v + 0.5)` lies in `[0, dim)`, i.e. `-0.5 <= v < dim - 0.5` per VOXEL
 * axis (each voxel's full extent). Elsewhere it answers 0, which would be a
 * fabricated reading.
 *
 * With `worldToVoxel` (the backend's column-major flattening, see
 * `transformWorldToVoxelColumnMajor`), `v` is the full matrix product, so
 * permuted (axis-swapped) and oblique affines are exact. Without it, `v` is
 * derived from the voxel-centre `worldBounds` per world axis (diagonal
 * affine). Unknown bounds and matrix count as inside; unknown dimensions fall
 * back to the voxel-centre box widened by half a voxel.
 */
export function isInsideVolume(
  world: WorldPoint,
  metadata:
    | Pick<VolumeMetadata, 'worldBounds' | 'dimensions' | 'spacing' | 'worldToVoxel'>
    | null
    | undefined,
): boolean {
  const EPS = 1e-6;
  const dims = metadata?.dimensions;
  const matrix = metadata?.worldToVoxel;
  if (
    matrix &&
    matrix.length >= 16 &&
    matrix.every(Number.isFinite) &&
    dims &&
    dims.length >= 3 &&
    [0, 1, 2].every((i) => Number.isFinite(dims[i]) && dims[i] > 0)
  ) {
    const v = transformWorldToVoxelColumnMajor(matrix, [world[0], world[1], world[2]]);
    for (let i = 0; i < 3; i += 1) {
      const index = Math.floor(v[i] + 0.5);
      if (!(index >= 0 && index < dims[i])) return false;
    }
    return true;
  }

  // Fallback (no matrix): diagonal affine from the voxel-centre bounds.
  const bounds = metadata?.worldBounds;
  if (!bounds) return true;
  for (let a = 0; a < 3; a += 1) {
    const lo = Math.min(bounds.min[a], bounds.max[a]);
    const hi = Math.max(bounds.min[a], bounds.max[a]);
    const count = dims?.[a];
    const spacing = count && count > 1 ? (hi - lo) / (count - 1) : (metadata?.spacing?.[a] ?? 0);
    if (!count || !(Number.isFinite(spacing) && spacing > 0)) {
      const tol = Number.isFinite(spacing) && spacing > 0 ? spacing / 2 : 1e-3;
      if (!(world[a] >= lo - tol && world[a] <= hi + tol)) return false;
      continue;
    }
    const v = (world[a] - lo) / spacing;
    const index = Math.floor(v + 0.5 + EPS);
    if (!(index >= 0 && index < count)) return false;
  }
  return true;
}

/** One shared, cached sample. Resolves null for outside / non-finite / errors. */
export function sampleLayerValue(
  layerId: string,
  world: WorldPoint,
  timepoint = 0,
): Promise<number | null> {
  const key = sampleKey(layerId, world, timepoint);
  const hit = cache.get(key);
  if (hit) {
    // Refresh recency.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const request = sampleLayerAtWorld({
    layerId,
    world: [world[0], world[1], world[2]],
  }).then((r) => (r.value !== null && Number.isFinite(r.value) ? r.value : null));
  cache.set(key, request);
  // Do not keep failures: the next crosshair move may succeed.
  request.then((v) => {
    if (v === null && cache.get(key) === request) cache.delete(key);
  });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return request;
}

/** Test-only: forget cached samples. */
export function __resetLayerValueCacheForTests(): void {
  cache.clear();
}

export interface LayerValueReading {
  /** Layer the reading belongs to. */
  layerId: string;
  /** World point the reading was taken at. */
  world: WorldPoint;
  /** Timepoint the reading was taken at (a reading of another frame is stale). */
  timepoint: number;
  /** Sampled value; null when outside the volume or not finite. */
  value: number | null;
}

/**
 * The layer's value at `world`, debounced. Returns null until the first
 * reading arrives; afterwards the last reading for this layer stays until the
 * new one lands (the consumer can compare `reading.world`).
 */
export function useLayerValueAtWorld(
  layerId: string | null | undefined,
  world: WorldPoint | null | undefined,
  delayMs = VALUE_SAMPLE_DEBOUNCE_MS,
  /**
   * Skip the frontend bounds test and let the backend answer (label maps:
   * outside reads label 0, background, as the status Region slot does).
   */
  trustBackendBounds = false,
): LayerValueReading | null {
  const [reading, setReading] = useState<LayerValueReading | null>(null);
  const metadata = useLayerStore((s) => (layerId ? s.layerMetadata.get(layerId) : undefined));
  const timepoint = useLayerStore((s) =>
    layerId ? (s.layers.find((l) => l.id === layerId)?.currentTimepoint ?? 0) : 0,
  );
  const x = world?.[0];
  const y = world?.[1];
  const z = world?.[2];

  useEffect(() => {
    if (!layerId || x === undefined || y === undefined || z === undefined) {
      setReading((prev) => (prev === null ? prev : null));
      return;
    }
    const point: WorldPoint = [x, y, z];
    if (!trustBackendBounds && !isInsideVolume(point, metadata)) {
      setReading({ layerId, world: point, timepoint, value: null });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void sampleLayerValue(layerId, point, timepoint).then((value) => {
        if (!cancelled) setReading({ layerId, world: point, timepoint, value });
      });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [layerId, x, y, z, timepoint, metadata, delayMs, trustBackendBounds]);

  return reading && reading.layerId === layerId ? reading : null;
}

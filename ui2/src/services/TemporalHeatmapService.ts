/**
 * TemporalHeatmapService
 *
 * Fetches and caches temporal metric maps (variance, mean) of a view plane from
 * the backend. Maps are keyed by volume, metric, plane and grid, and cached
 * (least recently used first out) until the volume is released.
 */

import { getTransport } from './transport';
import type { BackendTransport } from './transport';
import type { WorldCoordinates } from '@/types/coordinates';

export type TemporalMetric = 'variance' | 'mean';

/**
 * A sampling grid in a view plane. `origin_mm` is the outer corner of pixel
 * (0, 0); `u_mm` / `v_mm` are the world step of one grid pixel (ViewPlane
 * semantics), so a pixel samples its centre.
 */
export interface TemporalPlaneGrid {
  origin_mm: WorldCoordinates;
  u_mm: WorldCoordinates;
  v_mm: WorldCoordinates;
  width: number;
  height: number;
}

/** A metric map: row-major (pixel (i, j) at `j * width + i`), NaN outside the volume. */
export interface TemporalMetricMap {
  width: number;
  height: number;
  data: Float32Array;
}

/** The wire form: JSON has no NaN, so serde sends it as null. */
interface TemporalMetricResult {
  width: number;
  height: number;
  data: Array<number | null>;
}

/** A 512² map is 1 MiB: about 64 MiB at most. */
const MAX_CACHED_MAPS = 64;

const KEY_SEPARATOR = '\u0000';

/** Identifies a request; micrometres are finer than any view moves a map. */
export function temporalGridKey(
  volumeId: string,
  metric: TemporalMetric,
  grid: TemporalPlaneGrid,
): string {
  const vector = (v: WorldCoordinates) => v.map((c) => c.toFixed(3)).join(',');
  return [
    volumeId,
    metric,
    vector(grid.origin_mm),
    vector(grid.u_mm),
    vector(grid.v_mm),
    `${grid.width}x${grid.height}`,
  ].join(KEY_SEPARATOR);
}

function fromWire(result: TemporalMetricResult): TemporalMetricMap {
  const data = new Float32Array(result.data.length);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = result.data[i] ?? NaN;
  }
  return { width: result.width, height: result.height, data };
}

export class TemporalHeatmapService {
  private readonly transport: BackendTransport;
  constructor(transport: BackendTransport = getTransport()) {
    this.transport = transport;
  }
  private cache = new Map<string, TemporalMetricMap>();
  private pendingRequests = new Map<string, Promise<TemporalMetricMap>>();

  /** A cached map, without requesting one. */
  peekPlaneMap(
    volumeId: string,
    metric: TemporalMetric,
    grid: TemporalPlaneGrid,
  ): TemporalMetricMap | null {
    const key = temporalGridKey(volumeId, metric, grid);
    const cached = this.cache.get(key);
    if (!cached) return null;
    this.cache.delete(key);
    this.cache.set(key, cached);
    return cached;
  }

  async getPlaneMap(
    volumeId: string,
    metric: TemporalMetric,
    grid: TemporalPlaneGrid,
  ): Promise<TemporalMetricMap> {
    const cached = this.peekPlaneMap(volumeId, metric, grid);
    if (cached) return cached;

    // Deduplicate concurrent requests for the same key
    const key = temporalGridKey(volumeId, metric, grid);
    const pending = this.pendingRequests.get(key);
    if (pending) return pending;

    const request: Promise<TemporalMetricMap> = this.transport
      .invoke<TemporalMetricResult>('plugin:api-bridge|compute_temporal_metric_plane', {
        volumeId,
        metric,
        originMm: grid.origin_mm,
        uMm: grid.u_mm,
        vMm: grid.v_mm,
        width: grid.width,
        height: grid.height,
      })
      .then((result) => {
        const map = fromWire(result);
        // A release while this ran dropped the request: do not repopulate.
        if (this.pendingRequests.get(key) === request) {
          this.pendingRequests.delete(key);
          this.remember(key, map);
        }
        return map;
      })
      .catch((err) => {
        if (this.pendingRequests.get(key) === request) {
          this.pendingRequests.delete(key);
        }
        throw err;
      });

    this.pendingRequests.set(key, request);
    return request;
  }

  private remember(key: string, map: TemporalMetricMap): void {
    this.cache.set(key, map);
    if (this.cache.size > MAX_CACHED_MAPS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  /** Clear all cached results for a given volume (call when volume is unloaded). */
  clearVolume(volumeId: string): void {
    const prefix = `${volumeId}${KEY_SEPARATOR}`;
    for (const entries of [this.cache, this.pendingRequests]) {
      for (const key of entries.keys()) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    }
  }

  /** Clear the entire cache. */
  clearAll(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }
}

// Singleton
let instance: TemporalHeatmapService | null = null;

export function getTemporalHeatmapService(): TemporalHeatmapService {
  if (!instance) {
    instance = new TemporalHeatmapService();
  }
  return instance;
}

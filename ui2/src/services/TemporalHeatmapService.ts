/**
 * TemporalHeatmapService
 *
 * Fetches and caches 2D temporal metric maps (variance, mean) from the backend.
 * Each unique (volumeId, metric, axis, sliceIndex) combination is cached until
 * the volume changes or the cache is explicitly cleared.
 */

import { invoke } from '@tauri-apps/api/core';

export type TemporalMetric = 'variance' | 'mean';
export type SliceAxis = 'axial' | 'coronal' | 'sagittal';

export interface TemporalMetricResult {
  width: number;
  height: number;
  data: number[];
}

class TemporalHeatmapService {
  private cache = new Map<string, TemporalMetricResult>();
  private pendingRequests = new Map<string, Promise<TemporalMetricResult>>();

  private cacheKey(
    volumeId: string,
    metric: TemporalMetric,
    axis: SliceAxis,
    sliceIndex: number
  ): string {
    return `${volumeId}-${metric}-${axis}-${sliceIndex}`;
  }

  async getMetricMap(
    volumeId: string,
    metric: TemporalMetric,
    axis: SliceAxis,
    sliceIndex: number
  ): Promise<TemporalMetricResult> {
    const key = this.cacheKey(volumeId, metric, axis, sliceIndex);

    const cached = this.cache.get(key);
    if (cached) return cached;

    // Deduplicate concurrent requests for the same key
    const pending = this.pendingRequests.get(key);
    if (pending) return pending;

    const request = invoke<TemporalMetricResult>(
      'plugin:api-bridge|compute_temporal_metric',
      { volumeId, metric, axis, sliceIndex }
    ).then((result) => {
      this.cache.set(key, result);
      this.pendingRequests.delete(key);
      return result;
    }).catch((err) => {
      this.pendingRequests.delete(key);
      throw err;
    });

    this.pendingRequests.set(key, request);
    return request;
  }

  /** Clear all cached results for a given volume (call when volume is unloaded). */
  clearVolume(volumeId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${volumeId}-`)) {
        this.cache.delete(key);
      }
    }
    for (const key of this.pendingRequests.keys()) {
      if (key.startsWith(`${volumeId}-`)) {
        this.pendingRequests.delete(key);
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

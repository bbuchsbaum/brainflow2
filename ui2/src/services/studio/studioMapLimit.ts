/**
 * A robust window end for a Studio map, from the backend's histogram of its
 * nonzero voxels (the one the loader's own window refinement asks for: the
 * same request joins it, so a member is scanned once).
 */

import { histogramService } from '@/services/HistogramService';
import { studioRobustLimit, type StudioMapKind } from './studioMapDisplay';

/** Null when the histogram is unavailable: the caller keeps the data's own extreme. */
export async function fetchStudioRobustLimit(
  layerId: string,
  kind: StudioMapKind,
): Promise<number | null> {
  try {
    const histogram = await histogramService.computeHistogram({
      layerId,
      binCount: 256,
      excludeZeros: true,
    });
    return studioRobustLimit(histogram, kind);
  } catch (error) {
    console.warn(`[studioMapLimit] No histogram for ${layerId}:`, error);
    return null;
  }
}

/**
 * Drop the cached histogram of a map that is not a workspace layer (a
 * derived Compare map is never announced as removed).
 */
export function forgetStudioHistogram(layerId: string): void {
  histogramService.clearLayerCache(layerId);
}

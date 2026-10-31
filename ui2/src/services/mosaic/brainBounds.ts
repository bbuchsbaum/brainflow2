/**
 * Non-zero bounding box of a volume (`volume_nonzero_bbox`), used to crop the
 * mosaic to the brain (UI redesign phase 3, item 7). Cached per volume id;
 * null when the backend finds no non-zero voxel or the query fails, in which
 * case the mosaic keeps the full field of view.
 */
import type { VolumeNonzeroBbox } from '@brainflow/api';
import { getTransport } from '@/services/transport';

const cache = new Map<string, Promise<VolumeNonzeroBbox | null>>();

/**
 * `threshold`: voxels with |v| > threshold count (a statistic map at its
 * display threshold: a dense noisy map's 1e-5 voxels must not widen a crop
 * to the whole field of view). 0: any non-zero voxel.
 */
export function getNonzeroBbox(volumeId: string, threshold = 0): Promise<VolumeNonzeroBbox | null> {
  const key = threshold > 0 ? `${volumeId}|${threshold}` : volumeId;
  let pending = cache.get(key);
  if (!pending) {
    pending = Promise.resolve()
      .then(() =>
        getTransport().invoke<VolumeNonzeroBbox | null>('volume_nonzero_bbox', {
          request: threshold > 0 ? { volumeId, threshold } : { volumeId },
        }),
      )
      .then((bbox) => bbox ?? null)
      .catch((error) => {
        console.warn('[brainBounds] volume_nonzero_bbox failed; mosaic stays uncropped:', error);
        cache.delete(key);
        return null;
      });
    cache.set(key, pending);
  }
  return pending;
}

/** Forget a volume's box (unload) or everything (tests). */
export function clearNonzeroBbox(volumeId?: string): void {
  if (!volumeId) {
    cache.clear();
    return;
  }
  // With every threshold's box ("<id>|<threshold>"), not only threshold 0.
  for (const key of [...cache.keys()]) {
    if (key === volumeId || key.startsWith(`${volumeId}|`)) cache.delete(key);
  }
}

/** Cached box count (tests, diagnostics). */
export function nonzeroBboxCacheSize(): number {
  return cache.size;
}

/**
 * World framing box of the voxel *edges* around the non-zero voxels: the
 * centre envelope padded by half a voxel per axis.
 */
export function brainFraming(
  bbox: Pick<VolumeNonzeroBbox, 'worldMinMm' | 'worldMaxMm'>,
  voxelSizeMm: readonly [number, number, number],
): { min: number[]; max: number[] } {
  return {
    min: bbox.worldMinMm.map((v, a) => v - voxelSizeMm[a] / 2),
    max: bbox.worldMaxMm.map((v, a) => v + voxelSizeMm[a] / 2),
  };
}

/**
 * Union of the non-zero boxes of several volumes (the visible layers), so a
 * statistic's voxels outside the anatomy are not cropped away silently.
 * Volumes without a box are skipped; null when none has one.
 */
export async function unionNonzeroBbox(
  volumeIds: readonly string[],
): Promise<Pick<VolumeNonzeroBbox, 'worldMinMm' | 'worldMaxMm'> | null> {
  const boxes = (await Promise.all([...new Set(volumeIds)].map((id) => getNonzeroBbox(id)))).filter(
    (b): b is VolumeNonzeroBbox => b !== null,
  );
  if (boxes.length === 0) return null;
  const axis = [0, 1, 2] as const;
  return {
    worldMinMm: axis.map((a) => Math.min(...boxes.map((b) => Math.min(b.worldMinMm[a], b.worldMaxMm[a])))),
    worldMaxMm: axis.map((a) => Math.max(...boxes.map((b) => Math.max(b.worldMinMm[a], b.worldMaxMm[a])))),
  } as Pick<VolumeNonzeroBbox, 'worldMinMm' | 'worldMaxMm'>;
}

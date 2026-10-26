/**
 * Non-zero bounding box of a volume (`volume_nonzero_bbox`), used to crop the
 * mosaic to the brain (UI redesign phase 3, item 7). Cached per volume id;
 * null when the backend finds no non-zero voxel or the query fails, in which
 * case the mosaic keeps the full field of view.
 */
import type { VolumeNonzeroBbox } from '@brainflow/api';
import { getTransport } from '@/services/transport';

const cache = new Map<string, Promise<VolumeNonzeroBbox | null>>();

export function getNonzeroBbox(volumeId: string): Promise<VolumeNonzeroBbox | null> {
  let pending = cache.get(volumeId);
  if (!pending) {
    pending = Promise.resolve()
      .then(() =>
        getTransport().invoke<VolumeNonzeroBbox | null>('volume_nonzero_bbox', {
          request: { volumeId },
        }),
      )
      .then((bbox) => bbox ?? null)
      .catch((error) => {
        console.warn('[brainBounds] volume_nonzero_bbox failed; mosaic stays uncropped:', error);
        cache.delete(volumeId);
        return null;
      });
    cache.set(volumeId, pending);
  }
  return pending;
}

/** Forget a volume's box (unload) or everything (tests). */
export function clearNonzeroBbox(volumeId?: string): void {
  if (volumeId) cache.delete(volumeId);
  else cache.clear();
}

/**
 * World framing box of the voxel *edges* around the non-zero voxels: the
 * centre envelope padded by half a voxel per axis.
 */
export function brainFraming(
  bbox: VolumeNonzeroBbox,
  voxelSizeMm: readonly [number, number, number],
): { min: number[]; max: number[] } {
  return {
    min: bbox.worldMinMm.map((v, a) => v - voxelSizeMm[a] / 2),
    max: bbox.worldMaxMm.map((v, a) => v + voxelSizeMm[a] / 2),
  };
}

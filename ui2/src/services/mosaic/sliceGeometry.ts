/** Sampling spans voxel-center world bounds, including both endpoints.
 * For oblique images these are uniformly spaced world-axis reslices, not
 * native acquisition planes. The reference volume owns the count and extent;
 * overlays may enlarge the field of view but never move its slice positions.
 */
export interface SliceSampling {
  min: number;
  max: number;
  count: number;
}

export function slicePositionAtIndex({ min, max, count }: SliceSampling, index: number): number {
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    max < min ||
    !Number.isInteger(count) ||
    count < 1
  ) {
    throw new Error('Invalid montage slice geometry');
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(`Montage slice ${index} is outside 0..${count - 1}`);
  }
  return count === 1 ? (min + max) / 2 : min + index * ((max - min) / (count - 1));
}

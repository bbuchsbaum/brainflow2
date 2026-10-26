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

/**
 * The slice indices whose positions cover the world range [lo, hi] along the
 * slicing axis (e.g. the brain's non-zero extent), so a cropped montage keeps
 * the reference slice positions and spacing exactly: it only skips the empty
 * slices at either end. Clamped to 0..count-1; the whole range when the input
 * is unusable or misses the volume.
 */
export function sliceIndexRange(
  sampling: SliceSampling,
  lo: number,
  hi: number,
): { first: number; last: number } {
  const { min, max, count } = sampling;
  const all = { first: 0, last: Math.max(0, count - 1) };
  if (count <= 1 || !(max > min) || !Number.isFinite(lo) || !Number.isFinite(hi)) return all;
  const step = (max - min) / (count - 1);
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  // Indices of the first / last slice centres inside [a, b] (1e-6 slack for
  // f32 world positions that sit exactly on a centre).
  const first = Math.max(0, Math.ceil((a - min) / step - 1e-6));
  const last = Math.min(count - 1, Math.floor((b - min) / step + 1e-6));
  return first <= last ? { first, last } : all;
}

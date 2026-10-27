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

/** Width (px) of the mosaic's shared colorbar column beside the tiles. */
export const MOSAIC_COLORBAR_COLUMN_PX = 112;

/** Height (px) of the label strip under each mosaic tile (labels never sit on tissue). */
export const MOSAIC_LABEL_STRIP_PX = 14;
/** Gap (px) between mosaic tiles. */
export const MOSAIC_TILE_GAP_PX = 6;

export interface MosaicFit {
  rows: number;
  cols: number;
  /** Image size of one tile (the label strip is extra). */
  tileWidth: number;
  tileHeight: number;
  /** Tiles (image + strip) over the available area. */
  fill: number;
}

/** Tile size for a fixed grid in an area, following the brain's aspect (w/h). */
export function fitMosaicGrid(
  width: number,
  height: number,
  rows: number,
  cols: number,
  aspect: number,
  gap = MOSAIC_TILE_GAP_PX,
  strip = MOSAIC_LABEL_STRIP_PX,
): MosaicFit {
  const cellW = (width - gap * (cols - 1)) / cols;
  const cellH = (height - gap * (rows - 1)) / rows - strip;
  const tileWidth = Math.max(1, Math.floor(Math.min(cellW, cellH * aspect)));
  const tileHeight = Math.max(1, Math.floor(tileWidth / aspect));
  const fill = width > 0 && height > 0 ? (rows * cols * tileWidth * (tileHeight + strip)) / (width * height) : 0;
  return { rows, cols, tileWidth, tileHeight, fill };
}

/**
 * "Auto" grid (the default) for the cropped brain's aspect, showing at least
 * `minTiles` slices (fewer when the range is shorter) and at most the range.
 * Among the grids whose tiles are within 80% of the largest possible, take
 * the one that fills the area best: largest tiles alone can leave a third of
 * a short, wide pane empty (6×2 where 6×3 fits). The page holds rows × cols
 * tiles.
 */
/** Auto never shrinks tiles below this share of the largest possible. */
const AUTO_MIN_TILE_SHARE = 0.8;

export function autoMosaicGrid(
  width: number,
  height: number,
  aspect: number,
  sliceCount: number,
  minTiles = 12,
  maxSide = 8,
): MosaicFit {
  const want = Math.max(1, Math.min(minTiles, sliceCount || minTiles));
  const fits: MosaicFit[] = [];
  for (let cols = 1; cols <= maxSide; cols += 1) {
    for (let rows = 1; rows <= maxSide; rows += 1) {
      const n = rows * cols;
      if (n < want || (sliceCount > 0 && n - Math.max(cols, rows) >= sliceCount)) continue;
      fits.push(fitMosaicGrid(width, height, rows, cols, aspect));
    }
  }
  if (fits.length === 0) return fitMosaicGrid(width, height, 4, 4, aspect);
  const largest = Math.max(...fits.map((f) => f.tileWidth));
  let best: MosaicFit | null = null;
  for (const fit of fits) {
    if (fit.tileWidth < AUTO_MIN_TILE_SHARE * largest) continue;
    if (
      !best ||
      fit.fill > best.fill + 1e-9 ||
      (Math.abs(fit.fill - best.fill) <= 1e-9 && fit.tileWidth > best.tileWidth)
    ) {
      best = fit;
    }
  }
  return best!;
}

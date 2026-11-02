/**
 * The temporal heatmap's plane grid, its placement on the slice canvas and
 * its colour.
 *
 * The backend evaluates the metric on a grid in the view plane, so the heatmap
 * works for any affine and any view. A grid has the plane's corner origin and
 * covers its whole image at about voxel resolution; `u_mm` / `v_mm` are the
 * world step of one grid pixel (ViewPlane semantics).
 *
 * Grid pixels go to the canvas through grid → world → plane image pixel →
 * canvas (the image placement with its radiological mirror), so the heatmap
 * lands on the same canvas pixels as the image it describes. A map computed
 * for an earlier plane stays in place until its replacement arrives.
 */
import { imagePointToCanvasPoint, type SliceViewerPlacement } from '@brainflow/visualization/slice';
import type { ViewPlane, WorldCoordinates } from '@/types/coordinates';
import type { TemporalPlaneGrid } from '@/services/TemporalHeatmapService';

export type HeatmapPlacement = SliceViewerPlacement;

/** A canvas 2D transform (setTransform order a, b, c, d, e, f). */
export type CanvasTransform = [number, number, number, number, number, number];

/** Largest grid side requested from the backend. */
export const MAX_GRID_SIDE = 512;

/** Colour scale limits, in percent of the finite values. */
const SCALE_PERCENTILES: [number, number] = [2, 98];

/** The smallest voxel spacing of a column-major 4×4 affine, or null. */
export function voxelSizeMm(affine: readonly number[] | null | undefined): number | null {
  if (!affine || affine.length < 16) return null;
  const sizes = [0, 1, 2].map((c) =>
    Math.hypot(affine[4 * c], affine[4 * c + 1], affine[4 * c + 2]),
  );
  const size = Math.min(...sizes);
  return size > 0 && Number.isFinite(size) ? size : null;
}

/** Image pixels / round(voxel size / pixel size), at most MAX_GRID_SIDE. */
function gridSide(imagePixels: number, pixelMm: number, voxelMm: number | null): number {
  const factor = voxelMm && pixelMm > 0 ? Math.max(1, Math.round(voxelMm / pixelMm)) : 1;
  return Math.max(1, Math.min(MAX_GRID_SIDE, Math.floor(imagePixels / factor)));
}

/** The grid covering a plane's image, downsampled to about voxel resolution. */
export function heatmapGrid(plane: ViewPlane, voxelMm: number | null): TemporalPlaneGrid {
  const [imageWidth, imageHeight] = plane.dim_px;
  const width = gridSide(imageWidth, Math.hypot(...plane.u_mm), voxelMm);
  const height = gridSide(imageHeight, Math.hypot(...plane.v_mm), voxelMm);
  const scaled = (axis: WorldCoordinates, factor: number): WorldCoordinates =>
    [axis[0] * factor, axis[1] * factor, axis[2] * factor];
  return {
    origin_mm: plane.origin_mm,
    u_mm: scaled(plane.u_mm, imageWidth / width),
    v_mm: scaled(plane.v_mm, imageHeight / height),
    width,
    height,
  };
}

/** Plane image pixel of a world point, projected onto the plane (least squares on u, v). */
function worldToImage(plane: ViewPlane, w: readonly number[]): [number, number] | null {
  const d = [0, 1, 2].map((a) => w[a] - plane.origin_mm[a]);
  const u = plane.u_mm;
  const v = plane.v_mm;
  const dot = (p: readonly number[], q: readonly number[]) =>
    p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const uu = dot(u, u);
  const uv = dot(u, v);
  const vv = dot(v, v);
  const det = uu * vv - uv * uv;
  if (!(Math.abs(det) > 1e-12)) return null;
  const du = dot(u, d);
  const dv = dot(v, d);
  return [(du * vv - dv * uv) / det, (dv * uu - du * uv) / det];
}

/**
 * The transform drawing an offscreen grid (one pixel per grid pixel) onto the
 * view canvas, or null while the view has no usable placement.
 */
export function heatmapCanvasTransform(
  grid: TemporalPlaneGrid,
  plane: ViewPlane,
  placement: HeatmapPlacement | null | undefined,
): CanvasTransform | null {
  if (!placement) return null;
  if (!(placement.width > 0) || !(placement.height > 0)) return null;
  if (!(placement.imageWidth > 0) || !(placement.imageHeight > 0)) return null;
  const toCanvas = (s: number, t: number): [number, number] | null => {
    const world = [0, 1, 2].map(
      (a) => grid.origin_mm[a] + s * grid.u_mm[a] + t * grid.v_mm[a],
    );
    const image = worldToImage(plane, world);
    if (!image) return null;
    const point = imagePointToCanvasPoint(image, placement);
    return [point.canvasX, point.canvasY];
  };
  const p0 = toCanvas(0, 0);
  const p1 = toCanvas(1, 0);
  const p2 = toCanvas(0, 1);
  if (!p0 || !p1 || !p2) return null;
  return [p1[0] - p0[0], p1[1] - p0[1], p2[0] - p0[0], p2[1] - p0[1], p0[0], p0[1]];
}

/** Apply a transform to an offscreen point (for tests and hit checks). */
export function applyCanvasTransform(t: CanvasTransform, s: number, u: number): [number, number] {
  return [t[0] * s + t[2] * u + t[4], t[1] * s + t[3] * u + t[5]];
}

/** The value at percentile `p` of ascending values (linear interpolation). */
function percentile(sorted: Float32Array, p: number): number {
  const position = (p / 100) * (sorted.length - 1);
  const below = Math.floor(position);
  const above = Math.min(sorted.length - 1, below + 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

/**
 * The colour limits of a map: its 2nd and 98th percentiles of finite values, so
 * masked-out zeros or a few vessels do not flatten it. A map too uniform for
 * that (more than 96% one value) falls back to its full range.
 */
export function heatmapColorScale(data: ArrayLike<number>): [number, number] | null {
  const finite = new Float32Array(data.length);
  let count = 0;
  for (let i = 0; i < data.length; i += 1) {
    if (Number.isFinite(data[i])) {
      finite[count] = data[i];
      count += 1;
    }
  }
  if (count === 0) return null;
  const sorted = finite.subarray(0, count).sort();
  const low = percentile(sorted, SCALE_PERCENTILES[0]);
  const high = percentile(sorted, SCALE_PERCENTILES[1]);
  return high > low ? [low, high] : [sorted[0], sorted[count - 1]];
}

// Viridis approximated by a polynomial (R, G, B in 0-255).
function viridisRgb(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r = 255 * (0.267 + x * (-0.003 + x * (1.785 - x * 1.977)));
  const g = 255 * (0.005 + x * (1.404 + x * (-1.384 + x * 0.747)));
  const b = 255 * (0.329 + x * (1.498 + x * (-2.418 + x * 1.317)));
  return [r, g, b];
}

/** Row-major RGBA of a map under its colour scale; non-finite values are transparent. */
export function heatmapRgba(data: ArrayLike<number>): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(data.length * 4);
  const scale = heatmapColorScale(data);
  if (!scale) return pixels;
  const [low, high] = scale;
  const range = high - low;
  for (let i = 0; i < data.length; i += 1) {
    const value = data[i];
    if (!Number.isFinite(value)) continue;
    const [r, g, b] = viridisRgb(range > 0 ? (value - low) / range : 0);
    const p = i * 4;
    pixels[p] = r;
    pixels[p + 1] = g;
    pixels[p + 2] = b;
    pixels[p + 3] = 255; // full alpha; canvas opacity handles overall blend
  }
  return pixels;
}

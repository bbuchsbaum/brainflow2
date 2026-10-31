/**
 * Where the temporal heatmap's voxel slice goes on the slice view's canvas.
 *
 * The backend returns one voxel slice (axial: i × j at k; coronal: i × k at
 * j; sagittal: j × k at i), stored first-axis-major: value (a, b) at
 * `data[a * height + b]`. Each voxel is drawn as one offscreen pixel, column
 * a, row b, and the offscreen canvas is placed with a single 2D affine:
 * offscreen pixel → voxel (centre at +0.5) → world (the layer's affine) →
 * plane image pixel (the view plane) → canvas (the image placement, with its
 * radiological mirror and the zoomed plane). The heatmap therefore lands on
 * the same canvas pixels as the image it describes.
 *
 * Only a slice that lies in the view plane can be drawn this way (an in-plane
 * rotation is fine). When the volume's slice axes leave the plane (an
 * oblique affine or an oblique view), there is no exact 2D placement and the
 * caller hides the overlay instead of drawing an approximation.
 */
import type { ViewPlane } from '@/types/coordinates';

export type HeatmapAxis = 'axial' | 'coronal' | 'sagittal';

export interface HeatmapPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
  mirrorX?: boolean;
}

/** Voxel axes of the slice: [first in-plane, second in-plane, sliced]. */
const SLICE_AXES: Record<HeatmapAxis, [number, number, number]> = {
  axial: [0, 1, 2],
  coronal: [0, 2, 1],
  sagittal: [1, 2, 0],
};

/** A canvas 2D transform (setTransform order a, b, c, d, e, f). */
export type CanvasTransform = [number, number, number, number, number, number];

const PLANE_TOLERANCE = 1e-3;

/** Column-major 4×4: world of voxel (i, j, k). */
function voxelToWorld(m: readonly number[], v: readonly number[]): [number, number, number] {
  return [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]) as [
    number,
    number,
    number,
  ];
}

/** Plane image pixel of a world point in the plane (least squares on u, v). */
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

function imageToCanvas(p: HeatmapPlacement, ix: number, iy: number): [number, number] {
  const x = p.mirrorX ? p.imageWidth - ix : ix;
  return [p.x + (x * p.width) / p.imageWidth, p.y + (iy * p.height) / p.imageHeight];
}

/**
 * The transform drawing the offscreen heatmap (one pixel per voxel) onto the
 * view canvas, or null when the slice does not lie in the view plane.
 */
export function heatmapCanvasTransform(
  axis: HeatmapAxis,
  sliceIndex: number,
  affine: readonly number[] | null | undefined,
  plane: ViewPlane,
  placement: HeatmapPlacement | null | undefined,
): CanvasTransform | null {
  if (!affine || affine.length < 16 || !placement) return null;
  if (!(placement.width > 0) || !(placement.height > 0) || !(placement.imageWidth > 0)) return null;
  const [first, second, sliced] = SLICE_AXES[axis];
  const u = plane.u_mm;
  const v = plane.v_mm;
  const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const nLen = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(nLen > 0)) return null;
  // Both in-plane voxel axes must lie in the view plane.
  for (const axisIndex of [first, second]) {
    const col = [affine[4 * axisIndex], affine[4 * axisIndex + 1], affine[4 * axisIndex + 2]];
    const len = Math.hypot(col[0], col[1], col[2]);
    if (!(len > 0)) return null;
    const off =
      Math.abs(col[0] * normal[0] + col[1] * normal[1] + col[2] * normal[2]) / (len * nLen);
    if (off > PLANE_TOLERANCE) return null;
  }
  // Offscreen pixel (s, t) covers voxel (s − 0.5, t − 0.5) on the slice.
  const toCanvas = (s: number, t: number): [number, number] | null => {
    const voxel = [0, 0, 0];
    voxel[first] = s - 0.5;
    voxel[second] = t - 0.5;
    voxel[sliced] = sliceIndex;
    const image = worldToImage(plane, voxelToWorld(affine, voxel));
    return image ? imageToCanvas(placement, image[0], image[1]) : null;
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

/**
 * Offscreen pixel index of each backend value: column a, row b for
 * `data[a * height + b]` (the backend's first-axis-major order).
 */
export function heatmapPixelIndex(dataIndex: number, height: number, width: number): number {
  const a = Math.floor(dataIndex / height);
  const b = dataIndex - a * height;
  return b * width + a;
}

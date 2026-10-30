/**
 * World-axis frames for the standard panes.
 *
 * Axial, coronal and sagittal panes are world (RAS+) planes, whatever the
 * voxel orientation of any layer: the TypeScript counterpart of the backend
 * `SliceGeometry::full_extent_over_corners` (core/neuro-types/src/view_rect.rs).
 * The frame covers a world-axis box, so several layers are framed by the union
 * of their boxes rather than by the first layer's extent.
 */
import type { ViewPlane, ViewType, WorldCoordinates } from '@/types/coordinates';

export interface WorldBox {
  min: WorldCoordinates;
  max: WorldCoordinates;
}

const VIEW_TYPES: ViewType[] = ['axial', 'sagittal', 'coronal'];

/** World axes along screen-right and screen-down, and the plane normal. */
const PANE_AXES: Record<ViewType, { u: number; v: number; normal: number }> = {
  axial: { u: 0, v: 1, normal: 2 },
  coronal: { u: 0, v: 2, normal: 1 },
  sagittal: { u: 1, v: 2, normal: 0 },
};

/** Neurological defaults: +X right, anterior left on sagittal, superior/anterior up. */
const DEFAULT_SIGNS: Record<ViewType, { u: 1 | -1; v: 1 | -1 }> = {
  axial: { u: 1, v: -1 },
  coronal: { u: 1, v: -1 },
  sagittal: { u: -1, v: -1 },
};

const BOX_TOLERANCE_MM = 1e-3;

/** World interval a plane's raster covers along `axis`, or null if not finite. */
function planeSpan(plane: ViewPlane, axis: number): [number, number] | null {
  const [w, h] = plane.dim_px;
  const start = plane.origin_mm[axis];
  const end = start + plane.u_mm[axis] * w + plane.v_mm[axis] * h;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return [Math.min(start, end), Math.max(start, end)];
}

/**
 * The world box a set of standard panes frames: X and Y from the axial pane,
 * Z from the coronal pane. Null when the planes are missing or degenerate.
 */
export function worldBoxFromViews(
  views: Partial<Record<ViewType, ViewPlane>> | null | undefined,
): WorldBox | null {
  if (!views?.axial || !views.coronal) return null;
  const x = planeSpan(views.axial, 0);
  const y = planeSpan(views.axial, 1);
  const z = planeSpan(views.coronal, 2);
  if (!x || !y || !z) return null;
  if (!(x[1] > x[0]) || !(y[1] > y[0]) || !(z[1] > z[0])) return null;
  return { min: [x[0], y[0], z[0]], max: [x[1], y[1], z[1]] };
}

/**
 * Exact world box of a volume's outer voxel edges: the 8 corners at voxel
 * -0.5 and n - 0.5 on each axis through `voxelToWorld`, a column-major 4x4
 * (the GPU info / `VolumeMetadata.voxelToWorld` layout). Null when the matrix
 * is not an affine or the dimensions are not positive.
 */
export function edgeBoxFromAffine(
  voxelToWorld: ReadonlyArray<number> | null | undefined,
  dims: ReadonlyArray<number> | null | undefined,
): WorldBox | null {
  const m = voxelToWorld;
  if (!m || m.length < 16 || !m.slice(0, 16).every(Number.isFinite)) return null;
  // Column-major homogeneous affine: bottom row (0, 0, 0, 1) at 3, 7, 11, 15.
  if (Math.abs(m[3]) > 1e-6 || Math.abs(m[7]) > 1e-6 || Math.abs(m[11]) > 1e-6) return null;
  if (Math.abs(m[15] - 1) > 1e-6) return null;
  if (!dims || dims.length < 3 || ![0, 1, 2].every((a) => dims[a] >= 1)) return null;
  const min: WorldCoordinates = [Infinity, Infinity, Infinity];
  const max: WorldCoordinates = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner += 1) {
    const [i, j, k] = [0, 1, 2].map((a) => ((corner >> a) & 1 ? dims[a] - 0.5 : -0.5));
    for (let a = 0; a < 3; a += 1) {
      const w = m[a] * i + m[4 + a] * j + m[8 + a] * k + m[12 + a];
      min[a] = Math.min(min[a], w);
      max[a] = Math.max(max[a], w);
    }
  }
  return { min, max };
}

/** `point` moved onto the nearest point of `box` (unchanged when inside). */
export function clampToWorldBox(point: WorldCoordinates, box: WorldBox): WorldCoordinates {
  return [0, 1, 2].map((a) => Math.min(box.max[a], Math.max(box.min[a], point[a]))) as WorldCoordinates;
}

/**
 * True when `shown` contains `box` with at most `slack` mm to spare on any
 * side: a frame fit to `box` already, up to the square-pixel ceil.
 */
export function framesWithin(shown: WorldBox, box: WorldBox, slack: number): boolean {
  return [0, 1, 2].every(
    (a) =>
      shown.min[a] <= box.min[a] + BOX_TOLERANCE_MM &&
      shown.max[a] >= box.max[a] - BOX_TOLERANCE_MM &&
      box.min[a] - shown.min[a] <= slack &&
      shown.max[a] - box.max[a] <= slack,
  );
}

/** Largest pixel size among the standard panes (mm). */
export function largestPixelMm(views: Partial<Record<ViewType, ViewPlane>>): number {
  return Math.max(
    0,
    ...VIEW_TYPES.map((t) => {
      const plane = views[t];
      return plane ? Math.max(Math.hypot(...plane.u_mm), Math.hypot(...plane.v_mm)) : 0;
    }),
  );
}

/** Smallest box containing every given box; null when there are none. */
export function unionWorldBoxes(
  boxes: ReadonlyArray<WorldBox | null | undefined>,
): WorldBox | null {
  const present = boxes.filter((box): box is WorldBox => !!box);
  if (present.length === 0) return null;
  const min = [0, 1, 2].map((a) => Math.min(...present.map((b) => b.min[a]))) as WorldCoordinates;
  const max = [0, 1, 2].map((a) => Math.max(...present.map((b) => b.max[a]))) as WorldCoordinates;
  return { min, max };
}

export function sameWorldBox(
  a: WorldBox | null | undefined,
  b: WorldBox | null | undefined,
  tolerance = BOX_TOLERANCE_MM,
): boolean {
  if (!a || !b) return a === b;
  return [0, 1, 2].every(
    (axis) =>
      Math.abs(a.min[axis] - b.min[axis]) <= tolerance &&
      Math.abs(a.max[axis] - b.max[axis]) <= tolerance,
  );
}

function signOf(value: number | undefined, fallback: 1 | -1): 1 | -1 {
  if (value !== undefined && value > 0) return 1;
  if (value !== undefined && value < 0) return -1;
  return fallback;
}

/**
 * The pane of `viewType` through `crosshair` that frames `box` inside
 * `screenPx` with square pixels. Screen directions follow `reference` when it
 * has them (so a deliberate flip survives), else the neurological defaults.
 */
export function fitPlaneToWorldBox(
  viewType: ViewType,
  box: WorldBox,
  crosshair: WorldCoordinates,
  screenPx: [number, number],
  reference?: ViewPlane,
): ViewPlane {
  const { u, v, normal } = PANE_AXES[viewType];
  const uSign = signOf(reference?.u_mm[u], DEFAULT_SIGNS[viewType].u);
  const vSign = signOf(reference?.v_mm[v], DEFAULT_SIGNS[viewType].v);
  const widthMm = Math.max(0, box.max[u] - box.min[u]);
  const heightMm = Math.max(0, box.max[v] - box.min[v]);
  const pixelSize = Math.max(
    widthMm / Math.max(1, screenPx[0]),
    heightMm / Math.max(1, screenPx[1]),
    1e-6,
  );
  // The tolerance keeps float noise in w / pixelSize from adding a pixel.
  const dim_px: [number, number] = [
    Math.max(1, Math.ceil(widthMm / pixelSize - 1e-6)),
    Math.max(1, Math.ceil(heightMm / pixelSize - 1e-6)),
  ];

  const origin: WorldCoordinates = [0, 0, 0];
  origin[u] = uSign > 0 ? box.min[u] : box.max[u];
  origin[v] = vSign > 0 ? box.min[v] : box.max[v];
  origin[normal] = crosshair[normal];
  const u_mm: WorldCoordinates = [0, 0, 0];
  const v_mm: WorldCoordinates = [0, 0, 0];
  u_mm[u] = uSign * pixelSize;
  v_mm[v] = vSign * pixelSize;
  return { origin_mm: origin, u_mm, v_mm, dim_px };
}

/** The pixel budget of a set of panes: the largest width and height among them. */
export function screenPxForViews(views: Record<ViewType, ViewPlane>): [number, number] {
  const w = Math.max(...VIEW_TYPES.map((t) => views[t]?.dim_px[0] ?? 0));
  const h = Math.max(...VIEW_TYPES.map((t) => views[t]?.dim_px[1] ?? 0));
  return [w || 512, h || 512];
}

/** All three standard panes refit to `box` (see {@link fitPlaneToWorldBox}). */
export function fitViewsToWorldBox(
  views: Record<ViewType, ViewPlane>,
  box: WorldBox,
  crosshair: WorldCoordinates,
  screenPx: [number, number] = screenPxForViews(views),
): Record<ViewType, ViewPlane> {
  const next = { ...views };
  for (const viewType of VIEW_TYPES) {
    next[viewType] = fitPlaneToWorldBox(viewType, box, crosshair, screenPx, views[viewType]);
  }
  return next;
}

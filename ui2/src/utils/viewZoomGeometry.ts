/**
 * Zoom and pan of a slice view as a new view plane (QA features 2026-10-31
 * §1). The backend renders whatever plane it is given, so zooming is a
 * smaller pixel size and panning a moved origin; nothing else in the view
 * state changes. A zoomed plane covers the whole canvas (one bitmap pixel per
 * canvas pixel), so the zoomed image uses the full pane, not the letterbox of
 * the fitted frame.
 *
 * All mapping goes through the image placement, so a mirrored (radiological)
 * display zooms and pans the way it looks.
 */
import type { ViewPlane, WorldCoordinates } from '@/types/coordinates';

export interface ZoomPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
  mirrorX?: boolean;
}

export interface CanvasPoint {
  canvasX: number;
  canvasY: number;
}

/** The world point shown at a canvas point, inside or outside the image. */
export function canvasToWorldUnclamped(
  point: CanvasPoint,
  plane: ViewPlane,
  placement: ZoomPlacement,
): WorldCoordinates {
  let ix = ((point.canvasX - placement.x) / placement.width) * placement.imageWidth;
  const iy = ((point.canvasY - placement.y) / placement.height) * placement.imageHeight;
  if (placement.mirrorX) ix = placement.imageWidth - ix;
  return [0, 1, 2].map(
    (a) => plane.origin_mm[a] + ix * plane.u_mm[a] + iy * plane.v_mm[a],
  ) as WorldCoordinates;
}

/** World mm per canvas pixel of a displayed plane. */
export function displayedPixelMm(plane: ViewPlane, placement: ZoomPlacement): number {
  return (Math.hypot(...plane.u_mm) * placement.imageWidth) / placement.width;
}

const unit = (v: readonly number[]): WorldCoordinates => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};

export interface ZoomRequest {
  plane: ViewPlane;
  placement: ZoomPlacement;
  /** The canvas size in pixels (the zoomed plane covers it). */
  canvas: [number, number];
  /** The point that stays under the pointer. */
  anchor: CanvasPoint;
  /** > 1 zooms in, < 1 out; 1 for a pan alone. */
  factor?: number;
  /** Canvas pixels the anchor moves (a pan drag). */
  pan?: { dx: number; dy: number };
  /** Allowed mm per canvas pixel. */
  limits?: { min: number; max: number };
}

/**
 * The plane after zooming by `factor` about `anchor` and moving the anchor by
 * `pan`: the world point under the anchor before is under `anchor + pan`
 * after. The slice (plane normal and position) is unchanged.
 */
export function zoomPanPlane({
  plane,
  placement,
  canvas,
  anchor,
  factor = 1,
  pan = { dx: 0, dy: 0 },
  limits,
}: ZoomRequest): ViewPlane | null {
  const [cw, ch] = canvas;
  if (!(cw > 0) || !(ch > 0) || !(placement.width > 0) || !(placement.height > 0)) return null;
  if (!(factor > 0) || !Number.isFinite(factor)) return null;
  const world = canvasToWorldUnclamped(anchor, plane, placement);
  let pixel = displayedPixelMm(plane, placement) / factor;
  if (limits) pixel = Math.min(limits.max, Math.max(limits.min, pixel));
  if (!(pixel > 0) || !Number.isFinite(pixel)) return null;
  const u = unit(plane.u_mm).map((c) => c * pixel) as WorldCoordinates;
  const v = unit(plane.v_mm).map((c) => c * pixel) as WorldCoordinates;
  // The new plane fills the canvas: image pixel = canvas pixel (mirrored
  // left-right when the display is).
  const cx = anchor.canvasX + pan.dx;
  const cy = anchor.canvasY + pan.dy;
  const ix = placement.mirrorX ? cw - cx : cx;
  const origin = [0, 1, 2].map((a) => world[a] - ix * u[a] - cy * v[a]) as WorldCoordinates;
  return { origin_mm: origin, u_mm: u, v_mm: v, dim_px: [Math.round(cw), Math.round(ch)] };
}

/**
 * A zoomed plane resized to a new canvas: same pixel size, the same world
 * point at the canvas centre.
 */
export function resizeZoomedPlane(plane: ViewPlane, canvas: [number, number]): ViewPlane {
  const [w, h] = plane.dim_px;
  const [nw, nh] = [Math.max(1, Math.round(canvas[0])), Math.max(1, Math.round(canvas[1]))];
  const centre = [0, 1, 2].map(
    (a) => plane.origin_mm[a] + (w / 2) * plane.u_mm[a] + (h / 2) * plane.v_mm[a],
  );
  const origin = [0, 1, 2].map(
    (a) => centre[a] - (nw / 2) * plane.u_mm[a] - (nh / 2) * plane.v_mm[a],
  ) as WorldCoordinates;
  return { ...plane, origin_mm: origin, dim_px: [nw, nh] };
}

/**
 * The in-plane world rectangle a plane shows, as a box whose normal axis is
 * unbounded (for "does the image still meet the view").
 */
export function planeWorldSpan(plane: ViewPlane): { min: WorldCoordinates; max: WorldCoordinates } {
  const [w, h] = plane.dim_px;
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ].map(([i, j]) =>
    [0, 1, 2].map((a) => plane.origin_mm[a] + i * plane.u_mm[a] + j * plane.v_mm[a]),
  );
  const min = [0, 1, 2].map((a) => Math.min(...corners.map((c) => c[a]))) as WorldCoordinates;
  const max = [0, 1, 2].map((a) => Math.max(...corners.map((c) => c[a]))) as WorldCoordinates;
  const u = plane.u_mm;
  const v = plane.v_mm;
  const normal = unit([
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]);
  for (let a = 0; a < 3; a += 1) {
    if (Math.abs(normal[a]) > 0.9) {
      min[a] = -Infinity;
      max[a] = Infinity;
    }
  }
  return { min, max };
}

/** True when the world box overlaps what the plane shows. */
export function planeShowsBox(
  plane: ViewPlane,
  box: { min: readonly number[]; max: readonly number[] },
): boolean {
  const span = planeWorldSpan(plane);
  return [0, 1, 2].every((a) => box.min[a] <= span.max[a] && span.min[a] <= box.max[a]);
}

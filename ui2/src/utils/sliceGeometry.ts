/**
 * Single source of truth for slice-frame geometry on the frontend.
 *
 * This is a 1:1 port of the canonical Rust contract in
 * `core/neuro-types/src/view_rect.rs` (`SliceGeometry`). Every consumer of
 * view-plane math — coordinate transforms, requested-view payloads, viewport
 * resizing — routes through here so the frontend and backend can never drift.
 *
 * Numeric parity with Rust is pinned by
 * `ui2/src/utils/__tests__/sliceGeometryParity.test.ts`, which replays fixtures
 * produced by `core/neuro-types/tests/slice_geometry_parity.rs`.
 *
 * A `ViewPlane` (`{ origin_mm, u_mm, v_mm, dim_px }`) is the TS mirror of the
 * Rust `SliceGeometry`.
 */

import type { ViewPlane, WorldCoordinates, ScreenCoordinates } from '@/types/coordinates';

type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];

/** GPU frame parameters: origin (w=1) plus full-extent u/v spans (w=0). */
export interface GpuFrameParams {
  origin: Vec4;
  u: Vec4;
  v: Vec4;
}

function magnitude(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * World coordinate of pixel `(x, y)`: `origin + x*u + y*v`.
 * Mirrors `SliceGeometry::pixel_to_world` (fractional pixels permitted).
 */
export function pixelToWorld(plane: ViewPlane, x: number, y: number): WorldCoordinates {
  const [ox, oy, oz] = plane.origin_mm;
  const [ux, uy, uz] = plane.u_mm;
  const [vx, vy, vz] = plane.v_mm;
  return [ox + x * ux + y * vx, oy + x * uy + y * vy, oz + x * uz + y * vz];
}

/**
 * Perpendicular distance (mm) from a world point to the plane spanned by
 * `u_mm`/`v_mm` through `origin_mm`. `NaN`/`Infinity` for a degenerate basis
 * (matches the JS float semantics the callers already relied on).
 */
export function distanceToPlane(plane: ViewPlane, world: WorldCoordinates): number {
  const delta = subtract(world as Vec3, plane.origin_mm as Vec3);
  const normal = cross(plane.u_mm as Vec3, plane.v_mm as Vec3);
  const mag = magnitude(normal);
  return Math.abs(delta[0] * normal[0] + delta[1] * normal[1] + delta[2] * normal[2]) / mag;
}

/**
 * Inverse of {@link pixelToWorld}: solve `origin + x*u + y*v = world` for the
 * pixel `(x, y)` via a 2x2 in-plane system, trying the XY, YZ, then XZ
 * sub-planes. Returns `null` only for a fully degenerate basis.
 *
 * This is the shared kernel behind `CoordinateTransform.worldToScreen` /
 * `worldToScreenUnchecked`; it applies no plane-distance tolerance.
 */
export function worldToPixel(plane: ViewPlane, world: WorldCoordinates): ScreenCoordinates | null {
  const [worldX, worldY, worldZ] = world;
  const [originX, originY, originZ] = plane.origin_mm;
  const [uX, uY, uZ] = plane.u_mm;
  const [vX, vY, vZ] = plane.v_mm;

  const deltaX = worldX - originX;
  const deltaY = worldY - originY;
  const deltaZ = worldZ - originZ;

  const det = uX * vY - uY * vX;
  if (Math.abs(det) >= 1e-10) {
    const x = (deltaX * vY - deltaY * vX) / det;
    const y = (deltaY * uX - deltaX * uY) / det;
    return [x, y];
  }

  const detYZ = uY * vZ - uZ * vY;
  if (Math.abs(detYZ) > 1e-10) {
    const x = (deltaY * vZ - deltaZ * vY) / detYZ;
    const y = (deltaZ * uY - deltaY * uZ) / detYZ;
    return [x, y];
  }

  const detXZ = uX * vZ - uZ * vX;
  if (Math.abs(detXZ) > 1e-10) {
    const x = (deltaX * vZ - deltaZ * vX) / detXZ;
    const y = (deltaZ * uX - deltaX * uZ) / detXZ;
    return [x, y];
  }

  return null;
}

/**
 * GPU frame parameters (origin + full-frame u/v spans). Mirrors
 * `SliceGeometry::to_gpu_frame_params`: u/v are scaled by the pixel extent so
 * they span the whole frame; origin carries w=1, spans carry w=0.
 */
export function toGpuFrameParams(plane: ViewPlane): GpuFrameParams {
  const [ox, oy, oz] = plane.origin_mm;
  const [ux, uy, uz] = plane.u_mm;
  const [vx, vy, vz] = plane.v_mm;
  const w = plane.dim_px[0];
  const h = plane.dim_px[1];
  return {
    origin: [ox, oy, oz, 1.0],
    u: [ux * w, uy * w, uz * w, 0.0],
    v: [vx * h, vy * h, vz * h, 0.0],
  };
}

/**
 * Refit a view plane to a new pixel dimension while preserving the world-space
 * field of view, recomputing an isotropic (square-pixel) per-pixel step and
 * re-centering symmetrically. Mirrors `SliceGeometry::refit_to_px`.
 */
export function refitToPx(plane: ViewPlane, width: number, height: number): ViewPlane {
  const baseWidth = plane.dim_px?.[0] > 0 ? plane.dim_px[0] : width;
  const baseHeight = plane.dim_px?.[1] > 0 ? plane.dim_px[1] : height;
  const uMagnitude = magnitude(plane.u_mm as Vec3);
  const vMagnitude = magnitude(plane.v_mm as Vec3);

  if (uMagnitude === 0 || vMagnitude === 0) {
    return {
      ...plane,
      dim_px: [width, height],
    };
  }

  const totalUMm = uMagnitude * baseWidth;
  const totalVMm = vMagnitude * baseHeight;
  const pixelSize = Math.max(totalUMm / Math.max(width, 1), totalVMm / Math.max(height, 1));

  const uDirection = scale(plane.u_mm as Vec3, 1 / uMagnitude);
  const vDirection = scale(plane.v_mm as Vec3, 1 / vMagnitude);
  const resizedU = scale(uDirection, pixelSize);
  const resizedV = scale(vDirection, pixelSize);
  const originalCenter = add(
    plane.origin_mm as Vec3,
    add(scale(plane.u_mm as Vec3, baseWidth / 2), scale(plane.v_mm as Vec3, baseHeight / 2)),
  );
  const resizedOrigin = subtract(
    originalCenter,
    add(scale(resizedU, width / 2), scale(resizedV, height / 2)),
  );

  return {
    ...plane,
    origin_mm: resizedOrigin,
    u_mm: resizedU,
    v_mm: resizedV,
    dim_px: [width, height],
  };
}

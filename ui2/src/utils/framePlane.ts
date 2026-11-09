/**
 * The view plane a rendered frame was rendered for.
 *
 * A resize, pan or zoom changes a view's plane at once, but the frame for
 * the new plane arrives a render later. Until then the canvas still shows
 * the old frame. Overlays (the crosshair) and pointer mapping projected
 * with the new plane onto the old frame land in the wrong place, so during
 * a splitter drag the crosshair jumped on every resize step and snapped
 * back when the matching frame landed. Render services tag each bitmap
 * with the plane they rendered it for; the slice view draws and maps with
 * {@link displayPlane}.
 */

import type { ViewPlane } from '@/types/coordinates';

const bitmapPlanes = new WeakMap<object, ViewPlane>();

/** Record the plane (CSS pixels) a bitmap was rendered for. */
export function tagBitmapPlane<T extends object | null | undefined>(
  bitmap: T,
  plane: ViewPlane | undefined,
): T {
  if (bitmap && plane) bitmapPlanes.set(bitmap, plane);
  return bitmap;
}

/** The plane a bitmap was rendered for, when its renderer recorded one. */
export function bitmapPlane(bitmap: object | null | undefined): ViewPlane | undefined {
  return bitmap ? bitmapPlanes.get(bitmap) : undefined;
}

type Vec3 = [number, number, number];

function sub(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(a: Vec3): Vec3 | null {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 1e-10 ? [a[0] / n, a[1] / n, a[2] / n] : null;
}

function samePlane(a: ViewPlane, b: ViewPlane): boolean {
  const eq = (x: readonly number[], y: readonly number[]) => x.every((value, i) => value === y[i]);
  return eq(a.origin_mm, b.origin_mm) && eq(a.u_mm, b.u_mm) && eq(a.v_mm, b.v_mm) && eq(a.dim_px, b.dim_px);
}

/**
 * The plane the displayed frame shows: its in-plane geometry (origin, U, V,
 * size), at the current plane's depth. The depth follows the current plane
 * so a slice step in another view never hides the crosshair until the next
 * frame (the frame plane would otherwise sit off the crosshair's slice).
 * The current plane when the frame has none, or when the two planes face
 * different ways (an oblique rotation).
 */
export function displayPlane(current: ViewPlane, frame: ViewPlane | undefined): ViewPlane {
  if (!frame || frame === current) return current;
  const n = unit(cross(frame.u_mm, frame.v_mm));
  const nCurrent = unit(cross(current.u_mm, current.v_mm));
  if (!n || !nCurrent || Math.abs(dot(n, nCurrent)) < 1 - 1e-6) return current;
  const depth = dot(sub(current.origin_mm, frame.origin_mm), n);
  if (depth === 0 && samePlane(frame, current)) return current;
  const origin = frame.origin_mm;
  return {
    ...frame,
    origin_mm: [origin[0] + n[0] * depth, origin[1] + n[1] * depth, origin[2] + n[2] * depth],
  } as ViewPlane;
}

import type { ViewPlane, WorldCoordinates } from '@/types/coordinates';

/** Move only along the plane normal, preserving pan, scale and orientation. */
export function alignPlaneToCrosshair(view: ViewPlane, world: WorldCoordinates): void {
  const [u, v] = [view.u_mm, view.v_mm];
  const normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  const length = Math.hypot(...normal);
  if (!Number.isFinite(length) || length === 0) return;
  const n = normal.map(value => value / length);
  const offset = world.reduce((sum, value, axis) => sum + (value - view.origin_mm[axis]) * n[axis], 0);
  if (!Number.isFinite(offset) || Math.abs(offset) < 1e-10) return;
  view.origin_mm = view.origin_mm.map((value, axis) => value + offset * n[axis]) as [number, number, number];
}

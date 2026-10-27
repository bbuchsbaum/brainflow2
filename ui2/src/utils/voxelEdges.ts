/**
 * Voxel-centre bounds (get_volume_bounds, layer worldBounds) widened to the
 * outer voxel edges: half a voxel on each side of each axis, the voxel size
 * along an axis being the centre span over (n − 1). Frames that should show
 * the whole volume use the edges (native N1: an 8³ 10 mm volume spans −40..+40
 * mm, not the −35..+35 of its outer voxel centres); crosshair defaults and
 * slice positions stay on centres.
 */
type Vec3 = [number, number, number];

export function widenToVoxelEdges<B extends { min: Vec3; max: Vec3 }>(
  bounds: B,
  dims: readonly number[] | null | undefined,
): B {
  if (!dims || dims.length < 3) return bounds;
  const min = [...bounds.min] as Vec3;
  const max = [...bounds.max] as Vec3;
  for (let a = 0; a < 3; a += 1) {
    const lo = Math.min(bounds.min[a], bounds.max[a]);
    const hi = Math.max(bounds.min[a], bounds.max[a]);
    const n = dims[a];
    const half = n > 1 ? (hi - lo) / (n - 1) / 2 : 0;
    min[a] = lo - half;
    max[a] = hi + half;
  }
  return { ...bounds, min, max };
}

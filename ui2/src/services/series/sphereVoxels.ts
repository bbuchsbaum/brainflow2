/**
 * Voxels in a sphere locus, counted as the backend gathers them
 * (api_bridge gather_locus_voxels): voxel centres within `radiusMm` of the
 * continuous centre, distance measured with the volume spacing, inside the
 * grid; at least the centre voxel. sample_stack returns only the reduced
 * series, so the caption and CSV count them here (round 3 C9).
 */
export function sphereVoxelCount(
  centre: readonly [number, number, number],
  dims: readonly [number, number, number],
  spacing: readonly [number, number, number],
  radiusMm: number,
): number {
  const inGrid = (i: number, axis: number) => i >= 0 && i < dims[axis];
  const c = centre.map(Math.round);
  if (!(radiusMm > 0)) return c.every(inGrid) ? 1 : 0;
  const half = spacing.map((s) => Math.ceil(radiusMm / s));
  const r2 = radiusMm * radiusMm;
  let n = 0;
  for (let i = c[0] - half[0]; i <= c[0] + half[0]; i += 1) {
    if (!inGrid(i, 0)) continue;
    for (let j = c[1] - half[1]; j <= c[1] + half[1]; j += 1) {
      if (!inGrid(j, 1)) continue;
      for (let k = c[2] - half[2]; k <= c[2] + half[2]; k += 1) {
        if (!inGrid(k, 2)) continue;
        const d = [(i - centre[0]) * spacing[0], (j - centre[1]) * spacing[1], (k - centre[2]) * spacing[2]];
        if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= r2) n += 1;
      }
    }
  }
  return n === 0 && centre.every((v, a) => v >= 0 && v < dims[a]) ? 1 : n;
}

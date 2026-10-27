import { describe, expect, it } from 'vitest';
import { sphereVoxelCount } from '../sphereVoxels';

describe('sphereVoxelCount (mirrors gather_locus_voxels)', () => {
  it('counts voxel centres within the radius on the volume spacing', () => {
    // 6 mm on 2 mm voxels, centred on a voxel: lattice points with i²+j²+k² ≤ 9 → 123.
    expect(sphereVoxelCount([20, 20, 20], [40, 40, 40], [2, 2, 2], 6)).toBe(123);
    // 4 mm on 4 mm voxels: the centre and its 6 face neighbours.
    expect(sphereVoxelCount([10, 23, 30], [41, 49, 40], [4, 4, 4], 4)).toBe(7);
  });
  it('a point is one voxel; the grid edge clips the sphere', () => {
    expect(sphereVoxelCount([3, 3, 3], [8, 8, 8], [2, 2, 2], 0)).toBe(1);
    expect(sphereVoxelCount([0, 0, 0], [8, 8, 8], [2, 2, 2], 2)).toBe(4);
  });
});

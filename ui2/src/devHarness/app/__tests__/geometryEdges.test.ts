import { describe, expect, it } from 'vitest';
import { fullExtent, volumeBounds } from '../geometry';
import type { VolumeFixture } from '../fixtures';

// Native N1, mirrored: an 8³ 10 mm grid with voxel centres at −35..+35.
const vol: VolumeFixture = {
  dims: [8, 8, 8],
  affine: [
    [10, 0, 0, -35],
    [0, 10, 0, -35],
    [0, 0, 10, -35],
    [0, 0, 0, 1],
  ],
  data: new Float32Array(512),
  range: [0, 1],
};

describe('harness view frames reach the voxel edges (mirrors full_extent_to_edges)', () => {
  it('the axial frame spans −40..+40 mm; bounds stay on centres', () => {
    const view = fullExtent(vol, 'axial', [5, 5, 5], [800, 800]);
    expect(view.origin_mm[0]).toBeCloseTo(-40, 4);
    expect(view.origin_mm[1]).toBeCloseTo(40, 4);
    const end = view.origin_mm[0] + view.u_mm[0] * view.width_px;
    expect(end).toBeGreaterThanOrEqual(40 - 1e-3);
    expect(end - 40).toBeLessThanOrEqual(Math.abs(view.u_mm[0]) + 1e-6);
    const b = volumeBounds(vol);
    expect(b.min).toEqual([-35, -35, -35]);
    expect(b.max).toEqual([35, 35, 35]);
  });
});

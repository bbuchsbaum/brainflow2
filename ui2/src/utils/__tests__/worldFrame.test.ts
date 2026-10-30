import { describe, expect, it } from 'vitest';
import type { ViewPlane } from '@/types/coordinates';
import {
  clampToWorldBox,
  edgeBoxFromAffine,
  fitPlaneToWorldBox,
  framesWithin,
  fitViewsToWorldBox,
  sameWorldBox,
  unionWorldBoxes,
  worldBoxFromViews,
  type WorldBox,
} from '@/utils/worldFrame';

// test-data/browser/oblique.nii.gz voxel-edge bounds (permuted voxel axes).
const oblique: WorldBox = { min: [-3, -8.5, 3], max: [11, 6.5, 39] };
const crosshair: [number, number, number] = [4, -1, 21];

describe('worldFrame', () => {
  it('frames each standard pane on world axes with square pixels', () => {
    // Same numbers as the Rust `permuted_affine_views_are_world_planes` case.
    const axial = fitPlaneToWorldBox('axial', oblique, crosshair, [280, 300]);
    expect(axial).toEqual({ origin_mm: [-3, 6.5, 21], u_mm: [0.05, 0, 0], v_mm: [0, -0.05, 0], dim_px: [280, 300] });

    const coronal = fitPlaneToWorldBox('coronal', oblique, crosshair, [280, 720]);
    expect(coronal.origin_mm).toEqual([-3, -1, 39]);
    expect(coronal.u_mm[0]).toBeCloseTo(0.05);
    expect(coronal.v_mm[2]).toBeCloseTo(-0.05);
    expect(coronal.dim_px).toEqual([280, 720]);

    const sagittal = fitPlaneToWorldBox('sagittal', oblique, crosshair, [300, 720]);
    expect(sagittal.origin_mm).toEqual([4, 6.5, 39]);
    expect(sagittal.u_mm[1]).toBeCloseTo(-0.05);
    expect(sagittal.v_mm[2]).toBeCloseTo(-0.05);
    expect(sagittal.dim_px).toEqual([300, 720]);
  });

  it('keeps a reference pane screen direction (a deliberate flip survives)', () => {
    const flipped: ViewPlane = { origin_mm: [0, 0, 0], u_mm: [-1, 0, 0], v_mm: [0, -1, 0], dim_px: [10, 10] };
    const axial = fitPlaneToWorldBox('axial', oblique, crosshair, [280, 300], flipped);
    expect(axial.u_mm[0]).toBeLessThan(0);
    expect(axial.origin_mm[0]).toBe(11);
  });

  it('recovers the framed box from the panes and unions boxes', () => {
    const blank: ViewPlane = { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [512, 512] };
    const views = fitViewsToWorldBox({ axial: blank, sagittal: blank, coronal: blank }, oblique, crosshair);
    const box = worldBoxFromViews(views)!;
    expect(box.min).toEqual(oblique.min);
    for (let a = 0; a < 3; a += 1) {
      expect(box.max[a]).toBeGreaterThanOrEqual(oblique.max[a] - 1e-9);
      expect(box.max[a] - oblique.max[a]).toBeLessThan(0.2);
    }
    expect(unionWorldBoxes([oblique, null, { min: [-1, -31, 29], max: [39, -11, 39] }])).toEqual({
      min: [-3, -31, 3],
      max: [39, 6.5, 39],
    });
    expect(unionWorldBoxes([])).toBeNull();
    expect(sameWorldBox(oblique, { min: [-3, -8.5, 3], max: [11, 6.5, 39.0001] })).toBe(true);
    expect(sameWorldBox(oblique, { min: [-3, -8.5, 3], max: [11, 7, 39] })).toBe(false);
  });

  it('computes the exact voxel-edge box from a column-major affine (review W4)', () => {
    // world = (10 - 2j, -7 + 3i, 5 + 4k); columns i, j, k, translation.
    const affine = [0, 3, 0, 0, -2, 0, 0, 0, 0, 0, 4, 0, 10, -7, 5, 1];
    expect(edgeBoxFromAffine(affine, [5, 7, 9])).toEqual(oblique);
    // Row-major (translation in the bottom row) or degenerate inputs are refused.
    const rowMajor = [0, -2, 0, 10, 3, 0, 0, -7, 0, 0, 4, 5, 0, 0, 0, 1];
    expect(edgeBoxFromAffine(rowMajor, [5, 7, 9])).toBeNull();
    expect(edgeBoxFromAffine(affine, [5, 0, 9])).toBeNull();
    expect(edgeBoxFromAffine(undefined, [5, 7, 9])).toBeNull();
    expect(edgeBoxFromAffine(new Array(16).fill(0), [5, 7, 9])).toBeNull();
  });

  it('clamps a point into a box and tells a fitted frame from a loose one', () => {
    expect(clampToWorldBox([20, 0, -100], oblique)).toEqual([11, 0, 3]);
    expect(clampToWorldBox(crosshair, oblique)).toEqual(crosshair);
    const fitted = { min: [-3, -8.6, 3] as [number, number, number], max: [11.05, 6.5, 39] as [number, number, number] };
    expect(framesWithin(fitted, oblique, 0.11)).toBe(true);
    expect(framesWithin(fitted, oblique, 0.01)).toBe(false);
    expect(framesWithin(oblique, { min: [-4, -8.5, 3], max: [11, 6.5, 39] }, 1)).toBe(false);
  });
});

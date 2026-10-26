import { describe, expect, it } from 'vitest';
import { sliceIndexRange, slicePositionAtIndex } from '../sliceGeometry';
import { brainFraming } from '../brainBounds';

// The harness MNI grid along z: 96 voxel centres from -77.5 to 112.5 mm (2 mm).
const Z = { min: -77.5, max: 112.5, count: 96 };

describe('sliceIndexRange (mosaic crop)', () => {
  it('keeps exactly the slices whose centres lie in the brain range', () => {
    const { first, last } = sliceIndexRange(Z, -59.5, 94.5);
    expect([first, last]).toEqual([9, 86]);
    // Positions are the reference's own: spacing unchanged.
    expect(slicePositionAtIndex(Z, first)).toBe(-59.5);
    expect(slicePositionAtIndex(Z, first + 1) - slicePositionAtIndex(Z, first)).toBe(2);
    expect(slicePositionAtIndex(Z, last)).toBe(94.5);
  });

  it('tolerates f32 noise on a centre and falls back to all slices when unusable', () => {
    expect(sliceIndexRange(Z, -59.50001, 94.50001)).toEqual({ first: 9, last: 86 });
    expect(sliceIndexRange(Z, 500, 600)).toEqual({ first: 0, last: 95 });
    expect(sliceIndexRange(Z, NaN, 1)).toEqual({ first: 0, last: 95 });
    expect(sliceIndexRange({ min: 0, max: 0, count: 1 }, 0, 0)).toEqual({ first: 0, last: 0 });
  });
});

describe('brainFraming', () => {
  it('pads the voxel-centre envelope by half a voxel to the voxel edges', () => {
    expect(
      brainFraming(
        {
          ijkMin: [10, 10, 9],
          ijkMax: [85, 103, 86],
          worldMinMm: [-75.5, -111.5, -59.5],
          worldMaxMm: [74.5, 74.5, 94.5],
          voxelCount: 1,
          timepoint: null,
        },
        [2, 2, 2],
      ),
    ).toEqual({ min: [-76.5, -112.5, -60.5], max: [75.5, 75.5, 95.5] });
  });
});

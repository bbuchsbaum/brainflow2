import { describe, expect, it } from 'vitest';
import { onPlane } from '../relationshipPresentation';

describe('onPlane', () => {
  it('moves a point along the normal onto an axial plane, keeping its in-plane position', () => {
    const plane = { origin_mm: [-90, 126, -7], u_mm: [2, 0, 0], v_mm: [0, -2, 0] };
    expect(onPlane([12, -40, -8], plane)).toEqual([12, -40, -7]);
  });

  it('works for an oblique plane and leaves a point already on it alone', () => {
    const plane = { origin_mm: [0, 0, 0], u_mm: [1, 1, 0], v_mm: [0, 0, 1] };
    const [x, y, z] = onPlane([2, 0, 5], plane);
    expect([x, y, z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 1, 5]);
    expect(onPlane([3, 3, -2], plane)).toEqual([3, 3, -2]);
  });

  it('returns the point for a degenerate plane', () => {
    expect(onPlane([1, 2, 3], { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [2, 0, 0] })).toEqual([1, 2, 3]);
  });
});

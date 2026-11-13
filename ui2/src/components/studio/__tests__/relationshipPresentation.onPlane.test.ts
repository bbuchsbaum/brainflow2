import { describe, expect, it } from 'vitest';
import { onPlane, peekStepPlane, steppedPeekView } from '../relationshipPresentation';

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

describe('steppedPeekView', () => {
  const axial = { origin_mm: [0, 0, 10] as [number, number, number], u_mm: [2, 0, 0] as [number, number, number], v_mm: [0, -2, 0] as [number, number, number], dim_px: [4, 4] as [number, number] };
  const view = { orientation: 'axial' as const, crosshairMm: [0, 0, 10] as [number, number, number] };

  it('steps one voxel layer of the shown raster, so every wheel notch shows a new slice', () => {
    const shown = { orientation: 'axial' as const, plane: axial, normalStepMm: 2 };
    expect(steppedPeekView(view, 1, shown).crosshairMm).toEqual([0, 0, 12]);
    expect(steppedPeekView(view, -1, shown).crosshairMm).toEqual([0, 0, 8]);
  });

  it('steps 1 mm when the raster does not report its grid, or none is shown yet', () => {
    expect(steppedPeekView(view, 1, { orientation: 'axial', plane: axial }).crosshairMm).toEqual([0, 0, 11]);
    expect(steppedPeekView(view, 1, null).crosshairMm).toEqual([0, 0, 11]);
  });

  it('only a raster in the view\'s own plane counts', () => {
    const coronal = { orientation: 'coronal' as const, plane: axial, normalStepMm: 3 };
    expect(peekStepPlane(coronal, view)).toBeNull();
    expect(peekStepPlane({ ...coronal, orientation: 'axial' }, view)).not.toBeNull();
  });
});

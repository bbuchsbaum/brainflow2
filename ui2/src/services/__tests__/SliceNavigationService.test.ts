import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SliceNavigationService, sliceRangeForMetadata } from '../SliceNavigationService';
const { crosshair, metadata, setCrosshair } = vi.hoisted(() => ({
  crosshair: { world_mm: [-8, 13, 3] },
  metadata: { worldBounds: { min: [-10, 7, 0], max: [8, 19, 189] }, dimensions: [10, 5, 64] },
  setCrosshair: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/stores/layerStore', () => ({ useLayerStore: { getState: () => ({
  layers: [{ id: 'base', visible: true }], getLayerMetadata: () => metadata,
}) } }));
vi.mock('@/stores/viewStateStore', () => ({ useViewStateStore: { getState: () => ({ viewState: { crosshair }, setCrosshair }) } }));
describe('slice navigation sampling', () => {
  beforeEach(() => setCrosshair.mockClear());
  it('uses physical reference spacing on all three axes', () => {
    const service = new SliceNavigationService();
    expect(service.getSliceRange('axial')).toEqual({ min: 0, max: 189, step: 3, current: 3 });
    expect(service.getSliceRange('sagittal').step).toBe(2);
    expect(service.getSliceRange('coronal').step).toBe(3);
  });
  it('clamps navigation, preserves other axes, and rejects nonfinite or duplicate updates', () => {
    const service = new SliceNavigationService();
    service.updateSlicePosition('axial', NaN);
    service.updateSlicePosition('axial', 3);
    expect(setCrosshair).not.toHaveBeenCalled();
    service.updateSlicePosition('axial', 999);
    expect(setCrosshair).toHaveBeenCalledWith([-8, 13, 189], true, true);
  });
  it('steps one voxel along each world axis of a permuted grid (review M9)', () => {
    // test-data/browser/oblique.nii.gz: world = (10 - 2j, -7 + 3i, 5 + 4k),
    // 5x7x9 voxels. Voxel j runs along X (2 mm), voxel i along Y (3 mm); the
    // voxel counts are per voxel axis, so (range / (count - 1)) gave 3 and 2.
    const permuted = {
      worldBounds: { min: [-2, -7, 5] as [number, number, number], max: [10, 5, 37] as [number, number, number] },
      dimensions: [5, 7, 9] as [number, number, number],
      // Column-major: columns i, j, k, translation.
      voxelToWorld: [0, 3, 0, 0, -2, 0, 0, 0, 0, 0, 4, 0, 10, -7, 5, 1],
    };
    expect(sliceRangeForMetadata(permuted, 0, 4).step).toBe(2);
    expect(sliceRangeForMetadata(permuted, 1, 0).step).toBe(3);
    expect(sliceRangeForMetadata(permuted, 2, 21).step).toBe(4);
    // A 20-degree in-plane rotation steps by the aligned voxel axis's projection.
    const c = Math.cos(Math.PI / 9);
    const s = Math.sin(Math.PI / 9);
    const rotated = { ...permuted, voxelToWorld: [2 * c, 2 * s, 0, 0, -2 * s, 2 * c, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1] };
    expect(sliceRangeForMetadata(rotated, 0, 0).step).toBeCloseTo(2 * c);
  });
});

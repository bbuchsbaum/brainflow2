import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SliceNavigationService } from '../SliceNavigationService';
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
});

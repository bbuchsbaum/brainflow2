import { describe, expect, it } from 'vitest';
import { nativeGridTransform, voxelWorld } from '@/modules/segmentation/components/shared/TracingOverlay';
import { info } from './liveFixtures';
describe('native label overlay projection', () => {
  it('uses physical anisotropic voxel sizes and the actual translated affine', () => {
    const snapshot = info().snapshot;
    const plane = { origin_mm: [9.8, -18, 4.8] as [number, number, number], u_mm: [.1, 0, 0] as [number, number, number], v_mm: [0, 0, .1] as [number, number, number], dim_px: [20, 28] as [number, number] };
    const transform = nativeGridTransform(snapshot, 1, plane, { x: 0, y: 0, width: 200, height: 280, imageWidth: 20, imageHeight: 28 })!;
    [40, 0, 0, 40, 0, 0].forEach((value, index) => expect(transform[index]).toBeCloseTo(value));
    expect(voxelWorld(snapshot.voxelToWorld, [2, 1, 3])).toEqual([10.8, -18, 6.2]);
  });
  it('preserves shear and a deliberate display mirror without compensating geometry flips', () => {
    const snapshot = info().snapshot; snapshot.normalAxis = 2;
    snapshot.voxelToWorld = [.4, 0, 0, 0, .2, .8, 0, 0, 0, 0, 2, 0, 10, -20, 5, 1];
    const plane = { origin_mm: [10, -20, 5] as [number, number, number], u_mm: [1, 0, 0] as [number, number, number], v_mm: [0, 1, 0] as [number, number, number], dim_px: [20, 20] as [number, number] };
    const placement = { x: 0, y: 0, width: 200, height: 200, imageWidth: 20, imageHeight: 20 };
    const expected = [4, 0, 2, 8, -3, -4];
    nativeGridTransform(snapshot, 0, plane, placement)!.forEach((value, index) => expect(value).toBeCloseTo(expected[index]));
    const mirrored = [-4, 0, -2, 8, 203, -4];
    nativeGridTransform(snapshot, 0, plane, { ...placement, mirrorX: true })!.forEach((value, index) => expect(value).toBeCloseTo(mirrored[index]));
  });
});

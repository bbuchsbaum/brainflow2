import { describe, expect, it } from 'vitest';
import { bboxOf, centreOf } from '@/modules/segmentation/components/shared/geometry';
import { nativeGridTransform, tracingClearance, voxelWorld } from '@/modules/segmentation/components/shared/TracingOverlay';
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

it('keeps the crosshair outside the structure and three physical brush radii', () => {
  const snapshot = info().snapshot;
  const plane = { origin_mm: [9.8, -18, 4.8] as [number, number, number], u_mm: [.1, 0, 0] as [number, number, number], v_mm: [0, 0, .1] as [number, number, number], dim_px: [20, 28] as [number, number] };
  const slice = { revision: 0, plane: { ...plane, width_px: 20, height_px: 28 }, labels: [[2, 1, 3, 1] as [number, number, number, number]], previousLabels: [], nextLabels: [] };
  const boxes = tracingClearance(snapshot, slice, 1, plane, { x: 0, y: 0, width: 200, height: 280, imageWidth: 20, imageHeight: 28 }, [10.8, -18, 6.2], .4);
  [76, 116, 48, 48].forEach((value, index) => expect([boxes[0].x, boxes[0].y, boxes[0].width, boxes[0].height][index]).toBeCloseTo(value));
  expect(boxes[1].width).toBeCloseTo(240); expect(boxes[1].height).toBeCloseTo(240);
});

it('handles native label extents larger than the JavaScript argument stack', () => {
  const voxels = Array.from({ length: 262144 }, (_, index) => [index % 512, Math.floor(index / 512)] as const);
  expect(bboxOf(voxels)).toEqual({ x0: 0, y0: 0, x1: 512, y1: 512 });
  expect(centreOf(voxels)).toEqual([256, 256]);
});

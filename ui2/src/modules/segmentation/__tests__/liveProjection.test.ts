import { describe, expect, it } from 'vitest';
import { bboxOf, centreOf } from '@/modules/segmentation/components/shared/geometry';
import { brushRadiusPx, footprintVoxels, nativeGridTransform, tracingClearance, voxelWorld } from '@/modules/segmentation/components/shared/TracingOverlay';
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

it('clears the crosshair three physical brush radii around the brush, and only while it is over the image', () => {
  const plane = { origin_mm: [9.8, -18, 4.8] as [number, number, number], u_mm: [.1, 0, 0] as [number, number, number], v_mm: [0, 0, .1] as [number, number, number], dim_px: [20, 28] as [number, number] };
  // 0.4 mm at 0.1 mm per image pixel and 10 canvas px per image pixel: 40 px.
  const radius = brushRadiusPx(.4, plane, { x: 0, y: 0, width: 200, height: 280, imageWidth: 20, imageHeight: 28 });
  expect(radius).toBeCloseTo(40);
  const [box] = tracingClearance({ x: 100, y: 120 }, radius);
  [-20, 0, 240, 240].forEach((value, index) => expect([box.x, box.y, box.width, box.height][index]).toBeCloseTo(value));
  // Away from the image (or with Navigate) the crosshair is whole, even with labels on the slice.
  expect(tracingClearance(null, radius)).toEqual([]);
});

describe('brush footprint under the pointer', () => {
  // 10 canvas px per voxel, origin at (0, 0): voxel (c, r) spans [10c, 10c + 10).
  const grid = [10, 0, 0, 10, 0, 0];
  it('takes exactly the voxels whose centres fall inside the disc', () => {
    // Centred on voxel (5, 5)'s centre with a 10 px radius: it and its four edge neighbours
    // (centres 10 px away) but not the diagonals (14.1 px away).
    const cells = footprintVoxels(grid, { x: 55, y: 55, radiusPx: 10 }).map(([x, y]) => `${x},${y}`).sort();
    expect(cells).toEqual(['4,5', '5,4', '5,5', '5,6', '6,5']);
  });
  it('follows shear and mirroring in the grid transform', () => {
    // Mirrored in x: voxel c sits at canvas x = 200 - 10c - 10 .. 200 - 10c.
    const mirrored = [-10, 0, 0, 10, 200, 0];
    expect(footprintVoxels(mirrored, { x: 145, y: 55, radiusPx: 4 })).toEqual([[5, 5]]);
  });
  it('finds every voxel of the disc on a strongly sheared grid', () => {
    const sheared = [10, 0, 9.5, 2, 30, 40];
    const hover = { x: 120, y: 60, radiusPx: 25 };
    const brute: string[] = [];
    for (let x = -40; x <= 40; x++) for (let y = -40; y <= 40; y++) {
      const px = 10 * (x + .5) + 9.5 * (y + .5) + 30, py = 2 * (y + .5) + 40;
      if (Math.hypot(px - hover.x, py - hover.y) <= hover.radiusPx) brute.push(`${x},${y}`);
    }
    expect(footprintVoxels(sheared, hover).map(([x, y]) => `${x},${y}`).sort()).toEqual(brute.sort());
  });
  it('is empty for a zero radius or a degenerate grid', () => {
    expect(footprintVoxels(grid, { x: 55, y: 55, radiusPx: 0 })).toEqual([]);
    expect(footprintVoxels([0, 0, 0, 0, 0, 0], { x: 55, y: 55, radiusPx: 5 })).toEqual([]);
  });
});

it('handles native label extents larger than the JavaScript argument stack', () => {
  const voxels = Array.from({ length: 262144 }, (_, index) => [index % 512, Math.floor(index / 512)] as const);
  expect(bboxOf(voxels)).toEqual({ x0: 0, y0: 0, x1: 512, y1: 512 });
  expect(centreOf(voxels)).toEqual([256, 256]);
});

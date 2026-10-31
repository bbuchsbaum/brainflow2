import { describe, expect, it } from 'vitest';
import {
  discFootprint,
  displayToWorld,
  gateStroke,
  labelIndex,
  strokeFootprint,
  voxelOutlinePath,
  worldToDisplay,
} from '@/modules/segmentation/components/shared/geometry';
import { SCENE } from '@/modules/segmentation/components/shared/scenes';

describe('segmentation geometry', () => {
  it('maps world mm to display and back on every plane', () => {
    const w = [-26, -22, -16] as const;
    for (const plane of ['coronal', 'axial', 'sagittal'] as const) {
      const p = worldToDisplay(plane, w);
      const index = plane === 'coronal' ? 110 : plane === 'axial' ? 62 : 70;
      expect(displayToWorld(plane, index, p)).toEqual([...w]);
    }
  });

  it('paints voxels whose centres lie inside the brush disc', () => {
    // Centred on a voxel centre, radius 1.5 mm: the 3 x 3 block.
    expect(discFootprint([10.5, 10.5], 1.5)).toHaveLength(9);
    // Radius 1 mm: the centre and its four neighbours.
    expect(discFootprint([10.5, 10.5], 1)).toHaveLength(5);
    // A stroke is the union of the discs swept along it: a 5-voxel row plus
    // the voxels above and below the three centres it passes through.
    expect(strokeFootprint([[10.5, 10.5], [12.5, 10.5]], 1).length).toBe(11);
  });

  it('never writes into locked labels and reports what it refused', () => {
    const labels = labelIndex([
      [10, 10, 3],
      [11, 10, 3],
      [12, 10, 0],
    ]);
    const gate = gateStroke(
      [
        [10, 10],
        [11, 10],
        [12, 10],
        [13, 10],
      ],
      labels,
      1,
      new Set([3]),
      'unlocked',
    );
    expect(gate.written).toEqual([
      [12, 10],
      [13, 10],
    ]);
    expect(gate.blocked.map((b) => b.label)).toEqual([3, 3]);
    expect(gateStroke([[10, 10]], labels, 1, new Set(), 'background').blocked).toHaveLength(1);
  });

  it('outlines a single voxel with its four edges', () => {
    expect(voxelOutlinePath([[2, 3]]).match(/M/g)).toHaveLength(4);
  });

  it('the blocked-stroke scene really writes nothing', () => {
    expect(SCENE.blocked.written).toBe(0);
    expect(SCENE.blocked.blocked).toBeGreaterThan(0);
    expect(SCENE.tracing.wet.length).toBeGreaterThan(0);
  });
});

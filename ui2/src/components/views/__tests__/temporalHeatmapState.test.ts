import { describe, expect, it } from 'vitest';
import {
  computeTemporalHeatmapSliceIndex,
  isTemporalHeatmapEligible,
} from '../temporalHeatmapState';

describe('isTemporalHeatmapEligible', () => {
  it('detects 4D eligibility from LayerInfo rather than metadata', () => {
    expect(
      isTemporalHeatmapEligible({
        volumeId: 'vol-4d',
        volumeType: 'TimeSeries4D',
        timeSeriesInfo: undefined,
      } as any)
    ).toBe(true);

    expect(
      isTemporalHeatmapEligible({
        volumeId: 'vol-4d',
        volumeType: 'Volume3D',
        timeSeriesInfo: { num_timepoints: 12 },
      } as any)
    ).toBe(true);

    expect(
      isTemporalHeatmapEligible({
        volumeId: 'vol-3d',
        volumeType: 'Volume3D',
        timeSeriesInfo: { num_timepoints: 1 },
      } as any)
    ).toBe(false);
  });
});

describe('computeTemporalHeatmapSliceIndex', () => {
  it('uses metadata.dimensions to clamp the computed slice index', () => {
    const sliceIndex = computeTemporalHeatmapSliceIndex(
      {
        dimensions: [10, 20, 30],
      },
      [99, 99, 99],
      1
    );

    expect(sliceIndex).toBe(19);
  });

  it('converts world coordinates through worldToVoxel before choosing the slice', () => {
    const translationWorldToVoxel = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      -10, -20, -30, 1,
    ];

    const sliceIndex = computeTemporalHeatmapSliceIndex(
      {
        dimensions: [64, 64, 64],
        worldToVoxel: translationWorldToVoxel,
      },
      [10, 20, 38],
      2
    );

    expect(sliceIndex).toBe(8);
  });
});

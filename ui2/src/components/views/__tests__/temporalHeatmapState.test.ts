import { describe, expect, it } from 'vitest';
import { isTemporalHeatmapEligible } from '../temporalHeatmapState';

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

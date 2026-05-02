import { describe, expect, it } from 'vitest';

import { getDefaultPlotModeForLayer } from '../plotMode.helpers';

describe('getDefaultPlotModeForLayer', () => {
  it('returns histogram for null/undefined layer (no selection)', () => {
    expect(getDefaultPlotModeForLayer(null)).toBe('histogram');
    expect(getDefaultPlotModeForLayer(undefined)).toBe('histogram');
  });

  it('returns histogram for a 3D layer with no timeSeriesInfo', () => {
    expect(getDefaultPlotModeForLayer({ id: 'vol-1' })).toBe('histogram');
  });

  it('returns histogram for a layer with a single timepoint (degenerate 4D)', () => {
    expect(
      getDefaultPlotModeForLayer({ id: 'vol-1', timeSeriesInfo: { num_timepoints: 1 } }),
    ).toBe('histogram');
  });

  it('returns crosshair-time-series for a 4D layer with multiple timepoints', () => {
    expect(
      getDefaultPlotModeForLayer({ id: 'vol-1', timeSeriesInfo: { num_timepoints: 200 } }),
    ).toBe('crosshair-time-series');
  });

  it('returns crosshair-time-series at the 2-timepoint boundary', () => {
    expect(
      getDefaultPlotModeForLayer({ id: 'vol-1', timeSeriesInfo: { num_timepoints: 2 } }),
    ).toBe('crosshair-time-series');
  });
});

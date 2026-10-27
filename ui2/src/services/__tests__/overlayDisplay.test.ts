import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { HOT_ROBUST_HIGH, HOT_VISIBLE_FROM, overlayDisplay } from '../LayerApiImpl';
import { useLayerStore } from '@/stores/layerStore';

const range = { intensity: [0.09, 1.05] as [number, number], threshold: [0, 0] as [number, number], suggestedColormap: undefined };
const fourD = { id: 'fir', type: 'volume', timeSeriesInfo: { num_timepoints: 8 } };

describe('a 4D volume over another is an intensity overlay (v1 G4)', () => {
  it('hot ramp, below-window hidden, when a volume lies beneath', () => {
    useLayerStore.setState({
      layers: [
        { id: 't1', name: 'T1', volumeId: 't1', type: 'volume', visible: true, order: 0 },
        { id: 'fir', name: 'fir', volumeId: 'fir', type: 'volume', visible: true, order: 1, timeSeriesInfo: { num_timepoints: 8 } },
      ],
    } as never);
    const shown = overlayDisplay(fourD, range, { min: -0.1, max: 2.4 }, false);
    expect(shown).toMatchObject({ suggestedColormap: 'hot', threshold: [-0.1, 0.09] });
    // v2 R3: the lowest visible value sits at dark red on the hot LUT, not
    // black, and the robust high at yellow, not saturated white.
    const lut = (v: number) => (v - shown.intensity[0]) / (shown.intensity[1] - shown.intensity[0]);
    expect(lut(0.09)).toBeCloseTo(HOT_VISIBLE_FROM, 6);
    expect(lut(1.05)).toBeCloseTo(HOT_ROBUST_HIGH, 6);
    expect(HOT_VISIBLE_FROM).toBeGreaterThan(0.1);
    expect(HOT_ROBUST_HIGH).toBeLessThan(0.8);
  });

  it('with the all-frame histogram, shows p90..p99.9 of the series (v2 R3)', () => {
    useLayerStore.setState({
      layers: [
        { id: 't1', name: 'T1', volumeId: 't1', type: 'volume', visible: true, order: 0 },
        { id: 'fir', name: 'fir', volumeId: 'fir', type: 'volume', visible: true, order: 1, timeSeriesInfo: { num_timepoints: 8 } },
      ],
    } as never);
    // 1000 values: 950 near zero, 50 a response from 1 to 2.5.
    const bins = [
      { x0: -0.1, x1: 0.1, count: 950 },
      { x0: 0.1, x1: 1, count: 0 },
      { x0: 1, x1: 2.5, count: 50 },
    ];
    const shown = overlayDisplay(fourD, { intensity: [-0.1, 0.1], threshold: [0, 0] }, { min: -0.1, max: 2.5 }, false, { bins, totalCount: 1000 });
    const lut = (v: number) => (v - shown.intensity[0]) / (shown.intensity[1] - shown.intensity[0]);
    // The near-zero bulk is hidden; the response spans dark red to yellow.
    expect(shown.threshold[1]).toBeGreaterThan(0.1);
    expect(lut(shown.threshold[1])).toBeCloseTo(HOT_VISIBLE_FROM, 6);
    expect(lut(2.5)).toBeLessThan(HOT_ROBUST_HIGH + 0.01);
    // A focal peak above p99.9 is not clipped to white: the high edge is ≥ 80% of the maximum.
    const tiny = [
      { x0: -0.1, x1: 0.1, count: 99990 },
      { x0: 2, x1: 2.5, count: 10 },
    ];
    const peak = overlayDisplay(fourD, { intensity: [-0.1, 0.1], threshold: [0, 0] }, { min: -0.1, max: 2.5 }, false, { bins: tiny, totalCount: 100000, maxValue: 2.5 });
    const peakLut = (v: number) => (v - peak.intensity[0]) / (peak.intensity[1] - peak.intensity[0]);
    expect(peakLut(2.5)).toBeLessThan(0.95);
  });

  it('the base 4D volume, a 3D volume and a statistic keep their own display', () => {
    useLayerStore.setState({
      layers: [{ id: 'fir', name: 'fir', volumeId: 'fir', type: 'volume', visible: true, order: 0, timeSeriesInfo: { num_timepoints: 8 } }],
    } as never);
    expect(overlayDisplay(fourD, range, { min: -0.1, max: 2.4 }, false)).toBe(range);
    expect(overlayDisplay({ id: 'x', type: 'volume' }, range, { min: 0, max: 1 }, false)).toBe(range);
    expect(overlayDisplay(fourD, range, { min: 0, max: 1 }, true)).toBe(range);
  });
});

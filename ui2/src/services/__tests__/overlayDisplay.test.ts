import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));

import { overlayDisplay } from '../LayerApiImpl';
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
    expect(overlayDisplay(fourD, range, { min: -0.1, max: 2.4 }, false)).toMatchObject({
      suggestedColormap: 'hot',
      threshold: [-0.1, 0.09],
    });
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

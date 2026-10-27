import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/apiService', () => ({ getApiService: () => ({ setVolumeTimepoint: vi.fn(async () => undefined) }) }));

import { getTimeNavigationService } from '../TimeNavigationService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';

describe('time readout after selecting a shorter run (REVIEW m8)', () => {
  it('clamps the frame to the lead (selected) layer', () => {
    useLayerStore.setState({
      layers: [
        { id: 'long', name: 'run 1', volumeId: 'v1', type: 'functional', visible: true, order: 0, volumeType: 'TimeSeries4D', timeSeriesInfo: { num_timepoints: 40, tr: 2, temporal_unit: 's', acquisition_time: null } },
        { id: 'short', name: 'run 2', volumeId: 'v2', type: 'functional', visible: true, order: 1, volumeType: 'TimeSeries4D', timeSeriesInfo: { num_timepoints: 20, tr: 2, temporal_unit: 's', acquisition_time: null } },
      ],
      selectedLayerId: 'short',
    } as never);
    useViewStateStore.getState().setViewState((state) => {
      state.timepoint = 30;
    });
    const info = getTimeNavigationService().getTimeInfo()!;
    expect(info.totalTimepoints).toBe(20);
    expect(info.currentTimepoint).toBe(19);
  });
});

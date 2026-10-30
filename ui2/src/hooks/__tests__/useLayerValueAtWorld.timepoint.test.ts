import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/SamplingService', () => ({
  sampleLayerAtWorld: vi.fn(async () => ({ value: 2 })),
}));

import { useLayerStore } from '@/stores/layerStore';
import { useLayerValueAtWorld, __resetLayerValueCacheForTests } from '../useLayerValueAtWorld';

describe('useLayerValueAtWorld timepoint', () => {
  it('stamps each reading with the timepoint it was taken at', async () => {
    __resetLayerValueCacheForTests();
    useLayerStore.setState({
      layers: [{ id: 'bold', name: 'bold', volumeId: 'bold', type: 'volume', visible: true, order: 0, currentTimepoint: 3 }] as never,
      layerMetadata: new Map() as never,
    });
    const { result } = renderHook(() => useLayerValueAtWorld('bold', [0, 0, 0], 0));
    await waitFor(() => expect(result.current?.timepoint).toBe(3));
    // Scrubbing: the old reading keeps its own timepoint until the new one lands,
    // so a consumer can tell it is stale.
    act(() =>
      useLayerStore.setState((state) => ({
        layers: state.layers.map((l) => ({ ...l, currentTimepoint: 4 })) as never,
      })),
    );
    expect(result.current?.timepoint).toBe(3);
    await waitFor(() => expect(result.current?.timepoint).toBe(4));
  });
});

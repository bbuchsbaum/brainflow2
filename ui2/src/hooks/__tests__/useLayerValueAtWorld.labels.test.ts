import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/SamplingService', () => ({
  sampleLayerAtWorld: vi.fn(async () => ({ value: 17 })),
}));

import { useLayerStore } from '@/stores/layerStore';
import { useLayerValueAtWorld, __resetLayerValueCacheForTests } from '../useLayerValueAtWorld';

describe('useLayerValueAtWorld for label maps (native v6: atlas row "—")', () => {
  it('trusts the backend when asked, even where the frontend grid test says outside', async () => {
    __resetLayerValueCacheForTests();
    // Metadata whose grid disagrees with the sample point (e.g. a resampled atlas).
    useLayerStore.setState({
      layerMetadata: new Map([['atlas', { dimensions: [2, 2, 2], worldToVoxel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }]]) as never,
    });
    const outside = renderHook(() => useLayerValueAtWorld('atlas', [-36, -1, 9], 0));
    const trusted = renderHook(() => useLayerValueAtWorld('atlas', [-36, -1, 9], 0, true));
    await waitFor(() => expect(trusted.result.current?.value).toBe(17));
    expect(outside.result.current?.value ?? null).toBeNull();
  });
});

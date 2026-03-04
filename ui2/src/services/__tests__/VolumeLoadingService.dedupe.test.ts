import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getVolumeLoadingService } from '../VolumeLoadingService';
import { useLayerStore } from '@/stores/layerStore';

vi.mock('@/events/EventBus', () => ({
  getEventBus: vi.fn(() => ({
    emit: vi.fn(),
  })),
}));

vi.mock('../apiService', () => ({
  getApiService: vi.fn(() => ({
    getVolumeBounds: vi.fn(),
  })),
}));

vi.mock('../LayerService', () => ({
  getLayerService: vi.fn(() => ({
    addLayer: vi.fn(),
  })),
}));

vi.mock('@/stores/layerStore', () => ({
  useLayerStore: {
    getState: vi.fn(),
  },
}));

describe('VolumeLoadingService atlas deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses existing atlas layer with matching metadata', async () => {
    const existingLayer: any = {
      id: 'layer-atlas-1',
      name: 'Schaefer 200 (MNI)',
      volumeId: 'volume-handle-1',
      visible: true,
      order: 0,
      source: 'atlas',
      sourcePath: 'atlas:schaefer2018',
      atlasMetadata: {
        id: 'schaefer2018',
        space: 'MNI152',
        resolution: 1,
        n_regions: 200,
      },
    };

    (useLayerStore.getState as any).mockReturnValue({
      layers: [existingLayer],
    });

    const service = getVolumeLoadingService();

    const result = await service.loadVolume({
      volumeHandle: {
        id: 'volume-handle-1',
        name: 'Schaefer 200',
        dims: [182, 218, 182],
        dtype: 'f32',
        volume_type: 'Volume3D',
      } as any,
      displayName: 'Schaefer 200',
      source: 'atlas',
      sourcePath: 'atlas:schaefer2018',
      layerType: 'label',
      visible: true,
      atlasMetadata: {
        id: 'schaefer2018',
        space: 'MNI152',
        resolution: 1,
        n_regions: 200,
      } as any,
    });

    expect(result).toBe(existingLayer);
    expect((useLayerStore.getState as any)).toHaveBeenCalled();
  });
});


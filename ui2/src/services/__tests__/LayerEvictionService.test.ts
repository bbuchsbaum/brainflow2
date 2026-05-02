import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_GPU_LAYERS, layerEvictionService } from '@/services/LayerEvictionService';

const {
  mockLayerStoreState,
  mockViewStateStoreState,
  mockApiService,
  mockEventBus,
} = vi.hoisted(() => ({
  mockLayerStoreState: {
    layers: [],
    layerMetadata: new Map<string, any>(),
    setLayerMetadata: vi.fn(),
  },
  mockViewStateStoreState: {
    viewState: {
      layers: [],
    },
  },
  mockApiService: {
    releaseLayerGpuResources: vi.fn().mockResolvedValue(undefined),
  },
  mockEventBus: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('@/stores/layerStore', () => ({
  useLayerStore: {
    getState: () => mockLayerStoreState,
  },
}));

vi.mock('@/stores/viewStateStore', () => ({
  useViewStateStore: {
    getState: () => mockViewStateStoreState,
  },
}));

vi.mock('@/services/apiService', () => ({
  getApiService: () => mockApiService,
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => mockEventBus,
}));

describe('LayerEvictionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLayerStoreState.layers = [];
    mockLayerStoreState.layerMetadata = new Map();
    mockLayerStoreState.setLayerMetadata.mockImplementation((id: string, metadata: any) => {
      mockLayerStoreState.layerMetadata.set(id, metadata);
    });
    mockViewStateStoreState.viewState = {
      layers: [],
    };
  });

  it('ignores deferred hidden layers and evicts the oldest invisible resident layer when over budget', async () => {
    const visibleLayers = Array.from({ length: MAX_GPU_LAYERS }, (_, index) => ({
      id: `visible-${index}`,
      name: `Visible ${index}`,
      volumeId: `visible-${index}`,
      visible: true,
      type: 'anatomical',
      order: index,
    }));

    const hiddenResidentLayer = {
      id: 'hidden-resident',
      name: 'Hidden Resident',
      volumeId: 'hidden-resident',
      visible: false,
      type: 'anatomical',
      order: MAX_GPU_LAYERS,
    };

    const hiddenDeferredLayer = {
      id: 'hidden-deferred',
      name: 'Hidden Deferred',
      volumeId: 'hidden-deferred',
      visible: false,
      type: 'anatomical',
      order: MAX_GPU_LAYERS + 1,
    };

    mockLayerStoreState.layers = [...visibleLayers, hiddenResidentLayer, hiddenDeferredLayer];
    mockViewStateStoreState.viewState.layers = [
      ...visibleLayers.map((layer) => ({ id: layer.id, visible: true })),
      { id: hiddenResidentLayer.id, visible: false },
      { id: hiddenDeferredLayer.id, visible: false },
    ];

    for (const [index, layer] of visibleLayers.entries()) {
      mockLayerStoreState.layerMetadata.set(layer.id, {
        gpuResident: true,
        evicted: false,
        lastRenderTime: 100 + index,
      });
    }

    mockLayerStoreState.layerMetadata.set(hiddenResidentLayer.id, {
      gpuResident: true,
      evicted: false,
      lastRenderTime: 1,
    });

    mockLayerStoreState.layerMetadata.set(hiddenDeferredLayer.id, {
      gpuResident: false,
      evicted: false,
    });

    await layerEvictionService.checkAndEvict();

    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('hidden-resident');
    expect(mockLayerStoreState.layerMetadata.get('hidden-resident')).toMatchObject({
      gpuResident: false,
      evicted: true,
    });
    expect(mockLayerStoreState.layerMetadata.get('hidden-deferred')).toMatchObject({
      gpuResident: false,
      evicted: false,
    });
  });
});

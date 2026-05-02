import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerApiImpl } from '@/services/LayerApiImpl';

const {
  mockApiService,
  mockQueueState,
  mockLayerStoreState,
  mockViewStateStoreState,
  mockClearVolumeHandle,
  mockHistogramService,
  mockEventBus,
  mockLayerEvictionService,
} = vi.hoisted(() => ({
  mockApiService: {
    requestLayerGpuResources: vi.fn(),
    waitForLayerReady: vi.fn(),
    unloadVolume: vi.fn(),
    releaseLayerGpuResources: vi.fn(),
    patchLayer: vi.fn(),
  },
  mockQueueState: {
    isLoading: vi.fn(() => false),
    enqueue: vi.fn(() => 'queue-1'),
    startLoading: vi.fn(),
    updateProgress: vi.fn(),
    markComplete: vi.fn(),
    markError: vi.fn(),
  },
  mockLayerStoreState: {
    layers: [],
    layerMetadata: new Map<string, any>(),
    getLayer: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    setLayerMetadata: vi.fn(),
    updateLayer: vi.fn(),
    getLayerMetadata: vi.fn(() => undefined),
  },
  mockViewStateStoreState: {
    viewState: {
      layers: [{ id: 'layer-1' }, { id: 'layer-2' }],
    },
    setViewState: vi.fn(),
  },
  mockClearVolumeHandle: vi.fn(),
  mockHistogramService: {
    computeHistogram: vi.fn(),
  },
  mockEventBus: {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
  },
  mockLayerEvictionService: {
    touchLayer: vi.fn(),
    checkAndEvict: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/apiService', () => ({
  getApiService: () => mockApiService,
}));

vi.mock('@/stores/loadingQueueStore', () => ({
  useLoadingQueueStore: {
    getState: () => mockQueueState,
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

vi.mock('@/services/VolumeHandleStore', () => ({
  VolumeHandleStore: {
    clearVolumeHandle: mockClearVolumeHandle,
  },
}));

vi.mock('@/services/HistogramService', () => ({
  histogramService: mockHistogramService,
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => mockEventBus,
}));

vi.mock('@/services/LayerEvictionService', () => ({
  layerEvictionService: mockLayerEvictionService,
}));

describe('LayerApiImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueState.isLoading.mockReturnValue(false);
    mockQueueState.enqueue.mockReturnValue('queue-1');
    mockApiService.requestLayerGpuResources.mockResolvedValue({
      data_range: { min: 0, max: 100 },
      center_world: [0, 0, 0],
      is_binary_like: false,
      dim: [16, 16, 16],
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      voxel_to_world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      world_to_voxel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      tex_format: 'r32float',
    });
    mockApiService.waitForLayerReady.mockResolvedValue(true);
    mockHistogramService.computeHistogram.mockResolvedValue({
      bins: [
        { x0: 0, x1: 50, count: 1 },
        { x0: 50, x1: 100, count: 1 },
      ],
      totalCount: 2,
      mean: 50,
    });
    mockLayerStoreState.getLayer.mockReturnValue({
      id: 'layer-1',
      name: 'T1 Volume',
      volumeId: 'vol-1',
      visible: true,
      type: 'anatomical',
    });
    mockLayerStoreState.layers = [];
    mockLayerStoreState.layerMetadata = new Map();
    mockLayerStoreState.getLayerMetadata.mockImplementation((id: string) =>
      mockLayerStoreState.layerMetadata.get(id)
    );
    mockLayerStoreState.setLayerMetadata.mockImplementation((id: string, metadata: any) => {
      mockLayerStoreState.layerMetadata.set(id, metadata);
    });
    mockLayerStoreState.addLayer.mockImplementation((layer: any) => {
      mockLayerStoreState.layers.push(layer);
    });
    mockViewStateStoreState.viewState = {
      layers: [],
    };
    mockViewStateStoreState.setViewState.mockImplementation((updater: any) => {
      updater(mockViewStateStoreState.viewState);
    });
  });

  it('routes volume removal through the lifecycle queue with retry metadata', async () => {
    const api = new LayerApiImpl();

    await api.removeLayer('layer-1');

    expect(mockQueueState.enqueue).toHaveBeenCalledWith({
      type: 'volume-unload',
      path: 'volume-unload:vol-1',
      displayName: 'T1 Volume',
      retry: {
        kind: 'volume-unload',
        layerId: 'layer-1',
      },
    });
    expect(mockQueueState.startLoading).toHaveBeenCalledWith('queue-1');
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('layer-1');
    expect(mockApiService.unloadVolume).toHaveBeenCalledWith('vol-1');
    expect(mockClearVolumeHandle).toHaveBeenCalledWith('vol-1');
    expect(mockLayerStoreState.removeLayer).toHaveBeenCalledWith('layer-1');
    expect(mockViewStateStoreState.setViewState).toHaveBeenCalledTimes(1);
    expect(mockQueueState.markComplete).toHaveBeenCalledWith('queue-1');
  });

  it('requests metadata-only resources when adding an initially hidden layer', async () => {
    const api = new LayerApiImpl();

    await api.addLayer({
      name: 'Hidden Volume',
      volumeId: 'vol-hidden',
      visible: false,
      type: 'anatomical',
      order: 0,
    });

    expect(mockApiService.requestLayerGpuResources).toHaveBeenCalledWith(
      'vol-hidden',
      'vol-hidden',
      true
    );
    expect(mockApiService.waitForLayerReady).not.toHaveBeenCalled();
    expect(mockHistogramService.computeHistogram).not.toHaveBeenCalled();
    expect(mockLayerStoreState.layerMetadata.get('vol-hidden')?.gpuResident).toBe(false);
    expect(mockLayerEvictionService.touchLayer).not.toHaveBeenCalled();
    expect(mockLayerEvictionService.checkAndEvict).not.toHaveBeenCalled();
  });

  it('checks eviction budget after adding an initially visible layer', async () => {
    const api = new LayerApiImpl();

    await api.addLayer({
      name: 'Visible Volume',
      volumeId: 'vol-visible',
      visible: true,
      type: 'anatomical',
      order: 0,
    });

    expect(mockLayerEvictionService.touchLayer).toHaveBeenCalledWith('vol-visible');
    expect(mockLayerEvictionService.checkAndEvict).toHaveBeenCalledTimes(1);
  });

  it('promotes a non-resident hidden layer when it becomes visible', async () => {
    const api = new LayerApiImpl();
    mockLayerStoreState.getLayer.mockReturnValue({
      id: 'layer-1',
      name: 'Hidden Volume',
      volumeId: 'vol-1',
      visible: false,
      type: 'anatomical',
    });
    mockLayerStoreState.layerMetadata.set('layer-1', {
      gpuResident: false,
      renderProps: {
        opacity: 0,
        intensity: [20, 80],
        threshold: [50, 50],
        colormap: 'gray',
        interpolation: 'linear',
      },
    });

    await api.updateLayer('layer-1', { visible: true });

    expect(mockApiService.requestLayerGpuResources).toHaveBeenCalledWith(
      'layer-1',
      'vol-1',
      false
    );
    expect(mockApiService.waitForLayerReady).toHaveBeenCalledWith('layer-1', 500, 20);
    expect(mockLayerStoreState.layerMetadata.get('layer-1')?.gpuResident).toBe(true);
    expect(mockLayerEvictionService.touchLayer).toHaveBeenCalledWith('layer-1');
    expect(mockLayerEvictionService.checkAndEvict).toHaveBeenCalledTimes(1);
  });

  it('loadLayerData promotes a deferred layer to GPU residency without changing visibility', async () => {
    const api = new LayerApiImpl();
    mockLayerStoreState.getLayer.mockReturnValue({
      id: 'layer-1',
      name: 'Deferred Volume',
      volumeId: 'vol-1',
      visible: false,
      type: 'anatomical',
    });
    mockLayerStoreState.layerMetadata.set('layer-1', {
      gpuResident: false,
      renderProps: {
        opacity: 0,
        intensity: [20, 80],
        threshold: [50, 50],
        colormap: 'gray',
        interpolation: 'linear',
      },
    });

    await api.loadLayerData('layer-1');

    expect(mockApiService.requestLayerGpuResources).toHaveBeenCalledWith(
      'layer-1',
      'vol-1',
      false
    );
    expect(mockApiService.waitForLayerReady).toHaveBeenCalledWith('layer-1', 500, 20);
    expect(mockLayerStoreState.layerMetadata.get('layer-1')).toMatchObject({
      gpuResident: true,
      evicted: false,
    });
    expect(mockViewStateStoreState.setViewState).not.toHaveBeenCalled();
    expect(mockLayerEvictionService.touchLayer).toHaveBeenCalledWith('layer-1');
    expect(mockLayerEvictionService.checkAndEvict).toHaveBeenCalledTimes(1);
  });

  it('loadLayerData rejects unknown layer ids', async () => {
    const api = new LayerApiImpl();
    mockLayerStoreState.getLayer.mockReturnValue(undefined);

    await expect(api.loadLayerData('missing-layer')).rejects.toThrow(
      'Layer not found: missing-layer'
    );
  });
});

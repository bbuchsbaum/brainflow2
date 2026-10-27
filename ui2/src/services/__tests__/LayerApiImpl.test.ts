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
    workspaceViewStates: new Map<string, any>(),
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
    mockViewStateStoreState.workspaceViewStates = new Map([['test', mockViewStateStoreState.viewState]]);
    mockViewStateStoreState.setViewState.mockImplementation((updater: any) => {
      updater(mockViewStateStoreState.viewState);
    });
  });

  it('releases a completed GPU allocation when its destination closes while uploading', async () => {
    let complete!: (value: unknown) => void;
    mockApiService.requestLayerGpuResources.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const api = new LayerApiImpl();
    const pending = api.addLayer({ name: 'Late volume', volumeId: 'late', visible: true, type: 'anatomical', order: 0 }, { workspaceId: 'test' });
    mockViewStateStoreState.workspaceViewStates.delete('test');
    complete({ data_range: { min: 0, max: 100 }, is_binary_like: false });
    await expect(pending).rejects.toThrow('workspace');
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('late');
    expect(mockLayerStoreState.addLayer).not.toHaveBeenCalled();
  });

  it('releases provisional resources when the backend upload rejects', async () => {
    mockApiService.requestLayerGpuResources.mockRejectedValueOnce(new Error('GPU upload failed'));
    const api = new LayerApiImpl();
    await expect(api.addLayer({ name: 'Failed volume', volumeId: 'failed', visible: true, type: 'anatomical', order: 0 }, { workspaceId: 'test' })).rejects.toThrow('GPU upload failed');
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('failed');
    expect(mockLayerStoreState.addLayer).not.toHaveBeenCalled();
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
  it(' late histogram keeps a user-edited intensity window', async () => {
    let finish!: (value: unknown) => void;
    mockHistogramService.computeHistogram.mockReturnValue(new Promise(r => { finish = r; }));
    const api = new LayerApiImpl();
    const layer = { id: 'layer-1', name: 'T1', volumeId: 'vol-1', visible: true, type: 'anatomical' };
    mockViewStateStoreState.viewState = { layers: [{ id: 'layer-1', intensity: [0,100], threshold: [0,0], colormap: 'gray' }] } as any;
    const pending = (api as any).refineIntensityFromHistogram(layer, { layerType: 'anatomical', dataRange: { min:0, max:100 } });
    (mockViewStateStoreState.viewState.layers[0] as any).intensity = [31,47];
    finish({ bins:[{x0:0,x1:50,count:100},{x0:50,x1:100,count:100}], totalCount:200, mean:50 });
    await pending;
    expect((mockViewStateStoreState.viewState.layers[0] as any).intensity).toEqual([31,47]);
  });


  it('a z map is shown as one from the first paint and never refined (native v6)', async () => {
    // A z map that is mostly ~1e-5 noise: histogram percentiles would give ±0.03.
    mockApiService.requestLayerGpuResources.mockResolvedValueOnce({
      data_range: { min: -5, max: 6 },
      center_world: [0, 0, 0],
      is_binary_like: false,
      dim: [16, 16, 16],
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
      voxel_to_world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      world_to_voxel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      tex_format: 'r32float',
    });
    const api = new LayerApiImpl();
    await api.addLayer({
      id: 'z1',
      name: 'zmap_synthetic.nii',
      volumeId: 'vol-z',
      visible: true,
      type: 'functional',
      statistic: { kind: 'z', intentCode: 5, intentParams: [0, 0, 0], intentName: '', dof: [], label: 'z', fromDescription: false, positiveDataLabel: null },
    } as never);
    await new Promise((r) => setTimeout(r, 0));
    const added = mockLayerStoreState.layers[mockLayerStoreState.layers.length - 1];
    const render = mockLayerStoreState.layerMetadata.get(added.id)?.renderProps;
    expect(render?.intensity).toEqual([-6, 6]);
    expect(render?.threshold).toEqual([-3.1, 3.1]);
    expect(render?.colormap).toBe('fmri');
    expect(mockHistogramService.computeHistogram).not.toHaveBeenCalled();
  });
});

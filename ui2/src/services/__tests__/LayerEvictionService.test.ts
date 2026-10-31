import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_GPU_TEXTURE_SLOTS, layerEvictionService } from '@/services/LayerEvictionService';

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
    getAtlasStats: vi.fn(),
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

const derived = vi.hoisted(() => ({ live: 0 }));
vi.mock('@/services/studio/StudioDerivedMapService', () => ({
  getStudioDerivedMapService: () => ({ liveCount: () => derived.live }),
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
    derived.live = 0;
    // Render loop not up yet: the fallback budget applies.
    mockApiService.getAtlasStats.mockRejectedValue(new Error('not initialised'));
    layerEvictionService.resetGpuTextureSlotsForTests();
  });

  function residentLayers(count: number, hidden: number[] = []) {
    const layers = Array.from({ length: count }, (_, index) => ({
      id: `layer-${index}`,
      name: `Layer ${index}`,
      volumeId: `layer-${index}`,
      visible: !hidden.includes(index),
      type: 'anatomical',
      order: index,
    }));
    mockLayerStoreState.layers = layers as never;
    mockViewStateStoreState.viewState.layers = layers.map((l) => ({ id: l.id, visible: l.visible })) as never;
    for (const layer of layers)
      mockLayerStoreState.layerMetadata.set(layer.id, { gpuResident: true, lastRenderTime: 1 });
  }

  // Feature 10 (qa-features-2026-10-31): the budget is the backend's runtime
  // texture capacity, which depends on the adapter, not a hard-coded 16.
  // Review H3: the render loop refuses an upload once every slot is taken
  // (multi_texture_manager.rs, next_index >= max_textures), so a slot is freed
  // BEFORE the upload: 7 resident layers on 7 slots evict one first.
  it("frees a slot before an upload when the backend's slots are all taken", async () => {
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 7 });
    residentLayers(6, [0]);
    await layerEvictionService.makeRoomForUpload('incoming');
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
    expect(layerEvictionService.knownGpuTextureSlots()).toBe(7);

    residentLayers(7, [0]);
    await layerEvictionService.makeRoomForUpload('incoming');
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledTimes(1);
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('layer-0');
    expect(mockLayerStoreState.layerMetadata.get('layer-0')).toMatchObject({ gpuResident: false });
    // Asked once, then cached.
    expect(mockApiService.getAtlasStats).toHaveBeenCalledTimes(1);
  });

  it('never evicts the layer being uploaded, and stops when only visible layers remain', async () => {
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 3 });
    residentLayers(3, [0, 1]);
    await layerEvictionService.makeRoomForUpload('layer-0');
    // Three resident on three slots: one must go, and layer-0 is the one
    // being uploaded, so layer-1 goes.
    expect(mockApiService.releaseLayerGpuResources.mock.calls).toEqual([['layer-1']]);

    mockApiService.releaseLayerGpuResources.mockClear();
    residentLayers(3);
    await layerEvictionService.makeRoomForUpload('x');
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
  });

  it('after an upload, checkAndEvict only acts when the layers exceed the slots', async () => {
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 7 });
    residentLayers(7, [0]);
    await layerEvictionService.checkAndEvict();
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
  });

  it('falls back to 16 until the capacity is known; an old backend is not asked again', async () => {
    residentLayers(8, [0]);
    await layerEvictionService.makeRoomForUpload();
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
    expect(layerEvictionService.knownGpuTextureSlots()).toBeNull();

    // A backend without the field: remembered as the fallback.
    mockApiService.getAtlasStats.mockResolvedValue({ totalLayers: 4 });
    expect(await layerEvictionService.gpuTextureSlots()).toBe(FALLBACK_GPU_TEXTURE_SLOTS);
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 4 });
    expect(await layerEvictionService.gpuTextureSlots()).toBe(FALLBACK_GPU_TEXTURE_SLOTS);
    expect(mockApiService.getAtlasStats).toHaveBeenCalledTimes(2);
  });

  it('reads the layers after the capacity answer arrives', async () => {
    let answer!: (stats: unknown) => void;
    mockApiService.getAtlasStats.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    residentLayers(2, [0]);
    const making = layerEvictionService.makeRoomForUpload('incoming');
    residentLayers(3, [0]); // a layer arrived meanwhile
    answer({ volumeTextureSlots: 3 });
    await making;
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('layer-0');
  });

  it('counts Set studio maps against the reported capacity', async () => {
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 5 });
    residentLayers(3, [0]);
    derived.live = 1;
    await layerEvictionService.makeRoomForUpload('incoming');
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
    derived.live = 2;
    await layerEvictionService.makeRoomForUpload('incoming');
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('layer-0');
  });

  it('counts Set studio Compare maps against the GPU budget (QA wave 3 review W1)', async () => {
    // Under the budget by layer count alone, over it with three derived maps.
    const layers = Array.from({ length: FALLBACK_GPU_TEXTURE_SLOTS - 1 }, (_, index) => ({
      id: `layer-${index}`,
      name: `Layer ${index}`,
      volumeId: `layer-${index}`,
      visible: index !== 0,
      type: 'anatomical',
      order: index,
    }));
    mockLayerStoreState.layers = layers as never;
    mockViewStateStoreState.viewState.layers = layers.map((l) => ({ id: l.id, visible: l.visible })) as never;
    for (const layer of layers)
      mockLayerStoreState.layerMetadata.set(layer.id, { gpuResident: true, lastRenderTime: 1 });

    await layerEvictionService.checkAndEvict();
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();

    derived.live = 3;
    await layerEvictionService.checkAndEvict();
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('layer-0');
  });

  it('ignores deferred hidden layers and evicts the oldest invisible resident layer when over budget', async () => {
    const visibleLayers = Array.from({ length: FALLBACK_GPU_TEXTURE_SLOTS }, (_, index) => ({
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
      order: FALLBACK_GPU_TEXTURE_SLOTS,
    };

    const hiddenDeferredLayer = {
      id: 'hidden-deferred',
      name: 'Hidden Deferred',
      volumeId: 'hidden-deferred',
      visible: false,
      type: 'anatomical',
      order: FALLBACK_GPU_TEXTURE_SLOTS + 1,
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

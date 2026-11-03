import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_GPU_TEXTURE_SLOTS, layerEvictionService } from '@/services/LayerEvictionService';

const protectedSource = vi.hoisted(() => ({ id: '' }));
vi.mock('@/services/workspaceDocuments', () => ({ volumeDocumentRemovalReason: (id: string) => id === protectedSource.id ? 'Retained source' : null }));

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
    reclaimCachedImageSlots: vi.fn(),
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

const derived = vi.hoisted(() => ({ live: 0, pinned: new Set<string>() }));
vi.mock('@/services/studio/StudioDerivedMapService', () => ({
  getStudioDerivedMapService: () => ({ liveCount: () => derived.live, pinnedLayerIds: () => derived.pinned }),
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => mockEventBus,
}));

describe('LayerEvictionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    protectedSource.id = '';
    mockLayerStoreState.layers = [];
    mockLayerStoreState.layerMetadata = new Map();
    mockLayerStoreState.setLayerMetadata.mockImplementation((id: string, metadata: any) => {
      mockLayerStoreState.layerMetadata.set(id, metadata);
    });
    mockViewStateStoreState.viewState = {
      layers: [],
    };
    (mockViewStateStoreState as Record<string, unknown>).workspaceViewStates = new Map();
    derived.live = 0;
    derived.pinned = new Set();
    mockApiService.reclaimCachedImageSlots.mockResolvedValue({ reclaimed: 0, freeTextureSlots: 0 });
    // Render loop not up yet: the fallback budget applies.
    mockApiService.getAtlasStats.mockRejectedValue(new Error('not initialised'));
    layerEvictionService.resetGpuTextureSlotsForTests();
    layerEvictionService.resetReservationsForTests();
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

  it('preserves a hidden retained contrast under slot pressure and refuses the incoming upload', async () => {
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 2 });
    residentLayers(2, [1]);
    protectedSource.id = 'layer-1';
    await expect(layerEvictionService.makeRoomForUpload('incoming')).resolves.toBe(false);
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
    expect(mockLayerStoreState.layerMetadata.get('layer-1')?.gpuResident).toBe(true);
    protectedSource.id = '';
    await expect(layerEvictionService.makeRoomForUpload('incoming')).resolves.toBe(true);
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('layer-1');
  });

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

  // gpu-residency plan, Phase 1: the residency budget is the texture slots
  // (13), not min(13, draw cap). The old min() made 8 resident layers "full"
  // (QA N2's fix, which merged the per-view draw cap into residency).
  it('budgets the texture slots, not the per-view draw cap', async () => {
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 13, renderLayerCapacity: 8 });
    expect(await layerEvictionService.gpuTextureSlots()).toBe(13);
    expect(layerEvictionService.drawLayerCap()).toBe(8);
    residentLayers(8, [0]);
    await expect(layerEvictionService.makeRoomForUpload('incoming')).resolves.toBe(true);
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
    residentLayers(12, [0]);
    await expect(layerEvictionService.makeRoomForUpload('incoming')).resolves.toBe(true);
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
    residentLayers(13, [0]);
    await expect(layerEvictionService.makeRoomForUpload('incoming')).resolves.toBe(true);
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('layer-0');
  });

  it('reports the draw cap from the backend, 16 until known', async () => {
    expect(layerEvictionService.drawLayerCap()).toBe(16);
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 13, renderLayerCapacity: 16 });
    await layerEvictionService.gpuTextureSlots();
    expect(layerEvictionService.drawLayerCap()).toBe(16);
  });

  // BIDS run switch: 4D resident-ring members hold slots the UI cannot see.
  // The backend's counts make them count, and they are reclaimed before any
  // layer is evicted.
  it('counts cached 4D ring members from the backend and reclaims them before evicting', async () => {
    const stats = { free: 0, resident: 13, cached: 2 };
    mockApiService.getAtlasStats.mockImplementation(async () => ({
      volumeTextureSlots: 13,
      renderLayerCapacity: 16,
      freeTextureSlots: stats.free,
      residentTextureSlots: stats.resident,
      cachedImageSlots: stats.cached,
    }));
    mockApiService.reclaimCachedImageSlots.mockImplementation(async (count: number) => {
      const reclaimed = Math.min(count, stats.cached);
      stats.cached -= reclaimed;
      stats.resident -= reclaimed;
      stats.free += reclaimed;
      return { reclaimed, freeTextureSlots: stats.free };
    });
    // 11 layers by the UI's count, one hidden: 11 + 2 ring members = 13.
    residentLayers(11, [0]);
    expect(layerEvictionService.slotsInUse()).toBe(11);
    await expect(layerEvictionService.makeRoomForUpload('incoming')).resolves.toBe(true);
    expect(mockApiService.reclaimCachedImageSlots).toHaveBeenCalledWith(1);
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
    expect(stats.cached).toBe(1);
  });

  it('counts slots the backend holds that the UI does not know of', async () => {
    mockApiService.getAtlasStats.mockResolvedValue({
      volumeTextureSlots: 13,
      freeTextureSlots: 0,
      residentTextureSlots: 13,
      cachedImageSlots: 0,
    });
    // The UI counts 10, but the GPU is full (e.g. a lazily allocated layer).
    residentLayers(10, [3]);
    await expect(layerEvictionService.makeRoomForUpload('incoming')).resolves.toBe(false);
    // It tried: the hidden layer went (the backend still reports full here).
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('layer-3');
    expect(mockApiService.reclaimCachedImageSlots).not.toHaveBeenCalled();
  });

  // Eviction order (gpu-residency plan, Phase 1): layers hidden in every
  // workspace go first; a layer shown only in a tab behind the front one is
  // evicted next (it is re-uploaded when that tab comes to the front); the
  // front tab's visible layers never go. Before, a background-only layer was
  // never evicted, so a second tab could exhaust the slots for good.
  it('evicts hidden-everywhere layers first, then background-only layers', async () => {
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 3 });
    residentLayers(3, [0, 1]);
    // Front (active) workspace: layer-0 and layer-1 hidden. The Orthogonal
    // tab behind it shows layer-0.
    (mockViewStateStoreState as Record<string, unknown>).workspaceViewStates = new Map([
      [
        'studio',
        { layers: [{ id: 'layer-0', visible: false }, { id: 'layer-1', visible: false }, { id: 'layer-2', visible: true }] },
      ],
      [
        'orthogonal',
        { layers: [{ id: 'layer-0', visible: true }, { id: 'layer-1', visible: false }, { id: 'layer-2', visible: false }] },
      ],
    ]);
    await layerEvictionService.makeRoomForUpload('incoming');
    expect(mockApiService.releaseLayerGpuResources.mock.calls).toEqual([['layer-1']]);

    // With layer-1 also shown in the hidden tab, the least recently rendered
    // background-only layer goes; the front tab's layer-2 stays.
    mockApiService.releaseLayerGpuResources.mockClear();
    residentLayers(3, [0, 1]);
    mockLayerStoreState.layerMetadata.set('layer-0', { gpuResident: true, lastRenderTime: 5 });
    mockLayerStoreState.layerMetadata.set('layer-1', { gpuResident: true, lastRenderTime: 2 });
    (mockViewStateStoreState as Record<string, unknown>).workspaceViewStates = new Map([
      ['orthogonal', { layers: [{ id: 'layer-0', visible: true }, { id: 'layer-1', visible: true }] }],
    ]);
    await expect(layerEvictionService.makeRoomForUpload('incoming')).resolves.toBe(true);
    expect(mockApiService.releaseLayerGpuResources.mock.calls).toEqual([['layer-1']]);

    // The front tab's visible layers are never evicted.
    mockApiService.releaseLayerGpuResources.mockClear();
    residentLayers(3);
    (mockViewStateStoreState as Record<string, unknown>).workspaceViewStates = new Map();
    await expect(layerEvictionService.makeRoomForUpload('incoming')).resolves.toBe(false);
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
  });

  it('never evicts pinned layers: Studio underlays, editable labels, retained sources', async () => {
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 4 });
    residentLayers(4, [0, 1, 2]);
    derived.pinned = new Set(['layer-0']);
    mockLayerStoreState.layers[1] = { ...mockLayerStoreState.layers[1], layerKind: 'segmentation.editable-label' } as never;
    protectedSource.id = 'layer-2';
    await expect(layerEvictionService.makeRoomForUpload('incoming')).resolves.toBe(false);
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
    // Unpinned, the oldest goes.
    derived.pinned = new Set();
    await expect(layerEvictionService.makeRoomForUpload('incoming')).resolves.toBe(true);
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('layer-0');
  });

  it('lists the front tab\'s visible layers that were evicted', () => {
    residentLayers(3, [2]);
    mockLayerStoreState.layerMetadata.set('layer-1', { gpuResident: false, evicted: true });
    mockLayerStoreState.layerMetadata.set('layer-2', { gpuResident: false, evicted: true });
    expect(layerEvictionService.evictedFrontLayers()).toEqual(['layer-1']);
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

  // QA 2026-10-31 N18: re-showing a released layer with every slot taken.
  // It reacquires a slot by evicting a layer hidden everywhere; with every
  // slot holding a visible layer it is told there is no room. (The budget is
  // the 13 texture slots now, no longer min(13, 8).)
  it('says whether a released layer re-shown can have a slot', async () => {
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 8, renderLayerCapacity: 16 });
    // 8 resident layers, layer-2 hidden; `released` is the layer re-shown.
    residentLayers(8, [2]);
    const released = { id: 'released', name: 'toy_t1w', volumeId: 'released', visible: true };
    mockLayerStoreState.layers = [...mockLayerStoreState.layers, released] as never;
    mockLayerStoreState.layerMetadata.set('released', { gpuResident: false, evicted: true });

    await expect(layerEvictionService.makeRoomForUpload('released')).resolves.toBe(true);
    expect(mockApiService.releaseLayerGpuResources).toHaveBeenCalledWith('layer-2');

    // All 8 resident layers visible now: nothing may go.
    residentLayers(8);
    mockLayerStoreState.layers = [...mockLayerStoreState.layers, released] as never;
    mockLayerStoreState.layerMetadata.set('released', { gpuResident: false, evicted: true });
    mockApiService.releaseLayerGpuResources.mockClear();
    await expect(layerEvictionService.makeRoomForUpload('released')).resolves.toBe(false);
    expect(mockApiService.releaseLayerGpuResources).not.toHaveBeenCalled();
    expect(layerEvictionService.slotsInUse('released')).toBe(8);
  });

  // N18 review: Show all promotes several released layers at once. Each
  // reserves its slot, so with one slot free only one is let through.
  it('lets one of two uploads made together take the last free slot', async () => {
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 8 });
    residentLayers(7);
    const a = { id: 'a', name: 'a', volumeId: 'a', visible: true };
    const b = { id: 'b', name: 'b', volumeId: 'b', visible: true };
    mockLayerStoreState.layers = [...mockLayerStoreState.layers, a, b] as never;
    mockLayerStoreState.layerMetadata.set('a', { gpuResident: false });
    mockLayerStoreState.layerMetadata.set('b', { gpuResident: false });

    const results = await Promise.all([
      layerEvictionService.makeRoomForUpload('a', { reserve: true }),
      layerEvictionService.makeRoomForUpload('b', { reserve: true }),
    ]);
    expect(results).toEqual([true, false]);
    expect(layerEvictionService.slotsInUse()).toBe(8);
    layerEvictionService.releaseReservation('a');
    expect(layerEvictionService.slotsInUse()).toBe(7);
  });

  // A Set studio map is counted from its acquire: it may meet the budget.
  it('lets an upload already counted fill the budget exactly', async () => {
    mockApiService.getAtlasStats.mockResolvedValue({ volumeTextureSlots: 8 });
    residentLayers(7);
    derived.live = 1;
    await expect(layerEvictionService.makeRoomForUpload(undefined, { counted: true })).resolves.toBe(true);
    derived.live = 2;
    await expect(layerEvictionService.makeRoomForUpload(undefined, { counted: true })).resolves.toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerApiImpl } from '@/services/LayerApiImpl';
import { GpuSlotsFullError } from '@/utils/formatTauriError';
import { layerFrameBoxes } from '@/services/layerFrameBoxes';
import { fitViewsToWorldBox, worldBoxFromViews } from '@/utils/worldFrame';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';
import { useSeriesStore } from '@/stores/seriesStore';

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
    selectLayer: vi.fn(),
    reorderLayers: vi.fn(),
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
    makeRoomForUpload: vi.fn().mockResolvedValue(undefined),
    releaseReservation: vi.fn(),
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

/** Private LayerApiImpl paths the native-round tests drive directly. */
interface Internals {
  upsertViewLayer(layer: unknown, context?: unknown): void;
  removeViewLayer(id: string): void;
  refineIntensityFromHistogram(layer: unknown, options: unknown): Promise<void>;
}

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
    // Metadata only: no texture slot, nothing to make room for.
    expect(mockLayerEvictionService.makeRoomForUpload).not.toHaveBeenCalled();
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
    // Review H3: a slot is freed BEFORE the upload (the backend refuses it
    // once all are taken), not only checked after.
    expect(mockLayerEvictionService.makeRoomForUpload).toHaveBeenCalledWith('vol-visible');
    expect(mockLayerEvictionService.makeRoomForUpload.mock.invocationCallOrder[0]).toBeLessThan(
      mockApiService.requestLayerGpuResources.mock.invocationCallOrder[0],
    );
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
    expect(mockLayerEvictionService.makeRoomForUpload).toHaveBeenCalledWith('layer-1', { reserve: true });
    expect(mockLayerEvictionService.releaseReservation).toHaveBeenCalledWith('layer-1');
    expect(mockLayerEvictionService.makeRoomForUpload.mock.invocationCallOrder[0]).toBeLessThan(
      mockApiService.requestLayerGpuResources.mock.invocationCallOrder[0],
    );
  });

  // QA 2026-10-31 N18: with every slot holding a shown layer, a released
  // layer's show is refused before the backend is asked (the texture slots
  // outnumber the render cap, so the upload could succeed and every frame
  // then fail).
  it('refuses to re-show a released layer when no GPU slot can be freed', async () => {
    const api = new LayerApiImpl();
    mockLayerStoreState.getLayer.mockReturnValue({ id: 'layer-1', name: 'toy_t1w', volumeId: 'vol-1', visible: false, type: 'anatomical' });
    mockLayerStoreState.layerMetadata.set('layer-1', { gpuResident: false, evicted: true });
    mockLayerEvictionService.makeRoomForUpload.mockResolvedValueOnce(false);
    (mockLayerEvictionService as Record<string, unknown>).gpuTextureSlots = vi.fn().mockResolvedValue(8);

    const show = api.updateLayer('layer-1', { visible: true });
    await expect(show).rejects.toBeInstanceOf(GpuSlotsFullError);
    await expect(show).rejects.toThrow('GPU texture slots full (all 8 in use)');
    expect(mockApiService.requestLayerGpuResources).not.toHaveBeenCalled();
    expect(mockApiService.patchLayer).not.toHaveBeenCalled();
    expect(mockLayerStoreState.layerMetadata.get('layer-1')?.gpuResident).toBe(false);
  });

  it('a show still promoting to the GPU does not undo a later hide', async () => {
    const api = new LayerApiImpl();
    mockLayerStoreState.getLayer.mockReturnValue({ id: 'layer-1', name: 'Run', volumeId: 'vol-1', visible: false, type: 'anatomical' });
    mockLayerStoreState.layerMetadata.set('layer-1', { gpuResident: false });
    let release: () => void = () => undefined;
    mockApiService.requestLayerGpuResources.mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({}); }),
    );
    const viewLayer = { id: 'layer-1', visible: false, opacity: 0 };
    mockViewStateStoreState.setViewState.mockImplementation((update: (s: { layers: unknown[] }) => void) => update({ layers: [viewLayer] }));
    const show = api.updateLayer('layer-1', { visible: true });
    await api.updateLayer('layer-1', { visible: false });
    release();
    await show;
    expect(viewLayer.visible).toBe(false);
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


  it('a run hidden while it was loading is added hidden, whatever the captured layer says (native R2-2)', () => {
    const api = new LayerApiImpl() as unknown as Internals;
    const stale = { id: 'run-2', name: 'run 2', volumeId: 'vol-2', visible: true, type: 'functional' };
    mockLayerStoreState.getLayer.mockReturnValue({ ...stale, visible: false });
    const state: { layers: Record<string, unknown>[]; views: object; crosshair: object } = { layers: [], views: {}, crosshair: {} };
    mockViewStateStoreState.viewState = state as unknown as typeof mockViewStateStoreState.viewState;
    mockViewStateStoreState.setViewState.mockImplementation((update: (s: unknown) => void) => update(state));
    api.upsertViewLayer(stale);
    // Hidden is `visible: false` alone; the opacity is kept for the next show.
    expect(state.layers[0]).toMatchObject({ id: 'run-2', visible: false, opacity: 1 });
  });

  it('a late histogram still refines a layer whose visibility changed meanwhile (native R2-1)', async () => {
    let finish!: (value: unknown) => void;
    mockHistogramService.computeHistogram.mockReturnValue(new Promise(r => { finish = r; }));
    const api = new LayerApiImpl() as unknown as Internals;
    const layer = { id: 'layer-1', name: 'T1', volumeId: 'vol-1', visible: true, type: 'anatomical' };
    mockLayerStoreState.getLayer.mockReturnValue(layer);
    const view: Record<string, unknown> = { id: 'layer-1', visible: true, opacity: 1, intensity: [0, 100], threshold: [0, 0], colormap: 'gray' };
    const state = { layers: [view] };
    mockViewStateStoreState.viewState = state as unknown as typeof mockViewStateStoreState.viewState;
    mockViewStateStoreState.setViewState.mockImplementation((update: (s: unknown) => void) => update(state));
    const pending = api.refineIntensityFromHistogram(layer, { layerType: 'anatomical', dataRange: { min: 0, max: 100 } });
    // The Series view hides the run while its histogram is computed.
    Object.assign(view, { visible: false, opacity: 0 });
    finish({ bins: [{ x0: 0, x1: 50, count: 100 }, { x0: 50, x1: 100, count: 100 }], totalCount: 200, mean: 50, minValue: 0, maxValue: 100 });
    await pending;
    expect(view.intensity).not.toEqual([0, 100]);
  });

  it('a late histogram leaves the display of a reopened (undone) removal alone, interpolation too', async () => {
    const { preserveLayerDisplay } = await import('../restoredDisplay');
    let finish!: (value: unknown) => void;
    mockHistogramService.computeHistogram.mockReturnValue(new Promise(r => { finish = r; }));
    const api = new LayerApiImpl() as unknown as Internals;
    const layer = { id: 'layer-r', name: 'T1', volumeId: 'vol-r', visible: true, type: 'anatomical' };
    mockLayerStoreState.getLayer.mockReturnValue(layer);
    // Restored settings equal to the first paint: the render key alone would not notice.
    const view: Record<string, unknown> = { id: 'layer-r', visible: true, opacity: 1, intensity: [0, 100], threshold: [0, 0], colormap: 'gray', interpolation: 'nearest' };
    const state = { layers: [view] };
    mockViewStateStoreState.viewState = state as unknown as typeof mockViewStateStoreState.viewState;
    mockViewStateStoreState.setViewState.mockImplementation((update: (s: unknown) => void) => update(state));
    const pending = api.refineIntensityFromHistogram(layer, { layerType: 'anatomical', dataRange: { min: 0, max: 100 } });
    preserveLayerDisplay('layer-r');
    finish({ bins: [{ x0: 0, x1: 50, count: 100 }, { x0: 50, x1: 100, count: 100 }], totalCount: 200, mean: 50, minValue: 0, maxValue: 100 });
    await pending;
    expect(view).toMatchObject({ intensity: [0, 100], interpolation: 'nearest' });
  });

  it('a late histogram keeps an interpolation the user changed meanwhile', async () => {
    let finish!: (value: unknown) => void;
    mockHistogramService.computeHistogram.mockReturnValue(new Promise(r => { finish = r; }));
    const api = new LayerApiImpl() as unknown as Internals;
    const layer = { id: 'layer-i', name: 'T1', volumeId: 'vol-i', visible: true, type: 'anatomical' };
    mockLayerStoreState.getLayer.mockReturnValue(layer);
    const view: Record<string, unknown> = { id: 'layer-i', visible: true, opacity: 1, intensity: [0, 100], threshold: [0, 0], colormap: 'gray', interpolation: 'linear' };
    const state = { layers: [view] };
    mockViewStateStoreState.viewState = state as unknown as typeof mockViewStateStoreState.viewState;
    mockViewStateStoreState.setViewState.mockImplementation((update: (s: unknown) => void) => update(state));
    const pending = api.refineIntensityFromHistogram(layer, { layerType: 'anatomical', dataRange: { min: 0, max: 100 } });
    view.interpolation = 'nearest';
    finish({ bins: [{ x0: 0, x1: 50, count: 100 }, { x0: 50, x1: 100, count: 100 }], totalCount: 200, mean: 50, minValue: 0, maxValue: 100 });
    await pending;
    expect(view).toMatchObject({ intensity: [0, 100], interpolation: 'nearest' });
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

  it('a binary file is drawn as labels whatever its name (QA 2026-10-30 F17)', async () => {
    mockApiService.requestLayerGpuResources.mockResolvedValueOnce({
      data_range: { min: 0, max: 1 },
      center_world: [0, 0, 0],
      is_binary_like: true,
      dim: [8, 8, 8],
      voxel_to_world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    });
    const api = new LayerApiImpl();
    const added = await api.addLayer(
      { name: 'lesion.nii', volumeId: 'vol-lesion', visible: true, type: 'anatomical', order: 0 },
      { workspaceId: 'test' },
    );
    expect(added.type).toBe('label');
    const render = mockLayerStoreState.layerMetadata.get(added.id)?.renderProps;
    expect(render).toMatchObject({ layerMode: 'label', interpolation: 'nearest', intensity: [0, 1] });
  });

  it('a binary file named like a mask is a label map too (QA 2026-10-31 N11: p4_brain_mask.nii)', async () => {
    mockApiService.requestLayerGpuResources.mockResolvedValueOnce({
      data_range: { min: 0, max: 1 },
      center_world: [0, 0, 0],
      is_binary_like: true,
      dim: [8, 8, 8],
      voxel_to_world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    });
    const api = new LayerApiImpl();
    const added = await api.addLayer(
      { name: 'p4_brain_mask', volumeId: 'vol-mask', visible: true, type: 'mask', order: 0 },
      { workspaceId: 'test' },
    );
    expect(added.type).toBe('label');
    expect(mockLayerStoreState.layerMetadata.get(added.id)?.renderProps?.layerMode).toBe('label');
  });

  it('a small-integer count map keeps its type (review: lesion_overlap_n20)', async () => {
    mockLayerStoreState.layerMetadata.set('vol-overlap', { nativeDtype: 'u8', source: 'file' });
    mockApiService.requestLayerGpuResources.mockResolvedValueOnce({
      data_range: { min: 0, max: 20 },
      center_world: [0, 0, 0],
      is_binary_like: false,
      dim: [8, 8, 8],
      voxel_to_world: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    });
    const api = new LayerApiImpl();
    const added = await api.addLayer(
      { name: 'lesion_overlap_n20', volumeId: 'vol-overlap', visible: true, type: 'anatomical', order: 0 },
      { workspaceId: 'test' },
    );
    expect(added.type).toBe('anatomical');
    expect(mockLayerStoreState.layerMetadata.get(added.id)?.renderProps?.layerMode).toBe('scalar');
  });

  it('a continuous anatomical image keeps its type', async () => {
    const api = new LayerApiImpl();
    const added = await api.addLayer(
      { name: 'T1.nii', volumeId: 'vol-t1', visible: true, type: 'anatomical', order: 0 },
      { workspaceId: 'test' },
    );
    expect(added.type).toBe('anatomical');
  });

  describe('frame boxes for the union field of view (QA 2026-10-29 §3.2)', () => {
    beforeEach(() => layerFrameBoxes.clear());

    it("records a new layer's exact voxel-edge box from its affine, not its initial views", async () => {
      // test-data/browser/oblique.nii.gz: world = (10 - 2j, -7 + 3i, 5 + 4k).
      mockApiService.requestLayerGpuResources.mockResolvedValueOnce({
        data_range: { min: 0, max: 864 },
        center_world: [4, -1, 21],
        is_binary_like: false,
        dim: [5, 7, 9],
        spacing: [3, 2, 4],
        origin: [10, -7, 5],
        voxel_to_world: [0, 3, 0, 0, -2, 0, 0, 0, 0, 0, 4, 0, 10, -7, 5, 1],
        world_to_voxel: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        tex_format: 'r32float',
      });
      // Initial views a pixel wider than the volume (load-time ceil slack).
      const sloppy = fitViewsToWorldBox(
        {
          axial: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [8, 8] },
          sagittal: { origin_mm: [0, 0, 0], u_mm: [0, -1, 0], v_mm: [0, 0, -1], dim_px: [8, 8] },
          coronal: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 0, -1], dim_px: [8, 8] },
        },
        { min: [-4, -9, 2], max: [12, 7, 40] },
        [4, -1, 21],
        [8, 8],
      );
      const api = new LayerApiImpl();
      await api.addLayer(
        { name: 'oblique', volumeId: 'oblique', visible: true, type: 'anatomical', order: 0 },
        { workspaceId: 'test', initialGeometry: { views: sloppy, crosshair: { world_mm: [4, -1, 21], visible: true } } },
      );
      expect(layerFrameBoxes.get('oblique')).toEqual({ min: [-3, -8.5, 3], max: [11, 6.5, 39] });
    });

    it('falls back to the initial views without an affine and drops the box on removal', () => {
      const api = new LayerApiImpl() as unknown as Internals;
      const views = fitViewsToWorldBox(
        {
          axial: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, -1, 0], dim_px: [100, 100] },
          sagittal: { origin_mm: [0, 0, 0], u_mm: [0, -1, 0], v_mm: [0, 0, -1], dim_px: [100, 100] },
          coronal: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 0, -1], dim_px: [100, 100] },
        },
        { min: [0, 0, 0], max: [10, 10, 10] },
        [5, 5, 5],
        [100, 100],
      );
      api.upsertViewLayer(
        { id: 'v', name: 'v', volumeId: 'v', visible: true, type: 'anatomical' },
        { workspaceId: 'test', initialGeometry: { views, crosshair: { world_mm: [5, 5, 5], visible: true } } },
      );
      expect(worldBoxFromViews(views)).toEqual(layerFrameBoxes.get('v'));
      api.removeViewLayer('v');
      expect(layerFrameBoxes.get('v')).toBeUndefined();
    });
  });
});

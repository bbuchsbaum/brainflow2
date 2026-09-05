import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewState } from '@/types/viewState';

const m = vi.hoisted(() => ({
  api: {
    listDirectory: vi.fn(),
    loadFile: vi.fn(),
    getVolumeBounds: vi.fn(),
    getInitialViews: vi.fn(),
    requestLayerGpuResources: vi.fn(),
    waitForLayerReady: vi.fn(),
    releaseLayerGpuResources: vi.fn(),
    unloadVolume: vi.fn(),
  },
  event: { emit: vi.fn(), on: vi.fn(() => () => {}) },
  histogram: { computeHistogram: vi.fn() },
}));
vi.mock('../apiService', () => ({ getApiService: () => m.api }));
vi.mock('@/events/EventBus', () => ({ getEventBus: () => m.event }));
vi.mock('../HistogramService', () => ({ histogramService: m.histogram }));
vi.mock('../LayerEvictionService', () => ({
  layerEvictionService: {
    touchLayer: vi.fn(),
    checkAndEvict: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/stores/fileBrowserStore', () => ({
  useFileBrowserStore: { getState: () => ({ markFourD: vi.fn() }) },
}));
vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ workspaces: new Map() }) },
}));
vi.mock('@/stores/viewStateStore', async () => {
  const { create } = await import('zustand');
  const store = create<any>((set, get) => ({
    activeWorkspaceKey: 'A',
    workspaceViewStates: new Map(),
    viewState: {},
    setViewState: (updater: (state: ViewState) => void, workspaceId = get().activeWorkspaceKey) => {
      const state = structuredClone(get().workspaceViewStates.get(workspaceId));
      updater(state);
      const workspaces = new Map(get().workspaceViewStates);
      workspaces.set(workspaceId, state);
      set({
        workspaceViewStates: workspaces,
        ...(workspaceId === get().activeWorkspaceKey ? { viewState: state } : {}),
      });
    },
  }));
  return { useViewStateStore: store };
});

import { useLayerStore } from '@/stores/layerStore';
import { useImageSetStore } from '@/stores/imageSetStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import { initializeLayerService } from '../LayerService';
import { LayerApiImpl } from '../LayerApiImpl';
import { getImageSetService, folderImageMembers } from '../ImageSetService';

const plane = { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [100, 100] };
const geometry = { axial: plane, sagittal: plane, coronal: plane };
const initialView = () =>
  ({
    views: structuredClone(geometry),
    crosshair: { world_mm: [7, 8, 9], visible: true },
    layers: [],
  }) as unknown as ViewState;
const node = (name: string, isDir = false) => ({
  id: `/remote/stats/${name}`,
  name,
  isDir,
  parentIdx: null,
  iconId: 0,
});
const handle = (id: string) => ({ id, name: id, dims: [3, 4, 5], dtype: 'f32' });
const gpu = () => ({
  data_range: { min: -10, max: 20 },
  dim: [3, 4, 5],
  spacing: [2, 2, 2],
  center_world: [10, 20, 30],
  voxel_to_world: [],
  world_to_voxel: [],
});
const service = getImageSetService();
initializeLayerService(new LayerApiImpl());

beforeEach(() => {
  vi.clearAllMocks();
  useLayerStore.getState().clearLayers();
  useImageSetStore.setState({ sets: {}, preview: null });
  useInspectorSelectionStore.getState().clear();
  useComparisonStore.setState({ panels: new Map() });
  const view = initialView();
  useViewStateStore.setState({
    activeWorkspaceKey: 'A',
    viewState: view,
    workspaceViewStates: new Map([
      ['A', view],
      ['B', initialView()],
    ]),
  });
  m.api.listDirectory.mockResolvedValue([
    node('map1.nii.gz'),
    node('map2.nii.gz'),
    node('map3.nii.gz'),
  ]);
  let counter = 0;
  m.api.loadFile.mockImplementation(async () => handle(`volume-${++counter}`));
  m.api.getVolumeBounds.mockResolvedValue({
    min: [0, 0, 0],
    max: [30, 40, 50],
    center: [15, 20, 25],
  });
  m.api.getInitialViews.mockResolvedValue(geometry);
  m.api.requestLayerGpuResources.mockResolvedValue(gpu());
  m.api.waitForLayerReady.mockResolvedValue(true);
  m.api.releaseLayerGpuResources.mockResolvedValue(undefined);
  m.api.unloadVolume.mockResolvedValue(undefined);
  m.histogram.computeHistogram.mockRejectedValue(new Error('No fixture histogram'));
});

async function openSet() {
  await service.openFolder('/remote/stats');
  await service.confirmPreview(
    ['/remote/stats/map1.nii.gz', '/remote/stats/map2.nii.gz', '/remote/stats/map3.nii.gz'],
    'Statistics',
  );
  return Object.values(useImageSetStore.getState().sets)[0];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('folder image-set lifecycle', () => {
  it('discovers only direct NIfTI children without downloading and orders them naturally', async () => {
    const files = [
      node('map10.nii.gz'),
      node('map2.nii.gz'),
      node('table.tsv'),
      node('sub', true),
      node('sub/hidden.nii.gz'),
      node('map2.nii.gz'),
    ];
    expect(folderImageMembers('/remote/stats', files).map((item) => item.name)).toEqual([
      'map2.nii.gz',
      'map10.nii.gz',
    ]);
    await service.openFolder('/remote/stats');
    expect(m.api.listDirectory).toHaveBeenCalledWith('/remote/stats', 1);
    expect(m.api.loadFile).not.toHaveBeenCalled();
    await service.confirmPreview(['/remote/stats/map2.nii.gz', '/not-in-preview.nii'], 'Subset');
    expect(m.api.loadFile).toHaveBeenCalledExactlyOnceWith('/remote/stats/map2.nii.gz');
    expect(useLayerStore.getState().layers).toHaveLength(1);
    expect(Object.values(useImageSetStore.getState().sets)[0].members).toHaveLength(1);
  });

  it('replaces one layer after upload, preserves geometry and order, and restores per-member contrast', async () => {
    const entry = await openSet();
    const firstId = entry.layerId!;
    useViewStateStore.getState().setViewState((state) => {
      state.crosshair.world_mm = [8, 9, 10];
      state.views.axial.origin_mm = [4, 5, 6];
      state.layers[0].intensity = [-3, 7];
      state.layers[0].colormap = 'viridis';
      state.layers[0].opacity = 0.6;
    });
    const before = structuredClone(useViewStateStore.getState().viewState);
    useComparisonStore.getState().addPanel('A', [firstId]);
    const pending = deferred<ReturnType<typeof gpu>>();
    m.api.requestLayerGpuResources.mockReturnValueOnce(pending.promise);
    const switchPromise = service.selectMember(entry.id, 1);
    await vi.waitFor(() => expect(m.api.loadFile).toHaveBeenCalledTimes(2));
    expect(useLayerStore.getState().layers.map((layer) => layer.id)).toEqual([firstId]);
    pending.resolve(gpu());
    await switchPromise;
    const second = useImageSetStore.getState().sets[entry.id];
    expect(useLayerStore.getState().layers.map((layer) => layer.id)).toEqual([second.layerId]);
    expect(useViewStateStore.getState().viewState.layers).toHaveLength(1);
    expect(useViewStateStore.getState().viewState.views).toEqual(before.views);
    expect(useViewStateStore.getState().viewState.crosshair).toEqual(before.crosshair);
    expect(useViewStateStore.getState().viewState.layers[0].opacity).toBe(0.6);
    expect(useComparisonStore.getState().panels.get('A')![0].visibleLayerIds).toEqual(
      new Set([second.layerId]),
    );
    expect(m.api.releaseLayerGpuResources).toHaveBeenCalledWith(firstId);
    expect(m.api.unloadVolume).toHaveBeenCalledWith(firstId);
    await service.selectMember(entry.id, 0);
    const restored = useViewStateStore.getState().viewState.layers[0];
    expect(restored.intensity).toEqual([-3, 7]);
    expect(restored.colormap).toBe('viridis');
    expect(useInspectorSelectionStore.getState().activeItemId).toBe(restored.id);
  });

  it('preserves other layers and every workspace view when members have different geometry', async () => {
    const entry = await openSet();
    const original = useLayerStore.getState().layers[0];
    useLayerStore.getState().addLayer({ id: 'anatomy', volumeId: 'anatomy', name: 'T1', type: 'anatomical', visible: true, order: 0 });
    useLayerStore.getState().reorderLayers([useLayerStore.getState().layers[1], original]);
    useViewStateStore.getState().setViewState((state) => {
      state.layers.unshift({ ...state.layers[0], id: 'anatomy', volumeId: 'anatomy', name: 'T1' });
      state.crosshair.world_mm = [-40, 8, 21];
    });
    const a = structuredClone(useViewStateStore.getState().viewState);
    const b = structuredClone(a);
    b.crosshair.world_mm = [9, 8, 7];
    useViewStateStore.setState({ workspaceViewStates: new Map([['A', a], ['B', b]]) });
    m.api.requestLayerGpuResources.mockResolvedValueOnce({ ...gpu(), dim: [20, 30, 40], center_world: [100, 200, 300], spacing: [3, 3, 3] });
    await service.selectMember(entry.id, 1);
    expect(useLayerStore.getState().layers.map((layer) => layer.name)).toEqual(['T1', 'Statistics']);
    for (const [workspaceId, before] of [['A', a], ['B', b]] as const) {
      const after = useViewStateStore.getState().workspaceViewStates.get(workspaceId)!;
      expect(after.layers).toHaveLength(2);
      expect(after.layers[0]).toEqual(before.layers[0]);
      expect(after.layers[1].id).not.toBe(original.id);
      expect(after.crosshair).toEqual(before.crosshair);
      expect(after.views).toEqual(before.views);
    }
    expect(m.api.unloadVolume).not.toHaveBeenCalledWith('anatomy');
  });

  it('captures a contrast edit made while the next image is still loading', async () => {
    const entry = await openSet();
    const pending = deferred<ReturnType<typeof gpu>>();
    m.api.requestLayerGpuResources.mockReturnValueOnce(pending.promise);
    const switching = service.selectMember(entry.id, 1);
    await vi.waitFor(() => expect(m.api.loadFile).toHaveBeenCalledTimes(2));
    useViewStateStore.getState().setViewState((state) => { state.layers[0].threshold = [2, 8]; });
    pending.resolve(gpu());
    await switching;
    await service.selectMember(entry.id, 0);
    expect(useViewStateStore.getState().viewState.layers[0].threshold).toEqual([2, 8]);
  });

  it('keeps the current member and reports the real error if the new GPU allocation fails', async () => {
    const entry = await openSet();
    const before = structuredClone(useViewStateStore.getState().viewState);
    m.api.requestLayerGpuResources.mockRejectedValueOnce({ Internal: { details: 'GPU is full' } });
    await service.selectMember(entry.id, 1);
    expect(useViewStateStore.getState().viewState).toEqual(before);
    expect(useLayerStore.getState().layers.map((layer) => layer.id)).toEqual([entry.layerId]);
    expect(useImageSetStore.getState().sets[entry.id].error).toBe('GPU is full');
    expect(m.api.unloadVolume).toHaveBeenCalledWith('volume-2');
    expect(m.api.unloadVolume).not.toHaveBeenCalledWith(entry.layerId);
  });

  it('discards a stale download and publishes only the latest rapid selection', async () => {
    const entry = await openSet();
    const pending = deferred<ReturnType<typeof handle>>();
    m.api.loadFile.mockReturnValueOnce(pending.promise);
    const first = service.selectMember(entry.id, 1);
    await vi.waitFor(() => expect(m.api.loadFile).toHaveBeenCalledTimes(2));
    const last = service.selectMember(entry.id, 2);
    pending.resolve(handle('stale'));
    await Promise.all([first, last]);
    expect(m.api.unloadVolume).toHaveBeenCalledWith('stale');
    expect(m.api.requestLayerGpuResources).not.toHaveBeenCalledWith(
      'stale',
      expect.anything(),
      expect.anything(),
    );
    expect(useImageSetStore.getState().sets[entry.id].activeIndex).toBe(2);
    expect(useLayerStore.getState().layers).toHaveLength(1);
  });

  it('does not resurrect a removed set after a delayed download', async () => {
    const entry = await openSet();
    const pending = deferred<ReturnType<typeof handle>>();
    m.api.loadFile.mockReturnValueOnce(pending.promise);
    const switchPromise = service.selectMember(entry.id, 1);
    await vi.waitFor(() => expect(m.api.loadFile).toHaveBeenCalledTimes(2));
    useLayerStore.getState().removeLayer(entry.layerId!);
    pending.resolve(handle('orphan'));
    await switchPromise;
    expect(useLayerStore.getState().layers).toHaveLength(0);
    expect(useImageSetStore.getState().sets[entry.id]).toBeUndefined();
    expect(m.api.unloadVolume).toHaveBeenCalledWith('orphan');
  });

  it('rolls back if the original workspace closes while the upload is pending', async () => {
    const entry = await openSet();
    const pending = deferred<ReturnType<typeof gpu>>();
    m.api.requestLayerGpuResources.mockReturnValueOnce(pending.promise);
    const switching = service.selectMember(entry.id, 1);
    await vi.waitFor(() => expect(m.api.loadFile).toHaveBeenCalledTimes(2));
    useViewStateStore.setState({ workspaceViewStates: new Map([['B', initialView()]]) });
    pending.resolve(gpu());
    await switching;
    expect(useLayerStore.getState().layers[0].id).toBe(entry.layerId);
    expect(useImageSetStore.getState().sets[entry.id].error).toMatch(/closed/);
    expect(m.api.releaseLayerGpuResources).toHaveBeenCalledWith('volume-2');
  });

  it('invalidates a cancelled initial open and ignores stale directory previews', async () => {
    const oldListing = deferred<ReturnType<typeof node>[]>();
    m.api.listDirectory.mockReturnValueOnce(oldListing.promise);
    const old = service.openFolder('/old');
    await service.openFolder('/remote/stats');
    oldListing.resolve([node('old.nii.gz')]);
    await old;
    expect(useImageSetStore.getState().preview?.folder).toBe('/remote/stats');
    const pending = deferred<ReturnType<typeof handle>>();
    m.api.loadFile.mockReturnValueOnce(pending.promise);
    const opening = service.confirmPreview(['/remote/stats/map1.nii.gz'], 'Cancelled');
    await vi.waitFor(() => expect(m.api.loadFile).toHaveBeenCalledTimes(1));
    service.closePreview();
    pending.resolve(handle('cancelled'));
    await opening;
    expect(useLayerStore.getState().layers).toHaveLength(0);
    expect(useImageSetStore.getState().preview).toBeNull();
    expect(m.api.unloadVolume).toHaveBeenCalledWith('cancelled');
  });
});

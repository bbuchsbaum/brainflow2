import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getVolumeLoadingService } from '../VolumeLoadingService';
import { VolumeHandleStore } from '../VolumeHandleStore';

const { api, layerService, layerState, viewState } = vi.hoisted(() => ({
  api: { getVolumeBounds: vi.fn(), getInitialViews: vi.fn(), unloadVolume: vi.fn() },
  layerService: { addLayer: vi.fn() },
  layerState: {
    layers: [],
    metadata: new Map(),
    setLayerMetadata: vi.fn(), clearLayerMetadata: vi.fn(), setLayerLoading: vi.fn(),
  },
  viewState: { viewState: { views: {} }, workspaceViewStates: new Map() },
}));

vi.mock('../apiService', () => ({ getApiService: () => api }));
vi.mock('../LayerService', () => ({ getLayerService: () => layerService }));
vi.mock('../LabelTableService', () => ({ getLabelTableService: vi.fn() }));
vi.mock('@/events/EventBus', () => ({ getEventBus: () => ({ emit: vi.fn(), on: () => () => {} }) }));
vi.mock('@/stores/layerStore', () => ({ useLayerStore: { getState: () => layerState } }));
vi.mock('@/stores/viewStateStore', () => ({ useViewStateStore: { getState: () => viewState } }));
vi.mock('@/stores/fileBrowserStore', () => ({ useFileBrowserStore: { getState: () => ({ markFourD: vi.fn() }) } }));

function views() {
  return Object.fromEntries(['axial', 'sagittal', 'coronal'].map((name) => [name, {
    origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [32, 32],
  }]));
}

const bounds = { min: [0, 0, 0], max: [2, 3, 4], center: [1, 1.5, 2] };
const config = {
  volumeHandle: { id: 'provisional', name: 'brain.nii', dims: [2, 3, 4] as [number, number, number], dtype: 'f32' },
  workspaceId: 'destination', displayName: 'Brain', source: 'file' as const,
  sourcePath: 'brain.nii', layerType: 'anatomical' as const,
};

describe('VolumeLoadingService provisional ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    VolumeHandleStore.clearAll();
    layerState.metadata.clear();
    layerState.setLayerMetadata.mockImplementation((id, metadata) => layerState.metadata.set(id, metadata));
    layerState.clearLayerMetadata.mockImplementation((id) => layerState.metadata.delete(id));
    viewState.viewState.views = views();
    viewState.workspaceViewStates = new Map([['destination', {}]]);
    api.getVolumeBounds.mockResolvedValue(bounds);
    api.getInitialViews.mockImplementation(async () => views());
    api.unloadVolume.mockResolvedValue(undefined);
  });

  function expectReclaimed() {
    expect(api.unloadVolume).toHaveBeenCalledWith('provisional');
    expect(VolumeHandleStore.getVolumeHandle('provisional')).toBeUndefined();
    expect(layerState.metadata.has('provisional')).toBe(false);
  }

  it('unloads a registered volume when its workspace closes during display preparation', async () => {
    let finish!: (value: typeof bounds) => void;
    api.getVolumeBounds.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const load = getVolumeLoadingService().loadVolume(config);
    viewState.workspaceViewStates.delete('destination');
    finish(bounds);
    await expect(load).rejects.toThrow('workspace');
    expect(layerService.addLayer).not.toHaveBeenCalled();
    expectReclaimed();
  });

  it('unloads a registered volume after the GPU layer phase fails', async () => {
    layerService.addLayer.mockRejectedValueOnce(new Error('GPU upload failed'));
    await expect(getVolumeLoadingService().loadVolume(config)).rejects.toThrow('GPU upload failed');
    expect(layerService.addLayer).toHaveBeenCalledOnce();
    expectReclaimed();
  });

  it('unloads a registered volume after a metadata read aborts', async () => {
    api.getVolumeBounds.mockRejectedValueOnce(new Error('source aborted'));
    await expect(getVolumeLoadingService().loadVolume(config)).rejects.toThrow('source aborted');
    expectReclaimed();
  });
});

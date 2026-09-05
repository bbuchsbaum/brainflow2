import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => {
  const planes = {
    axial: { origin_mm: [0, 0, 0], u_mm: [1, 0, 0], v_mm: [0, 1, 0], dim_px: [512, 512] },
  };
  const views = { axial: planes.axial, sagittal: planes.axial, coronal: planes.axial };
  return {
    api: { getVolumeBounds: vi.fn(), getInitialViews: vi.fn(), unloadVolume: vi.fn() },
    event: { emit: vi.fn(), on: vi.fn(() => () => {}) },
    layer: {
      layers: [],
      layerMetadata: new Map(),
      setLayerMetadata: vi.fn(),
      clearLayerMetadata: vi.fn(),
      setLayerLoading: vi.fn(),
    },
    workspaces: new Set(['A', 'B']),
    service: { addLayer: vi.fn() },
    active: 'A',
    writes: [] as string[],
    views,
    planes,
  };
});
vi.mock('@/events/EventBus', () => ({ getEventBus: () => m.event }));
vi.mock('../apiService', () => ({ getApiService: () => m.api }));
vi.mock('../LayerService', () => ({ getLayerService: () => m.service }));
vi.mock('@/stores/layerStore', () => ({ useLayerStore: { getState: () => m.layer } }));
vi.mock('@/stores/fileBrowserStore', () => ({
  useFileBrowserStore: { getState: () => ({ markFourD: vi.fn() }) },
}));
vi.mock('@/stores/viewStateStore', () => ({
  useViewStateStore: {
    getState: () => ({
      activeWorkspaceKey: m.active,
      workspaceViewStates: new Map(Array.from(m.workspaces, (key) => [key, {}])),
      viewState: { views: m.views },
      setCrosshair: vi.fn().mockResolvedValue(undefined),
      updateView: () => m.writes.push(m.active),
    }),
  },
}));
import { getVolumeLoadingService } from '../VolumeLoadingService';
const config = {
  volumeHandle: {
    id: 'audit-volume',
    name: 'test',
    dims: [65, 65, 49],
    dtype: 'f32',
    volume_type: 'Volume3D',
  },
  displayName: 'test',
  source: 'file',
  sourcePath: '/test.nii.gz',
} as any;
beforeEach(() => {
  vi.clearAllMocks();
  m.workspaces = new Set(['A', 'B']);
  m.active = 'A';
  m.writes.length = 0;
  m.api.getVolumeBounds.mockResolvedValue({
    min: [-64, -64, -72],
    max: [64, 64, 72],
    center: [0, 0, 0],
    dims: [65, 65, 49],
  });
  m.api.getInitialViews.mockResolvedValue(m.views);
  m.service.addLayer.mockImplementation(async (_layer, context) => {
    m.writes.push(context.workspaceId);
    return { id: 'audit-volume' };
  });
});
describe('Volume loading lifecycle', () => {
  it('does not invent millimeter bounds after a backend geometry error', async () => {
    m.api.getVolumeBounds.mockRejectedValue(new Error('geometry unavailable'));
    await expect(getVolumeLoadingService().loadVolume(config)).rejects.toThrow();
  });
  it('keeps delayed view initialization in the workspace that started it', async () => {
    let resolve!: (value: unknown) => void;
    m.api.getInitialViews.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const pending = getVolumeLoadingService().loadVolume(config);
    await Promise.resolve();
    await Promise.resolve();
    m.active = 'B';
    resolve(m.views);
    await pending;
    expect(m.writes).toEqual(['A']);
  });
  it('releases the backend volume when layer publication fails', async () => {
    m.service.addLayer.mockRejectedValue(new Error('GPU allocation failed'));
    await expect(getVolumeLoadingService().loadVolume(config)).rejects.toThrow(
      'GPU allocation failed',
    );
    expect(m.api.unloadVolume).toHaveBeenCalledWith('audit-volume');
  });
  it('releases a load whose destination closed before geometry arrived', async () => {
    let finish!: (value: unknown) => void;
    m.api.getInitialViews.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = getVolumeLoadingService().loadVolume(config);
    m.workspaces.delete('A');
    finish(m.views);
    await expect(pending).rejects.toThrow('closed');
    expect(m.service.addLayer).not.toHaveBeenCalled();
    expect(m.api.unloadVolume).toHaveBeenCalledWith('audit-volume');
    expect(m.event.emit).not.toHaveBeenCalledWith('volume.loaded', expect.anything());
  });
});

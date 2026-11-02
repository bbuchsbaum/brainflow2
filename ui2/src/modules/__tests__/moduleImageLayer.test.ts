import { beforeEach, describe, expect, it, vi } from 'vitest';

type Layer = {
  volumeId: string;
  intensity: [number, number];
  threshold: [number, number];
  colormap: string;
  colormapId?: number;
  interpolation?: string;
};
const stores = vi.hoisted(() => ({
  view: { layers: [] as Layer[] },
  layerIds: new Set<string>(),
  addLayer: vi.fn(),
  load: vi.fn(),
}));
vi.mock('@/stores/viewStateStore', () => ({
  useViewStateStore: {
    getState: () => ({
      workspaceViewStates: new Map([['view-a', stores.view]]),
      setViewState: (update: (view: typeof stores.view) => void) => update(stores.view),
    }),
  },
}));
vi.mock('@/stores/layerStore', () => ({
  useLayerStore: {
    getState: () => ({ getLayer: (id: string) => (stores.layerIds.has(id) ? { id } : undefined) }),
  },
}));
vi.mock('@/stores/renderStateStore', () => ({ useRenderStateStore: { getState: () => ({}) } }));
vi.mock('@/services/apiService', () => ({ getApiService: () => ({}) }));
vi.mock('@/services/LayerService', () => ({
  getLayerService: () => ({ addLayer: stores.addLayer }),
}));
vi.mock('@/services/LayerApiImpl', () => ({
  LayerApiImpl: class {
    loadLayerData = stores.load;
  },
}));
import { ensureModuleImageLayer } from '@/modules/api/rendering';

const source: Layer = {
  volumeId: 'series',
  intensity: [100, 900],
  threshold: [150, 800],
  colormap: 'hot',
  colormapId: 3,
  interpolation: 'nearest',
};
const fresh = (): Layer => ({
  volumeId: 'frame',
  intensity: [0, 1],
  threshold: [0, 1],
  colormap: 'gray',
  interpolation: 'linear',
});
beforeEach(() => {
  stores.layerIds.clear();
  stores.addLayer.mockReset();
  stores.load.mockReset().mockResolvedValue(undefined);
  stores.addLayer.mockImplementation(async (layer: { volumeId: string }) => {
    stores.layerIds.add(layer.volumeId);
    stores.view.layers.push(fresh());
  });
});

describe('module image layers styled from their source', () => {
  it('adds a hidden layer that takes the source window, threshold, colormap and interpolation', async () => {
    stores.view = { layers: [{ ...source }] };
    await ensureModuleImageLayer({
      workspaceId: 'view-a',
      volumeId: 'frame',
      title: 'Frame',
      displayLike: 'series',
      isCurrent: () => true,
    });
    expect(stores.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ volumeId: 'frame', visible: false }),
      expect.anything(),
    );
    expect(stores.view.layers[1]).toMatchObject({
      intensity: [100, 900],
      threshold: [150, 800],
      colormap: 'hot',
      colormapId: 3,
      interpolation: 'nearest',
    });
  });

  it('still styles a layer that an earlier, interrupted call added, then only once', async () => {
    stores.view = { layers: [{ ...source }] };
    let current = true;
    // The first call adds the layer but loses currency before styling.
    stores.addLayer.mockImplementationOnce(async (layer: { volumeId: string }) => {
      stores.layerIds.add(layer.volumeId);
      stores.view.layers.push({ ...fresh(), volumeId: 'frame-2' });
      current = false;
    });
    await ensureModuleImageLayer({
      workspaceId: 'view-a',
      volumeId: 'frame-2',
      title: 'Frame',
      displayLike: 'series',
      isCurrent: () => current,
    });
    expect(stores.view.layers[1]).toMatchObject({ colormap: 'gray' });
    current = true;
    await ensureModuleImageLayer({
      workspaceId: 'view-a',
      volumeId: 'frame-2',
      title: 'Frame',
      displayLike: 'series',
      isCurrent: () => current,
    });
    expect(stores.addLayer).toHaveBeenCalledTimes(1);
    expect(stores.view.layers[1]).toMatchObject({ intensity: [100, 900], colormap: 'hot' });
    // A later user change to the frame layer is not overwritten again.
    stores.view.layers[1].colormap = 'viridis';
    await ensureModuleImageLayer({
      workspaceId: 'view-a',
      volumeId: 'frame-2',
      title: 'Frame',
      displayLike: 'series',
      isCurrent: () => true,
    });
    expect(stores.view.layers[1].colormap).toBe('viridis');
  });
});

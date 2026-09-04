import { beforeEach, describe, expect, it, vi } from 'vitest';
import { surfaceOverlayService } from '@/services/SurfaceOverlayService';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import {
  useSurfaceStore,
  type LoadedSurface,
} from '@/stores/surfaceStore';

const { mockInvoke, mockEmit, mockQueueState } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockEmit: vi.fn(),
  mockQueueState: {
    isLoading: vi.fn(() => false),
    enqueue: vi.fn(() => 'queue-1'),
    startLoading: vi.fn(),
    updateProgress: vi.fn(),
    markComplete: vi.fn(),
    markError: vi.fn(),
  },
}));

vi.mock('@/services/transport', () => ({
  getTransport: () => ({
    invoke: mockInvoke,
  }),
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({
    emit: mockEmit,
    on: vi.fn(() => () => {}),
  }),
}));

vi.mock('@/stores/loadingQueueStore', () => ({
  useLoadingQueueStore: {
    getState: () => mockQueueState,
  },
}));

function makeSurface(handle: string): LoadedSurface {
  return {
    handle,
    name: `Surface ${handle}`,
    visible: true,
    geometry: {
      vertices: new Float32Array(0),
      faces: new Uint32Array(0),
      hemisphere: 'left',
      surfaceType: 'pial',
    },
    layers: new Map(),
    metadata: {
      vertexCount: 2,
      faceCount: 1,
      hemisphere: 'left',
      surfaceType: 'pial',
      path: `templateflow://${handle}`,
    },
  };
}

describe('SurfaceOverlayService', () => {
  beforeEach(() => {
    useActivePanelStore.setState({
      componentType: null,
      componentState: null,
    });
    useActiveRenderContextStore.setState({
      activeId: null,
    });
    mockInvoke.mockReset();
    mockEmit.mockReset();
    mockQueueState.isLoading.mockReturnValue(false);
    mockQueueState.enqueue.mockReturnValue('queue-1');
    mockQueueState.startLoading.mockReset();
    mockQueueState.updateProgress.mockReset();
    mockQueueState.markComplete.mockReset();
    mockQueueState.markError.mockReset();
    useSurfaceStore.setState({
      surfaces: new Map(),
      activeSurfaceId: null,
      selectedItemType: null,
      selectedLayerId: null,
      isLoading: false,
      loadError: null,
      surfaceViewSettings: new Map(),
      surfaceViewHandles: new Map(),
      surfaceViewSelections: new Map(),
    });
  });

  it('opens the canonical file dialog for a chosen surface and marks that surface active', async () => {
    const surface = makeSurface('surface-1');
    useSurfaceStore.setState({
      surfaces: new Map([[surface.handle, surface]]),
    });
    mockInvoke.mockResolvedValue(undefined);

    await surfaceOverlayService.requestOverlayFileSelection(surface.handle);

    expect(useSurfaceStore.getState().activeSurfaceId).toBe(surface.handle);
    expect(useSurfaceStore.getState().selectedItemType).toBe('geometry');
    expect(mockInvoke).toHaveBeenCalledWith('open_file_dialog');
  });

  it('does not write a mismatched overlay request into the focused surface view selection', async () => {
    const leftSurface = makeSurface('surface-1');
    const rightSurface = makeSurface('surface-2');
    useSurfaceStore.setState({
      surfaces: new Map([
        [leftSurface.handle, leftSurface],
        [rightSurface.handle, rightSurface],
      ]),
      activeSurfaceId: rightSurface.handle,
      selectedItemType: 'geometry',
      selectedLayerId: null,
      surfaceViewHandles: new Map([
        ['view-1', leftSurface.handle],
        ['view-2', rightSurface.handle],
      ]),
      surfaceViewSelections: new Map([
        ['view-1', {
          activeSurfaceId: leftSurface.handle,
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
        ['view-2', {
          activeSurfaceId: rightSurface.handle,
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });
    useActivePanelStore.setState({
      componentType: 'SurfaceView',
      componentState: {
        surfaceViewId: 'view-2',
        surfaceHandle: rightSurface.handle,
      },
    });
    mockInvoke.mockResolvedValue(undefined);

    await surfaceOverlayService.requestOverlayFileSelection(leftSurface.handle);

    const state = useSurfaceStore.getState();
    expect(state.activeSurfaceId).toBe(leftSurface.handle);
    expect(state.selectedItemType).toBe('geometry');
    expect(state.surfaceViewSelections.get('view-2')).toEqual({
      activeSurfaceId: rightSurface.handle,
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
  });

  it('loads an overlay into the store, selects it, and emits the live overlay event', async () => {
    const surface = makeSurface('surface-1');
    useSurfaceStore.setState({
      surfaces: new Map([[surface.handle, surface]]),
    });

    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'load_surface_overlay') {
        return {
          handle: 'overlay-handle-1',
          data_count: 2,
          intent: 'functional',
        };
      }

      if (command === 'get_surface_overlay_data') {
        return [0.25, 0.75];
      }

      throw new Error(`Unexpected command ${command}`);
    });

    const layer = await surfaceOverlayService.loadSurfaceOverlay('/tmp/example.func.gii', surface.handle);

    const updatedSurface = useSurfaceStore.getState().surfaces.get(surface.handle);
    expect(updatedSurface?.layers.get(layer.id)).toMatchObject({
      id: layer.id,
      dataHandle: 'overlay-handle-1',
      colormap: 'viridis',
      range: [0.25, 0.75],
    });
    expect(useSurfaceStore.getState().activeSurfaceId).toBe(surface.handle);
    expect(useSurfaceStore.getState().selectedItemType).toBe('dataLayer');
    expect(useSurfaceStore.getState().selectedLayerId).toBe(layer.id);
    expect(mockEmit).toHaveBeenCalledWith('surface.overlayApplied', {
      surfaceId: surface.handle,
      layerId: layer.id,
      dataHandle: 'overlay-handle-1',
      colormap: 'viridis',
      range: [0.25, 0.75],
      opacity: 1,
    });
  });

  it.each([
    ['/tmp/rh.example.func.gii', '/tmp/lh.pial.gii', 'hemisphere'],
    ['/tmp/hemi-L_space-fsLR.func.gii', 'templateflow://fsaverage_pial_left', 'space'],
    ['/tmp/sub-02_hemi-L.func.gii', '/tmp/sub-01_hemi-L_pial.surf.gii', 'subject'],
  ])('rejects incompatible overlay %s before backend loading', async (overlay, target, field) => {
    const surface = makeSurface('surface-1');
    surface.geometry.hemisphere = 'left';
    surface.metadata.path = target;
    useSurfaceStore.setState({ surfaces: new Map([[surface.handle, surface]]) });
    await expect(surfaceOverlayService.loadSurfaceOverlay(overlay, surface.handle)).rejects.toThrow(field);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('routes overlay removal through the lifecycle queue and removes the layer from state', async () => {
    const surface = makeSurface('surface-1');
    surface.layers.set('layer-1', {
      id: 'layer-1',
      name: 'My Overlay',
      dataHandle: 'overlay-handle-1',
      values: new Float32Array([0.25, 0.75]),
      visible: true,
      colormap: 'viridis',
      range: [0.25, 0.75],
      dataRange: [0.25, 0.75],
      opacity: 1,
    });
    useSurfaceStore.setState({
      surfaces: new Map([[surface.handle, surface]]),
      activeSurfaceId: surface.handle,
      selectedItemType: 'dataLayer',
      selectedLayerId: 'layer-1',
    });

    mockInvoke.mockResolvedValue({ success: true, message: 'ok' });

    await surfaceOverlayService.removeSurfaceDataLayer(surface.handle, 'layer-1');

    expect(mockQueueState.enqueue).toHaveBeenCalledWith({
      type: 'surface-overlay-remove',
      path: 'surface-overlay-remove:surface-1:layer-1',
      displayName: 'My Overlay',
      retry: {
        kind: 'surface-overlay-remove',
        surfaceId: 'surface-1',
        layerId: 'layer-1',
      },
    });
    expect(mockQueueState.startLoading).toHaveBeenCalledWith('queue-1');
    expect(mockQueueState.markComplete).toHaveBeenCalledWith('queue-1');
    expect(useSurfaceStore.getState().surfaces.get(surface.handle)?.layers.has('layer-1')).toBe(false);
    expect(useSurfaceStore.getState().selectedItemType).toBe('geometry');
    expect(useSurfaceStore.getState().selectedLayerId).toBeNull();
    expect(mockEmit).toHaveBeenCalledWith('surface.dataLayerRemoved', {
      surfaceId: 'surface-1',
      layerId: 'layer-1',
    });
  });

  it('selects the new overlay in the focused surface view instead of a stale compatibility global', async () => {
    const leftSurface = makeSurface('surface-1');
    const rightSurface = makeSurface('surface-2');
    useSurfaceStore.setState({
      surfaces: new Map([
        [leftSurface.handle, leftSurface],
        [rightSurface.handle, rightSurface],
      ]),
      activeSurfaceId: leftSurface.handle,
      selectedItemType: 'geometry',
      selectedLayerId: null,
      surfaceViewHandles: new Map([
        ['view-1', leftSurface.handle],
        ['view-2', rightSurface.handle],
      ]),
      surfaceViewSelections: new Map([
        ['view-1', {
          activeSurfaceId: leftSurface.handle,
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
        ['view-2', {
          activeSurfaceId: rightSurface.handle,
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });
    useActivePanelStore.setState({
      componentType: 'SurfaceView',
      componentState: {
        surfaceViewId: 'view-2',
        surfaceHandle: rightSurface.handle,
      },
    });

    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'load_surface_overlay') {
        return {
          handle: 'overlay-handle-2',
          data_count: 2,
          intent: 'functional',
        };
      }

      if (command === 'get_surface_overlay_data') {
        return [0.1, 0.9];
      }

      throw new Error(`Unexpected command ${command}`);
    });

    const layer = await surfaceOverlayService.loadSurfaceOverlay('/tmp/other.func.gii', rightSurface.handle);

    const state = useSurfaceStore.getState();
    expect(state.surfaceViewSelections.get('view-1')).toEqual({
      activeSurfaceId: leftSurface.handle,
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
    expect(state.surfaceViewSelections.get('view-2')).toEqual({
      activeSurfaceId: rightSurface.handle,
      selectedItemType: 'dataLayer',
      selectedLayerId: layer.id,
    });
  });

  it('keeps an unrelated focused surface view stable when loading an overlay onto another surface', async () => {
    const leftSurface = makeSurface('surface-1');
    const rightSurface = makeSurface('surface-2');
    useSurfaceStore.setState({
      surfaces: new Map([
        [leftSurface.handle, leftSurface],
        [rightSurface.handle, rightSurface],
      ]),
      activeSurfaceId: rightSurface.handle,
      selectedItemType: 'geometry',
      selectedLayerId: null,
      surfaceViewHandles: new Map([
        ['view-1', leftSurface.handle],
        ['view-2', rightSurface.handle],
      ]),
      surfaceViewSelections: new Map([
        ['view-1', {
          activeSurfaceId: leftSurface.handle,
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
        ['view-2', {
          activeSurfaceId: rightSurface.handle,
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });
    useActivePanelStore.setState({
      componentType: 'SurfaceView',
      componentState: {
        surfaceViewId: 'view-2',
        surfaceHandle: rightSurface.handle,
      },
    });

    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'load_surface_overlay') {
        return {
          handle: 'overlay-handle-3',
          data_count: 2,
          intent: 'functional',
        };
      }

      if (command === 'get_surface_overlay_data') {
        return [0.2, 0.8];
      }

      throw new Error(`Unexpected command ${command}`);
    });

    const layer = await surfaceOverlayService.loadSurfaceOverlay('/tmp/left.func.gii', leftSurface.handle);

    const state = useSurfaceStore.getState();
    expect(state.activeSurfaceId).toBe(leftSurface.handle);
    expect(state.selectedItemType).toBe('dataLayer');
    expect(state.selectedLayerId).toBe(layer.id);
    expect(state.surfaceViewSelections.get('view-1')).toEqual({
      activeSurfaceId: leftSurface.handle,
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
    expect(state.surfaceViewSelections.get('view-2')).toEqual({
      activeSurfaceId: rightSurface.handle,
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
  });
});

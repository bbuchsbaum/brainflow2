import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import {
  createDefaultSurfaceViewSettings,
  useSurfaceStore,
  type LoadedSurface,
} from '@/stores/surfaceStore';
import { getVolumeSurfaceProjectionService } from '../VolumeSurfaceProjectionService';

const mockEmit = vi.fn();

vi.mock('@/services/transport', () => ({
  getTransport: () => ({
    invoke: vi.fn(),
  }),
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({
    emit: mockEmit,
    on: vi.fn(() => () => {}),
  }),
}));

function makeSurface(handle: string): LoadedSurface {
  return {
    handle,
    name: handle,
    visible: true,
    geometry: {
      vertices: new Float32Array(0),
      faces: new Uint32Array(0),
      hemisphere: 'left',
      surfaceType: 'pial',
    },
    layers: new Map(),
    metadata: {
      vertexCount: 0,
      faceCount: 0,
      hemisphere: 'left',
      surfaceType: 'pial',
      path: `templateflow://${handle}`,
    },
  };
}

describe('VolumeSurfaceProjectionService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockEmit.mockReset();
    useActivePanelStore.setState({
      componentType: null,
      componentState: null,
    });
    useActiveRenderContextStore.setState({
      activeId: null,
    });
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

  it('uses shared nearest labels and leaves vertices outside the volume transparent', async () => {
    const surface = makeSurface('labels');
    surface.geometry.vertices = new Float32Array([-.5,0,0, 1.5,0,0, .5,0,0]);
    useSurfaceStore.setState({ surfaces: new Map([[surface.handle, surface]]) });
    const service = getVolumeSurfaceProjectionService();
    vi.spyOn(service, 'getVolumeForGPUProjection').mockResolvedValue({
      volumeData: new Float32Array([1,2]).buffer, dims: [2,1,1],
      affineMatrix: new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]), dataRange: [1,2],
    });
    const result = await service.projectAndDisplay('volume', surface.handle, 'Labels', {
      useGPUProjection: true,
      atlasPalette: {
        lut: {max_label:2,lut_rgb:[0,0,0,255,0,0,0,255,0],background:[0,0,0],kind:'maximin_view',seed:0},
        legend: [],
      },
    });
    const layer = useSurfaceStore.getState().surfaces.get(surface.handle)!.layers.get(result.id)!;
    expect([...layer.labels!]).toEqual([1,0,2]);
    expect([...layer.rgba!]).toEqual([1,0,0,1,0,0,0,0,0,1,0,1]);
  });

  it('selects GPU projection layers in the initiating surface view', async () => {
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
      surfaceViewSettings: new Map([
        ['view-1', createDefaultSurfaceViewSettings()],
        ['view-2', createDefaultSurfaceViewSettings()],
      ]),
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

    const service = getVolumeSurfaceProjectionService();
    vi.spyOn(service, 'getVolumeForGPUProjection').mockResolvedValue({
      volumeData: new Float32Array([0, 1, 2, 3]).buffer,
      dims: [2, 2, 1],
      affineMatrix: new Float32Array(16),
      dataRange: [0, 3],
    });

    const layer = await service.projectAndDisplay('volume-1', rightSurface.handle, 'Projection', {
      useGPUProjection: true,
      surfaceViewId: 'view-2',
    });

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
    expect(state.surfaces.get(rightSurface.handle)?.layers.get(layer.id)).toBeDefined();
  });

  it('falls back to compatibility selection when the requested target surface differs from the focused view', async () => {
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
      surfaceViewSettings: new Map([
        ['view-1', createDefaultSurfaceViewSettings()],
        ['view-2', createDefaultSurfaceViewSettings()],
      ]),
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

    const service = getVolumeSurfaceProjectionService();
    vi.spyOn(service, 'getVolumeForGPUProjection').mockResolvedValue({
      volumeData: new Float32Array([0, 1, 2, 3]).buffer,
      dims: [2, 2, 1],
      affineMatrix: new Float32Array(16),
      dataRange: [0, 3],
    });

    const layer = await service.projectAndDisplay('volume-1', leftSurface.handle, 'Left Projection', {
      useGPUProjection: true,
      surfaceViewId: 'view-2',
    });

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

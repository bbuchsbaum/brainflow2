import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSurfaceAtlasPreset } from '../atlasMenuSurfaceLoader';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import {
  createDefaultSurfaceViewSettings,
  useSurfaceStore,
  type LoadedSurface,
} from '@/stores/surfaceStore';

const { mockEmit, mockEnsureSurfaceView, mockFocusSurfacePanel } = vi.hoisted(() => ({
  mockEmit: vi.fn(),
  mockEnsureSurfaceView: vi.fn(),
  mockFocusSurfacePanel: vi.fn(),
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({
    emit: mockEmit,
  }),
}));

vi.mock('@/services/layoutService', () => ({
  getLayoutService: () => ({
    ensureSurfaceView: mockEnsureSurfaceView,
    focusSurfacePanel: mockFocusSurfacePanel,
  }),
}));

vi.mock('@/services/AtlasService', () => ({
  AtlasService: {
    loadSurfaceAtlas: vi.fn(),
    importParcelDataJson: vi.fn(),
  },
}));

function makeSurface(
  handle: string,
  path: string,
  hemisphere: 'left' | 'right'
): LoadedSurface {
  return {
    handle,
    name: handle,
    visible: true,
    geometry: {
      vertices: new Float32Array(0),
      faces: new Uint32Array(0),
      hemisphere,
      surfaceType: 'pial',
    },
    layers: new Map(),
    metadata: {
      vertexCount: 2,
      faceCount: 1,
      hemisphere,
      surfaceType: 'pial',
      path,
    },
  };
}

describe('atlasMenuSurfaceLoader', () => {
  beforeEach(async () => {
    const { AtlasService } = await import('@/services/AtlasService');

    vi.mocked(AtlasService.loadSurfaceAtlas).mockReset();
    vi.mocked(AtlasService.importParcelDataJson).mockReset();
    mockEmit.mockReset();
    mockEnsureSurfaceView.mockReset();
    mockFocusSurfacePanel.mockReset();

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

  it('falls back to compatibility selection when a surface atlas resolves to a different surface than the focused view', async () => {
    const { AtlasService } = await import('@/services/AtlasService');
    const leftSurface = makeSurface(
      'surface-lh',
      'templateflow://fsaverage_pial_left',
      'left'
    );
    const rightSurface = makeSurface(
      'surface-rh',
      'templateflow://fsaverage_pial_right',
      'right'
    );

    useSurfaceStore.setState({
      surfaces: new Map([
        [leftSurface.handle, leftSurface],
        [rightSurface.handle, rightSurface],
      ]),
      activeSurfaceId: rightSurface.handle,
      selectedItemType: 'geometry',
      selectedLayerId: null,
      surfaceViewSettings: new Map([
        ['view-lh', createDefaultSurfaceViewSettings()],
        ['view-rh', createDefaultSurfaceViewSettings()],
      ]),
      surfaceViewHandles: new Map([
        ['view-lh', leftSurface.handle],
        ['view-rh', rightSurface.handle],
      ]),
      surfaceViewSelections: new Map([
        ['view-lh', {
          activeSurfaceId: leftSurface.handle,
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
        ['view-rh', {
          activeSurfaceId: rightSurface.handle,
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });
    useActivePanelStore.setState({
      componentType: 'SurfaceView',
      componentState: {
        surfaceViewId: 'view-rh',
        surfaceHandle: rightSurface.handle,
      },
    });

    vi.mocked(AtlasService.loadSurfaceAtlas).mockResolvedValue({
      atlas_metadata: {} as any,
      labels_lh: [1, 2],
      labels_rh: [],
      label_info: [
        { id: 1, name: 'Parcel 1', hemisphere: 'Left' },
        { id: 2, name: 'Parcel 2', hemisphere: 'Left' },
      ],
      space: 'fsaverage',
      n_vertices_lh: 2,
      n_vertices_rh: 0,
    });
    vi.mocked(AtlasService.importParcelDataJson).mockResolvedValue({
      reference_id: 'parcel-ref-1',
      parcel_row_count: 2,
    } as any);

    const eventBus = { emit: vi.fn() } as any;
    await handleSurfaceAtlasPreset({ atlas_id: 'schaefer', parcels: 2 }, eventBus);

    const state = useSurfaceStore.getState();
    const leftLayers = Array.from(state.surfaces.get(leftSurface.handle)?.layers.values() ?? []);
    expect(leftLayers).toHaveLength(1);
    expect(state.activeSurfaceId).toBe(leftSurface.handle);
    expect(state.selectedItemType).toBe('dataLayer');
    expect(state.selectedLayerId).toBe(leftLayers[0]?.id);
    expect(state.surfaceViewSelections.get('view-rh')).toEqual({
      activeSurfaceId: rightSurface.handle,
      selectedItemType: 'geometry',
      selectedLayerId: null,
    });
    expect(mockEnsureSurfaceView).toHaveBeenCalledWith(
      leftSurface.handle,
      leftSurface.metadata.path
    );
    expect(mockFocusSurfacePanel).toHaveBeenCalled();
  });
});

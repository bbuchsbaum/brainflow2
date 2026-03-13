import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleVolumeAtlasPreset } from '../useAtlasMenuListener';
import { AtlasCategory } from '@/types/atlas';
import { useActivePanelStore } from '@/stores/activePanelStore';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { useLayerStore } from '@/stores/layerStore';
import {
  createDefaultSurfaceViewSettings,
  useSurfaceStore,
  type LoadedSurface,
} from '@/stores/surfaceStore';

const {
  mockConfirmAtlasSurfaceProjection,
  mockProjectAndDisplay,
  mockLoadAtlas,
  mockLoadAtlasAndCreateLayer,
  mockGetAtlasPalette,
  mockGetAtlasEntry,
  mockValidateConfig,
} = vi.hoisted(() => ({
  mockConfirmAtlasSurfaceProjection: vi.fn(),
  mockProjectAndDisplay: vi.fn(),
  mockLoadAtlas: vi.fn(),
  mockLoadAtlasAndCreateLayer: vi.fn(),
  mockGetAtlasPalette: vi.fn(),
  mockGetAtlasEntry: vi.fn(),
  mockValidateConfig: vi.fn(),
}));

vi.mock('@/services/ConfirmationService', () => ({
  getConfirmationService: () => ({
    confirmAtlasSurfaceProjection: mockConfirmAtlasSurfaceProjection,
  }),
}));

vi.mock('@/services/VolumeSurfaceProjectionService', () => ({
  getVolumeSurfaceProjectionService: () => ({
    projectAndDisplay: mockProjectAndDisplay,
  }),
}));

vi.mock('@/services/AtlasService', () => ({
  AtlasService: {
    getAtlasEntry: mockGetAtlasEntry,
    validateConfig: mockValidateConfig,
    loadAtlas: mockLoadAtlas,
    loadAtlasAndCreateLayer: mockLoadAtlasAndCreateLayer,
    getAtlasPalette: mockGetAtlasPalette,
  },
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

describe('handleVolumeAtlasPreset', () => {
  beforeEach(() => {
    mockConfirmAtlasSurfaceProjection.mockReset();
    mockProjectAndDisplay.mockReset();
    mockLoadAtlas.mockReset();
    mockLoadAtlasAndCreateLayer.mockReset();
    mockGetAtlasPalette.mockReset();
    mockGetAtlasEntry.mockReset();
    mockValidateConfig.mockReset();

    mockGetAtlasEntry.mockResolvedValue({
      id: 'atlas-1',
      name: 'Atlas 1',
      category: AtlasCategory.Cortical,
      allowed_spaces: [{ id: 'MNI152NLin2009cAsym' }],
      resolutions: [{ value: '2mm' }],
      network_options: [],
      parcel_options: [],
    });
    mockValidateConfig.mockResolvedValue(true);
    mockGetAtlasPalette.mockResolvedValue(null);

    useActivePanelStore.setState({
      componentType: null,
      componentState: null,
    });
    useActiveRenderContextStore.setState({
      activeId: null,
    });
    useLayerStore.setState({
      layers: [],
      selectedLayerId: null,
      loadingLayers: new Set(),
      errorLayers: new Map(),
      layerMetadata: new Map(),
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

  it('projects a cortical atlas onto the active surface when confirmation accepts', async () => {
    const surface = makeSurface('surface-2');
    useSurfaceStore.setState({
      surfaces: new Map([[surface.handle, surface]]),
      activeSurfaceId: surface.handle,
      selectedItemType: 'geometry',
      surfaceViewSettings: new Map([['view-2', createDefaultSurfaceViewSettings()]]),
      surfaceViewHandles: new Map([['view-2', surface.handle]]),
      surfaceViewSelections: new Map([
        ['view-2', {
          activeSurfaceId: surface.handle,
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });
    useActivePanelStore.setState({
      componentType: 'SurfaceView',
      componentState: {
        surfaceViewId: 'view-2',
        surfaceHandle: surface.handle,
      },
    });

    mockConfirmAtlasSurfaceProjection.mockResolvedValue(true);
    mockLoadAtlas.mockResolvedValue({
      success: true,
      volume_handle: 'volume-1',
      error_message: null,
    });

    const eventBus = { emit: vi.fn() } as any;
    await handleVolumeAtlasPreset({ atlas_id: 'atlas-1' }, eventBus);

    expect(mockConfirmAtlasSurfaceProjection).toHaveBeenCalledWith('Atlas 1');
    expect(mockLoadAtlas).toHaveBeenCalledTimes(1);
    expect(mockProjectAndDisplay).toHaveBeenCalledWith(
      'volume-1',
      surface.handle,
      'Atlas 1',
      expect.objectContaining({
        surfaceViewId: 'view-2',
        useGPUProjection: true,
        colormap: 'turbo',
      })
    );
    expect(mockLoadAtlasAndCreateLayer).not.toHaveBeenCalled();
  });

  it('loads a cortical atlas as a volume overlay when confirmation declines', async () => {
    const surface = makeSurface('surface-2');
    useSurfaceStore.setState({
      surfaces: new Map([[surface.handle, surface]]),
      activeSurfaceId: surface.handle,
      selectedItemType: 'geometry',
      surfaceViewSettings: new Map([['view-2', createDefaultSurfaceViewSettings()]]),
      surfaceViewHandles: new Map([['view-2', surface.handle]]),
      surfaceViewSelections: new Map([
        ['view-2', {
          activeSurfaceId: surface.handle,
          selectedItemType: 'geometry',
          selectedLayerId: null,
        }],
      ]),
    });
    useActivePanelStore.setState({
      componentType: 'SurfaceView',
      componentState: {
        surfaceViewId: 'view-2',
        surfaceHandle: surface.handle,
      },
    });

    mockConfirmAtlasSurfaceProjection.mockResolvedValue(false);
    mockLoadAtlasAndCreateLayer.mockResolvedValue({
      result: {
        success: true,
        volume_handle_info: { id: 'volume-1' },
        atlas_metadata: { name: 'Atlas 1' },
      },
      layer: { id: 'layer-1' },
    });

    const eventBus = { emit: vi.fn() } as any;
    await handleVolumeAtlasPreset({ atlas_id: 'atlas-1' }, eventBus);

    expect(mockConfirmAtlasSurfaceProjection).toHaveBeenCalledWith('Atlas 1');
    expect(mockLoadAtlasAndCreateLayer).toHaveBeenCalledTimes(1);
    expect(mockProjectAndDisplay).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEventBus = {
  emit: vi.fn(),
  on: vi.fn(),
};

const mockQueueState = {
  isLoading: vi.fn(() => false),
  enqueue: vi.fn(() => 'queue-1'),
  startLoading: vi.fn(),
  updateProgress: vi.fn(),
  markComplete: vi.fn(),
  markError: vi.fn(),
};

const mockApiService = {
  loadFile: vi.fn(),
};

const mockVolumeLoadingService = {
  loadVolume: vi.fn(),
};

const mockSurfaceLoadingService = {
  isSupportedSurfaceFile: vi.fn(() => false),
  loadSurfaceFile: vi.fn(),
};

const mockSurfaceOverlayService = {
  detectGiftiType: vi.fn(() => 'unknown'),
  loadSurfaceOverlay: vi.fn(),
};

const mockWorkspaceStoreState = {
  workspaces: new Map<string, { id: string; type: string }>(),
  activeWorkspaceId: 'workspace-active' as string | null,
  createWorkspace: vi.fn(async (type: string) => `${type}-workspace-1`),
  activateWorkspace: vi.fn(),
};

const mockComparisonStoreState = {
  initFromCurrentAndNewLayer: vi.fn(),
};

const mockViewStateStoreState = {
  getWorkspaceViewState: vi.fn(() => ({
    layers: [{ id: 'layer-existing-1' }, { id: 'layer-existing-2' }],
  })),
};

const mockSurfaceStoreState: {
  surfaces: Map<string, { handle: string; name: string }>;
  activeSurfaceId: string | null;
  selectedItemType: 'geometry' | 'dataLayer' | null;
  selectedLayerId: string | null;
  surfaceViewHandles: Map<string, string>;
  surfaceViewSelections: Map<string, {
    activeSurfaceId: string | null;
    selectedItemType: 'geometry' | 'dataLayer' | null;
    selectedLayerId: string | null;
  }>;
} = {
  surfaces: new Map(),
  activeSurfaceId: null,
  selectedItemType: null,
  selectedLayerId: null,
  surfaceViewHandles: new Map(),
  surfaceViewSelections: new Map(),
};

const mockActivePanelStoreState = {
  componentType: null as string | null,
  componentState: null as Record<string, unknown> | null,
};

const mockActiveRenderContextStoreState = {
  activeId: null as string | null,
};

vi.mock('@/events/EventBus', () => ({
  getEventBus: vi.fn(() => mockEventBus),
}));

vi.mock('../apiService', () => ({
  getApiService: vi.fn(() => mockApiService),
}));

vi.mock('../VolumeLoadingService', () => ({
  getVolumeLoadingService: vi.fn(() => mockVolumeLoadingService),
}));

vi.mock('../SurfaceLoadingService', () => ({
  getSurfaceLoadingService: vi.fn(() => mockSurfaceLoadingService),
}));

vi.mock('@/stores/loadingQueueStore', () => ({
  useLoadingQueueStore: {
    getState: vi.fn(() => mockQueueState),
  },
}));

vi.mock('@/stores/surfaceStore', () => ({
  useSurfaceStore: {
    getState: vi.fn(() => mockSurfaceStoreState),
  },
}));

vi.mock('@/stores/activePanelStore', () => ({
  useActivePanelStore: {
    getState: vi.fn(() => mockActivePanelStoreState),
  },
}));

vi.mock('@/stores/activeRenderContextStore', () => ({
  useActiveRenderContextStore: {
    getState: vi.fn(() => mockActiveRenderContextStoreState),
  },
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => mockWorkspaceStoreState),
  },
}));

vi.mock('@/stores/comparisonStore', () => ({
  useComparisonStore: {
    getState: vi.fn(() => mockComparisonStoreState),
  },
}));

vi.mock('@/stores/viewStateStore', () => ({
  useViewStateStore: {
    getState: vi.fn(() => mockViewStateStoreState),
  },
}));

vi.mock('../SurfaceOverlayService', () => ({
  surfaceOverlayService: mockSurfaceOverlayService,
}));

describe('DisplayLifecycleOrchestrator', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    mockQueueState.isLoading.mockReturnValue(false);
    mockQueueState.enqueue.mockReturnValue('queue-1');
    mockSurfaceLoadingService.isSupportedSurfaceFile.mockReturnValue(false);
    mockSurfaceOverlayService.detectGiftiType.mockReturnValue('unknown');

    mockSurfaceStoreState.surfaces = new Map();
    mockSurfaceStoreState.activeSurfaceId = null;
    mockSurfaceStoreState.selectedItemType = null;
    mockSurfaceStoreState.selectedLayerId = null;
    mockSurfaceStoreState.surfaceViewHandles = new Map();
    mockSurfaceStoreState.surfaceViewSelections = new Map();
    mockActivePanelStoreState.componentType = null;
    mockActivePanelStoreState.componentState = null;
    mockActiveRenderContextStoreState.activeId = null;
    mockWorkspaceStoreState.workspaces = new Map();
    mockWorkspaceStoreState.activeWorkspaceId = 'workspace-active';
    mockWorkspaceStoreState.createWorkspace.mockClear();
    mockWorkspaceStoreState.createWorkspace.mockImplementation(async (type: string) => `${type}-workspace-1`);
    mockWorkspaceStoreState.activateWorkspace.mockClear();
    mockComparisonStoreState.initFromCurrentAndNewLayer.mockClear();
    mockViewStateStoreState.getWorkspaceViewState.mockClear();
    mockViewStateStoreState.getWorkspaceViewState.mockReturnValue({
      layers: [{ id: 'layer-existing-1' }, { id: 'layer-existing-2' }],
    });

    const module = await import('../DisplayLifecycleOrchestrator');
    (module.DisplayLifecycleOrchestrator as any).instance = null;
  });

  it('routes NIfTI loads through volume flow only', async () => {
    mockApiService.loadFile.mockResolvedValue({
      id: 'vol-1',
      name: 'MNI152',
      path: '/tmp/mni152.nii.gz',
      dims: [182, 218, 182],
      dtype: 'f32',
      volume_type: 'Volume3D',
    });
    mockVolumeLoadingService.loadVolume.mockResolvedValue({ id: 'layer-1' });

    const { DisplayLifecycleOrchestrator } = await import('../DisplayLifecycleOrchestrator');
    const orchestrator = DisplayLifecycleOrchestrator.getInstance();

    await orchestrator.loadFile({ path: '/tmp/mni152.nii.gz', ingress: 'programmatic' });

    expect(mockApiService.loadFile).toHaveBeenCalledWith('/tmp/mni152.nii.gz');
    expect(mockVolumeLoadingService.loadVolume).toHaveBeenCalledTimes(1);
    expect(mockSurfaceLoadingService.loadSurfaceFile).not.toHaveBeenCalled();
    expect(mockSurfaceOverlayService.loadSurfaceOverlay).not.toHaveBeenCalled();
    expect(mockQueueState.enqueue).toHaveBeenCalledWith({
      type: 'file',
      path: '/tmp/mni152.nii.gz',
      displayName: 'mni152.nii.gz',
    });
    expect(mockEventBus.emit).toHaveBeenCalledWith('file.loading', { path: '/tmp/mni152.nii.gz' });
    expect(mockEventBus.emit).toHaveBeenCalledWith('file.loaded', {
      path: '/tmp/mni152.nii.gz',
      volumeId: 'vol-1',
    });
  });

  it('routes GIfTI geometry files through surface loader only', async () => {
    mockSurfaceLoadingService.isSupportedSurfaceFile.mockReturnValue(true);
    mockSurfaceOverlayService.detectGiftiType.mockReturnValue('geometry');

    const { DisplayLifecycleOrchestrator } = await import('../DisplayLifecycleOrchestrator');
    const orchestrator = DisplayLifecycleOrchestrator.getInstance();

    await orchestrator.loadFile({ path: '/tmp/lh.pial.gii', ingress: 'file-browser' });

    expect(mockSurfaceLoadingService.loadSurfaceFile).toHaveBeenCalledWith({
      path: '/tmp/lh.pial.gii',
      displayName: 'lh.pial.gii',
      autoActivate: true,
      validateMesh: true,
    });
    expect(mockApiService.loadFile).not.toHaveBeenCalled();
    expect(mockVolumeLoadingService.loadVolume).not.toHaveBeenCalled();
    expect(mockSurfaceOverlayService.loadSurfaceOverlay).not.toHaveBeenCalled();
  });

  it('routes overlay GIfTI files through overlay flow and keeps route exclusive', async () => {
    mockSurfaceOverlayService.detectGiftiType.mockReturnValue('overlay');
    mockSurfaceLoadingService.isSupportedSurfaceFile.mockReturnValue(true);
    mockSurfaceOverlayService.loadSurfaceOverlay.mockResolvedValue({ id: 'overlay-1' });

    const surface = { handle: 'surf-1', name: 'fsaverage lh pial' };
    mockSurfaceStoreState.surfaces = new Map([[surface.handle, surface]]);
    mockSurfaceStoreState.activeSurfaceId = surface.handle;

    const { DisplayLifecycleOrchestrator } = await import('../DisplayLifecycleOrchestrator');
    const orchestrator = DisplayLifecycleOrchestrator.getInstance();

    await orchestrator.loadFile({ path: '/tmp/atlas.label.gii', ingress: 'drag-drop' });

    expect(mockSurfaceOverlayService.loadSurfaceOverlay).toHaveBeenCalledWith('/tmp/atlas.label.gii', 'surf-1');
    expect(mockSurfaceLoadingService.loadSurfaceFile).not.toHaveBeenCalled();
    expect(mockApiService.loadFile).not.toHaveBeenCalled();
    expect(mockVolumeLoadingService.loadVolume).not.toHaveBeenCalled();
    expect(mockSurfaceLoadingService.isSupportedSurfaceFile).not.toHaveBeenCalled();
  });

  it('targets the focused surface view selection for overlays when multiple surfaces are loaded', async () => {
    mockSurfaceOverlayService.detectGiftiType.mockReturnValue('overlay');
    mockSurfaceOverlayService.loadSurfaceOverlay.mockResolvedValue({ id: 'overlay-2' });

    const left = { handle: 'surf-1', name: 'left surface' };
    const right = { handle: 'surf-2', name: 'right surface' };
    mockSurfaceStoreState.surfaces = new Map([
      [left.handle, left],
      [right.handle, right],
    ]);
    mockSurfaceStoreState.activeSurfaceId = left.handle;
    mockSurfaceStoreState.selectedItemType = 'geometry';
    mockSurfaceStoreState.surfaceViewHandles = new Map([
      ['view-1', left.handle],
      ['view-2', right.handle],
    ]);
    mockSurfaceStoreState.surfaceViewSelections = new Map([
      ['view-1', {
        activeSurfaceId: left.handle,
        selectedItemType: 'geometry',
        selectedLayerId: null,
      }],
      ['view-2', {
        activeSurfaceId: right.handle,
        selectedItemType: 'geometry',
        selectedLayerId: null,
      }],
    ]);
    mockActivePanelStoreState.componentType = 'SurfaceView';
    mockActivePanelStoreState.componentState = {
      surfaceViewId: 'view-2',
      surfaceHandle: right.handle,
    };

    const { DisplayLifecycleOrchestrator } = await import('../DisplayLifecycleOrchestrator');
    const orchestrator = DisplayLifecycleOrchestrator.getInstance();

    await orchestrator.loadFile({ path: '/tmp/right.func.gii', ingress: 'file-dialog' });

    expect(mockSurfaceOverlayService.loadSurfaceOverlay).toHaveBeenCalledWith('/tmp/right.func.gii', right.handle);
  });

  it('emits user-facing error and aborts overlay load when no surface is available', async () => {
    mockSurfaceOverlayService.detectGiftiType.mockReturnValue('overlay');
    mockSurfaceStoreState.surfaces = new Map();

    const { DisplayLifecycleOrchestrator } = await import('../DisplayLifecycleOrchestrator');
    const orchestrator = DisplayLifecycleOrchestrator.getInstance();

    await orchestrator.loadFile({ path: '/tmp/atlas.label.gii' });

    expect(mockSurfaceOverlayService.loadSurfaceOverlay).not.toHaveBeenCalled();
    expect(mockEventBus.emit).toHaveBeenCalledWith('ui.notification', {
      type: 'error',
      message: 'No surfaces loaded. Please load a surface first before applying overlays.',
    });
  });

  it('guards invalid ingress paths (empty + unsupported extension)', async () => {
    const { DisplayLifecycleOrchestrator } = await import('../DisplayLifecycleOrchestrator');
    const orchestrator = DisplayLifecycleOrchestrator.getInstance();

    await orchestrator.loadFile({ path: '   ' });
    await orchestrator.loadFile({ path: '/tmp/readme.txt' });

    expect(mockApiService.loadFile).not.toHaveBeenCalled();
    expect(mockVolumeLoadingService.loadVolume).not.toHaveBeenCalled();
    expect(mockSurfaceLoadingService.loadSurfaceFile).not.toHaveBeenCalled();
    expect(mockSurfaceOverlayService.loadSurfaceOverlay).not.toHaveBeenCalled();
    expect(mockEventBus.emit).toHaveBeenCalledWith('ui.notification', {
      type: 'error',
      message: 'Cannot load an empty path',
    });
    expect(mockEventBus.emit).toHaveBeenCalledWith('ui.notification', {
      type: 'warning',
      message: 'File type not supported. Supported types: .nii, .nii.gz, .gii, .gifti',
    });
  });

  it('creates a fresh orthogonal workspace before loading when intent is new-workspace', async () => {
    mockApiService.loadFile.mockResolvedValue({
      id: 'vol-2',
      name: 'New Volume',
      path: '/tmp/new-volume.nii.gz',
      dims: [64, 64, 64],
      dtype: 'f32',
      volume_type: 'Volume3D',
    });
    mockVolumeLoadingService.loadVolume.mockResolvedValue({ id: 'layer-new', name: 'New Volume' });

    const { DisplayLifecycleOrchestrator } = await import('../DisplayLifecycleOrchestrator');
    const orchestrator = DisplayLifecycleOrchestrator.getInstance();

    await orchestrator.loadFile({
      path: '/tmp/new-volume.nii.gz',
      ingress: 'file-browser',
      intent: 'new-workspace',
    });

    expect(mockWorkspaceStoreState.createWorkspace).toHaveBeenCalledWith('orthogonal-locked');
    expect(mockVolumeLoadingService.loadVolume).toHaveBeenCalledTimes(1);
  });

  it('creates or activates a comparison workspace and seeds comparison panels from the source workspace', async () => {
    mockApiService.loadFile.mockResolvedValue({
      id: 'vol-3',
      name: 'Compare Volume',
      path: '/tmp/compare-volume.nii.gz',
      dims: [64, 64, 64],
      dtype: 'f32',
      volume_type: 'Volume3D',
    });
    mockVolumeLoadingService.loadVolume.mockResolvedValue({
      id: 'layer-compare',
      name: 'Compare Volume',
    });
    mockWorkspaceStoreState.workspaces = new Map([
      ['comparison-workspace-1', { id: 'comparison-workspace-1', type: 'comparison' }],
    ]);

    const { DisplayLifecycleOrchestrator } = await import('../DisplayLifecycleOrchestrator');
    const orchestrator = DisplayLifecycleOrchestrator.getInstance();

    await orchestrator.loadFile({
      path: '/tmp/compare-volume.nii.gz',
      ingress: 'file-browser',
      intent: 'comparison',
    });

    expect(mockWorkspaceStoreState.activateWorkspace).toHaveBeenCalledWith('comparison-workspace-1');
    expect(mockComparisonStoreState.initFromCurrentAndNewLayer).toHaveBeenCalledWith(
      'comparison-workspace-1',
      ['layer-existing-1', 'layer-existing-2'],
      'layer-compare',
      'Compare Volume'
    );
  });
});

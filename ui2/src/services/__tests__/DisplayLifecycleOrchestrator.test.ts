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
  applyOverlayToSurface: vi.fn(),
};

const mockSurfaceStoreState: {
  surfaces: Map<string, { handle: string; name: string }>;
  activeSurfaceId: string | null;
} = {
  surfaces: new Map(),
  activeSurfaceId: null,
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
    mockSurfaceOverlayService.applyOverlayToSurface.mockResolvedValue(undefined);

    const surface = { handle: 'surf-1', name: 'fsaverage lh pial' };
    mockSurfaceStoreState.surfaces = new Map([[surface.handle, surface]]);
    mockSurfaceStoreState.activeSurfaceId = surface.handle;

    const { DisplayLifecycleOrchestrator } = await import('../DisplayLifecycleOrchestrator');
    const orchestrator = DisplayLifecycleOrchestrator.getInstance();

    await orchestrator.loadFile({ path: '/tmp/atlas.label.gii', ingress: 'drag-drop' });

    expect(mockSurfaceOverlayService.loadSurfaceOverlay).toHaveBeenCalledWith('/tmp/atlas.label.gii', 'surf-1');
    expect(mockSurfaceOverlayService.applyOverlayToSurface).toHaveBeenCalledWith('surf-1', 'overlay-1');
    expect(mockSurfaceLoadingService.loadSurfaceFile).not.toHaveBeenCalled();
    expect(mockApiService.loadFile).not.toHaveBeenCalled();
    expect(mockVolumeLoadingService.loadVolume).not.toHaveBeenCalled();
    expect(mockSurfaceLoadingService.isSupportedSurfaceFile).not.toHaveBeenCalled();
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
});

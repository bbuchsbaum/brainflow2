import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioDisplayService } from '../StudioDisplayService';

const mockFileLoadingService = {
  loadFile: vi.fn(),
};

const mockLayerService = {
  toggleVisibility: vi.fn(),
};

const mockLayerStoreState = {
  layers: [
    {
      id: 'layer-current',
      sourcePath: '/tmp/current.nii.gz',
      visible: true,
    },
  ] as Array<{ id: string; sourcePath?: string | null; visible: boolean }>,
  layerMetadata: new Map<string, { sourcePath?: string }>([
    ['layer-current', { sourcePath: '/tmp/current.nii.gz' }],
  ]),
  selectLayer: vi.fn(),
};

const mockWorkspaceStoreState = {
  workspaces: new Map<string, { id: string; type: string }>(),
  createWorkspace: vi.fn(async () => 'comparison-workspace-1'),
  activateWorkspace: vi.fn(),
};

const mockComparisonStoreState = {
  initFromCurrentAndNewLayer: vi.fn(),
};

vi.mock('@/services/FileLoadingService', () => ({
  getFileLoadingService: () => mockFileLoadingService,
}));

vi.mock('@/services/LayerService', () => ({
  getLayerService: () => mockLayerService,
}));

vi.mock('@/stores/layerStore', () => ({
  useLayerStore: {
    getState: () => mockLayerStoreState,
  },
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => mockWorkspaceStoreState,
  },
}));

vi.mock('@/stores/comparisonStore', () => ({
  useComparisonStore: {
    getState: () => mockComparisonStoreState,
  },
}));

describe('StudioDisplayService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLayerStoreState.layers = [
      {
        id: 'layer-current',
        sourcePath: '/tmp/current.nii.gz',
        visible: true,
      },
    ];
    mockLayerStoreState.layerMetadata = new Map([
      ['layer-current', { sourcePath: '/tmp/current.nii.gz' }],
    ]);
    mockWorkspaceStoreState.workspaces = new Map();
    mockWorkspaceStoreState.createWorkspace.mockResolvedValue('comparison-workspace-1');

    mockFileLoadingService.loadFile.mockImplementation(async (path: string) => {
      if (path === '/tmp/compare.nii.gz') {
        mockLayerStoreState.layers.push({
          id: 'layer-compare',
          sourcePath: '/tmp/compare.nii.gz',
          visible: true,
        });
        mockLayerStoreState.layerMetadata.set('layer-compare', {
          sourcePath: '/tmp/compare.nii.gz',
        });
      }
    });
  });

  it('loads a missing compare output and opens a comparison workspace with current + compare layers', async () => {
    const service = new StudioDisplayService();

    await service.openComparisonForPaths({
      currentSourcePath: '/tmp/current.nii.gz',
      compareSourcePath: '/tmp/compare.nii.gz',
      managedCurrentSourcePaths: ['/tmp/current.nii.gz'],
      compareLabel: 'Z-score',
    });

    expect(mockFileLoadingService.loadFile).toHaveBeenCalledWith(
      '/tmp/compare.nii.gz',
      'programmatic',
      'add-layer'
    );
    expect(mockWorkspaceStoreState.createWorkspace).toHaveBeenCalledWith('comparison');
    expect(mockComparisonStoreState.initFromCurrentAndNewLayer).toHaveBeenCalledWith(
      'comparison-workspace-1',
      ['layer-current'],
      'layer-compare',
      'Z-score'
    );
    expect(mockWorkspaceStoreState.activateWorkspace).toHaveBeenCalledWith('comparison-workspace-1');
  });

  it('reuses an existing comparison workspace and unhides an already-loaded compare layer', async () => {
    mockLayerStoreState.layers.push({
      id: 'layer-compare',
      sourcePath: '/tmp/compare.nii.gz',
      visible: false,
    });
    mockLayerStoreState.layerMetadata.set('layer-compare', {
      sourcePath: '/tmp/compare.nii.gz',
    });
    mockWorkspaceStoreState.workspaces = new Map([
      ['comparison-existing', { id: 'comparison-existing', type: 'comparison' }],
    ]);

    const service = new StudioDisplayService();

    await service.openComparisonForPaths({
      currentSourcePath: '/tmp/current.nii.gz',
      compareSourcePath: '/tmp/compare.nii.gz',
      compareLabel: 'Residual',
    });

    expect(mockFileLoadingService.loadFile).not.toHaveBeenCalled();
    expect(mockWorkspaceStoreState.createWorkspace).not.toHaveBeenCalled();
    expect(mockLayerService.toggleVisibility).toHaveBeenCalledWith('layer-compare', true);
    expect(mockComparisonStoreState.initFromCurrentAndNewLayer).toHaveBeenCalledWith(
      'comparison-existing',
      ['layer-current'],
      'layer-compare',
      'Residual'
    );
    expect(mockWorkspaceStoreState.activateWorkspace).toHaveBeenCalledWith('comparison-existing');
  });
});

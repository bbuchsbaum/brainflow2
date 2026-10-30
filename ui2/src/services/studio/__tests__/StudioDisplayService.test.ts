import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioDisplayService } from '../StudioDisplayService';
import { useAppModeStore } from '@/stores/appModeStore';
import { studioMemberForLoad } from '../studioMemberLoads';

const mockFileLoadingService = {
  loadFile: vi.fn(),
};

const mockTemplateService = {
  loadTemplateBySourcePath: vi.fn(),
};

const mockLayerService = {
  toggleVisibility: vi.fn(),
  removeLayer: vi.fn(async () => undefined),
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
  getLayer(id: string) {
    return this.layers.find((layer) => layer.id === id);
  },
};

const mockWorkspaceStoreState = {
  workspaces: new Map<string, { id: string; type: string }>(),
  createWorkspace: vi.fn(async () => 'comparison-workspace-1'),
  activateWorkspace: vi.fn(),
};

const mockComparisonStoreState = {
  initFromCurrentAndNewLayer: vi.fn(),
  ensurePanelsForLayers: vi.fn(),
};

vi.mock('@/services/FileLoadingService', () => ({
  getFileLoadingService: () => mockFileLoadingService,
}));

vi.mock('@/services/TemplateService', () => ({
  getTemplateService: () => mockTemplateService,
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

    mockTemplateService.loadTemplateBySourcePath.mockImplementation(async (sourcePath: string) => {
      if (sourcePath === 'template:MNI152NLin2009cAsym_GM_2mm') {
        mockLayerStoreState.layers.push({
          id: 'layer-template',
          sourcePath,
          visible: true,
        });
        mockLayerStoreState.layerMetadata.set('layer-template', { sourcePath });
      }
    });
  });

  it('marks member loads as Studio loads for the log, only while they run', async () => {
    const service = new StudioDisplayService();
    let duringLoad: string | undefined;
    mockFileLoadingService.loadFile.mockImplementationOnce(async (path: string) => {
      duringLoad = studioMemberForLoad(path);
      mockLayerStoreState.layers.push({ id: 'layer-member', sourcePath: path, visible: true });
    });

    await service.ensureMemberDisplayed(
      {
        memberSummaries: [{ id: 's01_faces_l2', sourcePath: '/tmp/member.nii.gz' }],
      } as unknown as Parameters<StudioDisplayService['ensureMemberDisplayed']>[0],
      's01_faces_l2'
    );

    expect(duringLoad).toBe('s01_faces_l2');
    expect(studioMemberForLoad('/tmp/member.nii.gz')).toBeUndefined();
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
    expect(mockComparisonStoreState.ensurePanelsForLayers).toHaveBeenCalledWith(
      'comparison-workspace-1',
      ['layer-current', 'layer-compare'],
      expect.any(Map)
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
    expect(mockComparisonStoreState.ensurePanelsForLayers).toHaveBeenCalledWith(
      'comparison-existing',
      ['layer-current', 'layer-compare'],
      expect.any(Map)
    );
    expect(mockWorkspaceStoreState.activateWorkspace).toHaveBeenCalledWith('comparison-existing');
  });

  it('loads template-backed sources through TemplateService instead of FileLoadingService', async () => {
    const service = new StudioDisplayService();

    await service.ensureSourcePathDisplayed(
      'template:MNI152NLin2009cAsym_GM_2mm',
      ['template:MNI152NLin2009cAsym_GM_2mm']
    );

    expect(mockTemplateService.loadTemplateBySourcePath).toHaveBeenCalledWith(
      'template:MNI152NLin2009cAsym_GM_2mm'
    );
    expect(mockFileLoadingService.loadFile).not.toHaveBeenCalled();
    expect(mockLayerStoreState.selectLayer).toHaveBeenCalledWith('layer-template');
  });

  describe('Studio isolation (QA 2026-10-29 §11)', () => {
    it('removes the member layers it loaded when the Studio is left', async () => {
      const service = new StudioDisplayService();
      await service.ensureSourcePathDisplayed('/tmp/compare.nii.gz', ['/tmp/compare.nii.gz']);
      expect(service.ownsLayer('layer-compare')).toBe(true);
      expect(service.ownsLayer('layer-current')).toBe(false);

      await service.releaseStudioLayers();

      expect(mockLayerService.removeLayer).toHaveBeenCalledTimes(1);
      expect(mockLayerService.removeLayer).toHaveBeenCalledWith('layer-compare');
      expect(service.ownsLayer('layer-compare')).toBe(false);
    });

    it('keeps the layers it handed to a Compare view', async () => {
      const service = new StudioDisplayService();
      await service.openComparisonForPaths({
        currentSourcePath: '/tmp/current.nii.gz',
        compareSourcePath: '/tmp/compare.nii.gz',
      });

      await service.releaseStudioLayers();

      expect(mockLayerService.removeLayer).not.toHaveBeenCalled();
    });

    it('restores the visibility of a user layer the Studio hid', async () => {
      mockLayerService.toggleVisibility.mockImplementation((id: string, visible: boolean) => {
        const layer = mockLayerStoreState.layers.find((l) => l.id === id);
        if (layer) layer.visible = visible;
      });
      const service = new StudioDisplayService();
      await service.ensureSourcePathDisplayed('/tmp/compare.nii.gz', [
        '/tmp/current.nii.gz',
        '/tmp/compare.nii.gz',
      ]);
      expect(mockLayerService.toggleVisibility).toHaveBeenCalledWith('layer-current', false);

      await service.releaseStudioLayers();

      expect(mockLayerService.toggleVisibility).toHaveBeenLastCalledWith('layer-current', true);
      expect(mockLayerService.removeLayer).toHaveBeenCalledWith('layer-compare');
      mockLayerService.toggleVisibility.mockReset();
    });

    it('discards a member that finishes loading after the Studio was left', async () => {
      let finish!: () => void;
      mockFileLoadingService.loadFile.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = () => {
              mockLayerStoreState.layers.push({ id: 'layer-late', sourcePath: '/tmp/late.nii.gz', visible: true });
              mockLayerStoreState.layerMetadata.set('layer-late', { sourcePath: '/tmp/late.nii.gz' });
              resolve();
            };
          }),
      );
      const service = new StudioDisplayService();
      const pending = service.ensureSourcePathDisplayed('/tmp/late.nii.gz', ['/tmp/late.nii.gz']);
      await service.releaseStudioLayers();
      finish();
      await pending;

      expect(mockLayerService.removeLayer).toHaveBeenCalledWith('layer-late');
      expect(service.ownsLayer('layer-late')).toBe(false);
      expect(mockLayerStoreState.selectLayer).not.toHaveBeenCalledWith('layer-late');
    });

    it('a quick re-entry waits for the release instead of reusing a layer about to go (review C2)', async () => {
      const service = new StudioDisplayService();
      await service.ensureSourcePathDisplayed('/tmp/compare.nii.gz', ['/tmp/compare.nii.gz']);
      let finishRemoval!: () => void;
      mockLayerService.removeLayer.mockImplementationOnce(
        (id: string) =>
          new Promise<undefined>((resolve) => {
            finishRemoval = () => {
              mockLayerStoreState.layers = mockLayerStoreState.layers.filter((l) => l.id !== id);
              mockLayerStoreState.layerMetadata.delete(id);
              resolve(undefined);
            };
          }),
      );

      const release = service.releaseStudioLayers();
      const reentry = service.ensureSourcePathDisplayed('/tmp/compare.nii.gz', ['/tmp/compare.nii.gz']);
      await Promise.resolve();
      expect(mockFileLoadingService.loadFile).toHaveBeenCalledTimes(1);
      finishRemoval();
      await Promise.all([release, reentry]);

      // Reloaded for the new session, and owned by it.
      expect(mockFileLoadingService.loadFile).toHaveBeenCalledTimes(2);
      expect(service.ownsLayer('layer-compare')).toBe(true);
    });

    it('keeps a late member when the Studio was re-entered meanwhile (review C2)', async () => {
      let finish!: () => void;
      mockFileLoadingService.loadFile.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = () => {
              mockLayerStoreState.layers.push({ id: 'layer-late', sourcePath: '/tmp/late.nii.gz', visible: true });
              mockLayerStoreState.layerMetadata.set('layer-late', { sourcePath: '/tmp/late.nii.gz' });
              resolve();
            };
          }),
      );
      const service = new StudioDisplayService();
      const pending = service.ensureSourcePathDisplayed('/tmp/late.nii.gz', ['/tmp/late.nii.gz']);
      await service.releaseStudioLayers();
      useAppModeStore.getState().enterStudioMode();
      try {
        finish();
        await pending;
      } finally {
        useAppModeStore.getState().enterImagingMode();
      }

      expect(mockLayerService.removeLayer).not.toHaveBeenCalledWith('layer-late');
      expect(service.ownsLayer('layer-late')).toBe(true);
    });
  });
});


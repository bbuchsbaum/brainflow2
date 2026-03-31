import { getFileLoadingService } from '@/services/FileLoadingService';
import { getLayerService } from '@/services/LayerService';
import { getTemplateService } from '@/services/TemplateService';
import { useLayerStore } from '@/stores/layerStore';
import type { SpatialFieldSetSummary } from '@/types/studio';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useComparisonStore } from '@/stores/comparisonStore';

export class StudioDisplayService {
  private static instance: StudioDisplayService | null = null;
  private inFlightPath: string | null = null;

  static getInstance(): StudioDisplayService {
    if (!StudioDisplayService.instance) {
      StudioDisplayService.instance = new StudioDisplayService();
    }
    return StudioDisplayService.instance;
  }

  async ensureMemberDisplayed(
    activeSet: SpatialFieldSetSummary | null,
    memberId: string | null
  ): Promise<void> {
    if (!activeSet || !memberId) {
      return;
    }

    const member = activeSet.memberSummaries.find((candidate) => candidate.id === memberId);
    const sourcePath = member?.sourcePath?.trim();
    if (!sourcePath) {
      return;
    }

    const managedPaths = activeSet.memberSummaries
      .map((candidate) => candidate.sourcePath?.trim() ?? '')
      .filter((path): path is string => path.length > 0);
    await this.ensureSourcePathDisplayed(sourcePath, managedPaths);
  }

  async ensureSourcePathDisplayed(
    sourcePath: string,
    managedSourcePaths: string[] = []
  ): Promise<void> {
    const normalizedPath = this.normalizePath(sourcePath);
    if (!normalizedPath) {
      return;
    }

    const layerId = await this.ensureLayerLoaded(normalizedPath, 'default');
    if (!layerId) {
      return;
    }

    this.syncSourcePathVisibility(managedSourcePaths, layerId);
    useLayerStore.getState().selectLayer(layerId);
  }

  async openComparisonForPaths(args: {
    currentSourcePath: string;
    compareSourcePath: string;
    managedCurrentSourcePaths?: string[];
    compareLabel?: string | null;
  }): Promise<void> {
    const currentSourcePath = this.normalizePath(args.currentSourcePath);
    const compareSourcePath = this.normalizePath(args.compareSourcePath);
    if (!currentSourcePath || !compareSourcePath || currentSourcePath === compareSourcePath) {
      return;
    }

    await this.ensureSourcePathDisplayed(
      currentSourcePath,
      args.managedCurrentSourcePaths ?? []
    );

    const currentLayerId = this.findLayerIdBySourcePath(currentSourcePath);
    if (!currentLayerId) {
      return;
    }

    const compareLayerId = await this.ensureLayerLoaded(compareSourcePath, 'add-layer');
    if (!compareLayerId) {
      return;
    }

    const compareLayer = useLayerStore
      .getState()
      .layers.find((layer) => layer.id === compareLayerId);
    if (compareLayer && !compareLayer.visible) {
      getLayerService().toggleVisibility(compareLayerId, true);
    }

    const comparisonWorkspaceId = await this.ensureComparisonWorkspace();
    const layerNames = new Map<string, string>();
    useLayerStore.getState().layers.forEach((layer) => {
      layerNames.set(layer.id, layer.name ?? layer.id);
    });
    useComparisonStore.getState().ensurePanelsForLayers(
      comparisonWorkspaceId,
      [currentLayerId, compareLayerId],
      layerNames
    );
    useWorkspaceStore.getState().activateWorkspace(comparisonWorkspaceId);
  }

  private findLayerIdBySourcePath(sourcePath: string): string | null {
    const state = useLayerStore.getState();
    const matchingLayer = state.layers.find((layer) => {
      const metadata = state.layerMetadata.get(layer.id);
      return metadata?.sourcePath === sourcePath || layer.sourcePath === sourcePath;
    });
    return matchingLayer?.id ?? null;
  }

  private syncSourcePathVisibility(
    sourcePaths: string[],
    visibleLayerId: string
  ): void {
    const managedSourcePaths = new Set(
      sourcePaths.map((path) => path.trim()).filter((path): path is string => path.length > 0)
    );
    if (managedSourcePaths.size === 0) {
      return;
    }

    const layerState = useLayerStore.getState();
    const layerService = getLayerService();
    layerState.layers.forEach((layer) => {
      const metadata = layerState.layerMetadata.get(layer.id);
      const sourcePath = metadata?.sourcePath ?? layer.sourcePath;
      if (!sourcePath || !managedSourcePaths.has(sourcePath)) {
        return;
      }

      const shouldBeVisible = layer.id === visibleLayerId;
      if (layer.visible !== shouldBeVisible) {
        layerService.toggleVisibility(layer.id, shouldBeVisible);
      }
    });
  }

  private normalizePath(sourcePath: string | null | undefined): string {
    return sourcePath?.trim() ?? '';
  }

  private isTemplateSource(sourcePath: string): boolean {
    return sourcePath.startsWith('template:');
  }

  private async ensureLayerLoaded(
    sourcePath: string,
    intent: 'default' | 'add-layer'
  ): Promise<string | null> {
    const existingLayerId = this.findLayerIdBySourcePath(sourcePath);
    if (existingLayerId) {
      return existingLayerId;
    }

    if (this.inFlightPath === sourcePath) {
      return null;
    }

    this.inFlightPath = sourcePath;
    try {
      if (this.isTemplateSource(sourcePath)) {
        await getTemplateService().loadTemplateBySourcePath(sourcePath);
      } else {
        await getFileLoadingService().loadFile(sourcePath, 'programmatic', intent);
      }
      return this.findLayerIdBySourcePath(sourcePath);
    } finally {
      if (this.inFlightPath === sourcePath) {
        this.inFlightPath = null;
      }
    }
  }

  private async ensureComparisonWorkspace(): Promise<string> {
    const workspaceStore = useWorkspaceStore.getState();
    const existing = Array.from(workspaceStore.workspaces.values()).find(
      (workspace) => workspace.type === 'comparison'
    );

    if (existing) {
      workspaceStore.activateWorkspace(existing.id);
      return existing.id;
    }

    return workspaceStore.createWorkspace('comparison');
  }
}

let instance: StudioDisplayService | null = null;

export function getStudioDisplayService(): StudioDisplayService {
  if (!instance) {
    instance = StudioDisplayService.getInstance();
  }
  return instance;
}

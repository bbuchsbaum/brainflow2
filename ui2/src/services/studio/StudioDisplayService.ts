import { getFileLoadingService } from '@/services/FileLoadingService';
import { getLayerService } from '@/services/LayerService';
import { useLayerStore } from '@/stores/layerStore';
import type { SpatialFieldSetSummary } from '@/types/studio';

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
    const normalizedPath = sourcePath.trim();
    if (!normalizedPath) {
      return;
    }

    const existingLayerId = this.findLayerIdBySourcePath(normalizedPath);
    if (existingLayerId) {
      this.syncSourcePathVisibility(managedSourcePaths, existingLayerId);
      useLayerStore.getState().selectLayer(existingLayerId);
      return;
    }

    if (this.inFlightPath === normalizedPath) {
      return;
    }

    this.inFlightPath = normalizedPath;
    try {
      await getFileLoadingService().loadFile(normalizedPath, 'programmatic');
      const loadedLayerId = this.findLayerIdBySourcePath(normalizedPath);
      if (loadedLayerId) {
        this.syncSourcePathVisibility(managedSourcePaths, loadedLayerId);
        useLayerStore.getState().selectLayer(loadedLayerId);
      }
    } finally {
      if (this.inFlightPath === normalizedPath) {
        this.inFlightPath = null;
      }
    }
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
}

let instance: StudioDisplayService | null = null;

export function getStudioDisplayService(): StudioDisplayService {
  if (!instance) {
    instance = StudioDisplayService.getInstance();
  }
  return instance;
}

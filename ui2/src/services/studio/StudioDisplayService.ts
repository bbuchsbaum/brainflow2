import { getFileLoadingService } from '@/services/FileLoadingService';
import { getLayerService } from '@/services/LayerService';
import { getTemplateService } from '@/services/TemplateService';
import { useLayerStore } from '@/stores/layerStore';
import type { SpatialFieldSetSummary } from '@/types/studio';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useAppModeStore } from '@/stores/appModeStore';
import { markStudioMemberLoad } from './studioMemberLoads';

/** The Studio is the active mode right now. */
function isStudioActive(): boolean {
  return useAppModeStore.getState().mode === 'studio';
}

type LayerStoreState = ReturnType<typeof useLayerStore.getState>;

/** The layer loaded from `sourcePath`, if any (a store selector). */
export function findLayerIdForSourcePath(
  state: Pick<LayerStoreState, 'layers' | 'layerMetadata'>,
  sourcePath: string | null | undefined,
): string | null {
  const path = sourcePath?.trim();
  if (!path) return null;
  const matchingLayer = state.layers.find((layer) => {
    const metadata = state.layerMetadata.get(layer.id);
    return metadata?.sourcePath === path || layer.sourcePath === path;
  });
  return matchingLayer?.id ?? null;
}

export class StudioDisplayService {
  private static instance: StudioDisplayService | null = null;
  private inFlightPath: string | null = null;
  /**
   * Layers the Studio loaded to display its members. They belong to the
   * Studio session: leaving the Studio removes them, so a member such as
   * "Faces beta (sub-01)" never stays in the imaging scene (QA §11).
   */
  private readonly owned = new Set<string>();
  /** Visibility of user layers the Studio changed, restored on release. */
  private readonly userVisibility = new Map<string, boolean>();
  /** Bumped by release, so a load can tell it outlived its session. */
  private session = 0;
  /** The release in progress: a quick re-entry waits for it. */
  private releasing: Promise<void> | null = null;

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
    await this.ensureSourcePathDisplayed(sourcePath, managedPaths, member?.id);
  }

  async ensureSourcePathDisplayed(
    sourcePath: string,
    managedSourcePaths: string[] = [],
    memberLabel?: string | null
  ): Promise<void> {
    const normalizedPath = this.normalizePath(sourcePath);
    if (!normalizedPath) {
      return;
    }

    const layerId = await this.ensureLayerLoaded(normalizedPath, 'default', memberLabel);
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

    const compareLayerId = await this.ensureLayerLoaded(
      compareSourcePath,
      'add-layer',
      args.compareLabel
    );
    if (!compareLayerId) {
      return;
    }

    // Opening a Compare view is an explicit hand-off: both layers now
    // belong to that workspace and stay when the Studio is left.
    this.adopt(currentLayerId);
    this.adopt(compareLayerId);

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
    return findLayerIdForSourcePath(useLayerStore.getState(), sourcePath);
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
        if (!this.owned.has(layer.id) && !this.userVisibility.has(layer.id)) {
          this.userVisibility.set(layer.id, layer.visible);
        }
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
    intent: 'default' | 'add-layer',
    memberLabel?: string | null
  ): Promise<string | null> {
    // Re-entering the Studio while its last session's layers are being
    // removed: wait, or this would reuse a layer that is about to go.
    if (this.releasing) await this.releasing;
    const existingLayerId = this.findLayerIdBySourcePath(sourcePath);
    if (existingLayerId) {
      return existingLayerId;
    }

    if (this.inFlightPath === sourcePath) {
      return null;
    }

    this.inFlightPath = sourcePath;
    const session = this.session;
    // The log attributes this load to the Studio member, not to a plain file.
    const unmark = markStudioMemberLoad(
      sourcePath,
      memberLabel?.trim() || sourcePath.split(/[\\/]/).pop() || sourcePath
    );
    try {
      if (this.isTemplateSource(sourcePath)) {
        await getTemplateService().loadTemplateBySourcePath(sourcePath);
      } else {
        await getFileLoadingService().loadFile(sourcePath, 'programmatic', intent);
      }
      const layerId = this.findLayerIdBySourcePath(sourcePath);
      if (!layerId) return null;
      if (session !== this.session && !isStudioActive()) {
        // The Studio was left while this member loaded (and not re-entered).
        await getLayerService().removeLayer(layerId).catch((error) => {
          console.warn('[StudioDisplayService] Could not discard a late member layer:', error);
        });
        return null;
      }
      this.owned.add(layerId);
      return layerId;
    } finally {
      unmark();
      if (this.inFlightPath === sourcePath) {
        this.inFlightPath = null;
      }
    }
  }

  /** Keep a Studio-loaded layer after the Studio is left. */
  adopt(layerId: string): void {
    this.owned.delete(layerId);
    this.userVisibility.delete(layerId);
  }

  /** Whether the Studio session owns `layerId` (tests, diagnostics). */
  ownsLayer(layerId: string): boolean {
    return this.owned.has(layerId);
  }

  /**
   * Leaving the Studio: remove the layers it loaded (full teardown through
   * the layer service) and restore the visibility of user layers it hid.
   */
  releaseStudioLayers(): Promise<void> {
    const run = this.releaseOnce();
    this.releasing = run;
    return run.finally(() => {
      if (this.releasing === run) this.releasing = null;
    });
  }

  private async releaseOnce(): Promise<void> {
    this.session += 1;
    const owned = [...this.owned];
    this.owned.clear();
    const restore = [...this.userVisibility];
    this.userVisibility.clear();

    const layerService = getLayerService();
    const present = new Set(useLayerStore.getState().layers.map((layer) => layer.id));
    for (const [layerId, visible] of restore) {
      const layer = useLayerStore.getState().getLayer(layerId);
      if (layer && layer.visible !== visible) layerService.toggleVisibility(layerId, visible);
    }
    await Promise.all(
      owned
        .filter((layerId) => present.has(layerId))
        .map((layerId) =>
          layerService.removeLayer(layerId).catch((error) => {
            console.warn(`[StudioDisplayService] Could not remove Studio layer ${layerId}:`, error);
          }),
        ),
    );
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

/**
 * ComparisonRenderService
 *
 * Renders comparison panels by cloning the global ViewState, masking layer
 * visibility per panel, and calling apiService.applyAndRenderViewState().
 * Results are stored in renderStateStore under per-panel tags, following
 * the same pattern as MosaicRenderService.
 */

import { getApiService } from '@/services/apiService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import type { ViewState } from '@/types/viewState';
import type { ComparisonPanelConfig } from '@/types/comparison';
import type { ViewPlane, WorldCoordinates } from '@/types/coordinates';
import { resizeViewPlanePreservingFieldOfView } from '@/utils/viewGeometry';

export interface ComparisonRenderRequest {
  workspaceId: string;
  panel: ComparisonPanelConfig;
  width: number;
  height: number;
}

/** Build a tag string for a comparison panel */
export function comparisonTag(panelId: string, viewType: string): string {
  return `comp-${panelId}-${viewType}`;
}

export class ComparisonRenderService {
  private apiService = getApiService();
  private static readonly MAX_CONCURRENT = 4;
  private activeRenders = new Map<string, number>();
  private nextRequestId = 1;

  /**
   * Build a ViewState with layer visibility filtered to a panel's subset.
   */
  buildPanelViewState(
    globalViewState: ViewState,
    panel: ComparisonPanelConfig,
    viewPlane: ViewPlane
  ): ViewState {
    return {
      ...globalViewState,
      views: {
        ...globalViewState.views,
        [panel.viewType]: viewPlane,
      },
      layers: globalViewState.layers.map(layer => ({
        ...layer,
        visible: panel.visibleLayerIds.has(layer.id) ? layer.visible : false,
      })),
    };
  }

  private isPointInsideBounds(
    point: WorldCoordinates,
    bounds?: { min: [number, number, number]; max: [number, number, number] }
  ): boolean {
    if (!bounds) {
      return false;
    }

    return point.every((value, index) => (
      value >= bounds.min[index] && value <= bounds.max[index]
    ));
  }

  private getBoundsCenter(
    bounds?: { min: [number, number, number]; max: [number, number, number] }
  ): WorldCoordinates | null {
    if (!bounds) {
      return null;
    }

    return [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
  }

  private async resolvePanelViewPlane(
    globalViewState: ViewState,
    panel: ComparisonPanelConfig,
    width: number,
    height: number
  ): Promise<ViewPlane> {
    const fallbackView = resizeViewPlanePreservingFieldOfView(
      globalViewState.views[panel.viewType],
      width,
      height
    );
    const primaryLayer = globalViewState.layers.find(
      (layer) => panel.visibleLayerIds.has(layer.id) && layer.visible
    );

    if (!primaryLayer?.volumeId) {
      return fallbackView;
    }

    const metadata = useLayerStore.getState().getLayerMetadata(primaryLayer.id);
    const globalCrosshair = globalViewState.crosshair.world_mm;
    const fallbackCrosshair = metadata?.centerWorld
      ?? this.getBoundsCenter(metadata?.worldBounds)
      ?? globalCrosshair;
    const crosshair = this.isPointInsideBounds(globalCrosshair, metadata?.worldBounds)
      ? globalCrosshair
      : fallbackCrosshair;

    try {
      return await this.apiService.recalculateViewForDimensions(
        primaryLayer.volumeId,
        panel.viewType,
        [width, height],
        crosshair
      );
    } catch (error) {
      console.warn(
        `[ComparisonRenderService] Falling back to resized global view for panel ${panel.id}`,
        error
      );
      return fallbackView;
    }
  }

  /**
   * Render all panels. Each panel gets its own apiService call with a
   * filtered ViewState. The rendered ImageBitmap is stored under a tag.
   */
  async renderPanels(panels: ComparisonRenderRequest[]): Promise<void> {
    const globalViewState = useViewStateStore.getState().viewState;
    const renderStore = useRenderStateStore.getState();

    // Mark all as rendering
    for (const { panel } of panels) {
      const tag = comparisonTag(panel.id, panel.viewType);
      renderStore.setRendering(tag, true);
    }

    // Batch with controlled concurrency
    const batches = this.createBatches(panels, ComparisonRenderService.MAX_CONCURRENT);

    for (const batch of batches) {
      await Promise.all(
        batch.map(req => this.renderSinglePanel(globalViewState, req))
      );
    }
  }

  /**
   * Render a single comparison panel.
   */
  private async renderSinglePanel(
    globalViewState: ViewState,
    { panel, width, height }: ComparisonRenderRequest
  ): Promise<void> {
    const tag = comparisonTag(panel.id, panel.viewType);
    const requestId = this.nextRequestId++;
    this.activeRenders.set(tag, requestId);

    try {
      const panelView = await this.resolvePanelViewPlane(globalViewState, panel, width, height);

      if (this.activeRenders.get(tag) !== requestId) {
        return;
      }

      useComparisonStore.getState().setPanelViewPlane(panel.id, panelView);
      const filteredState = this.buildPanelViewState(globalViewState, panel, panelView);

      const imageBitmap = await this.apiService.applyAndRenderViewState(
        filteredState,
        panel.viewType,
        panelView.dim_px[0],
        panelView.dim_px[1]
      );

      if (this.activeRenders.get(tag) !== requestId) {
        return;
      }

      if (imageBitmap) {
        const renderStore = useRenderStateStore.getState();
        renderStore.setImage(tag, imageBitmap);
        renderStore.setRendering(tag, false);
      } else {
        throw new Error(`No image returned for comparison panel ${panel.id}`);
      }
    } catch (error) {
      console.error(`[ComparisonRenderService] Error rendering panel ${panel.id}:`, error);
      const renderStore = useRenderStateStore.getState();
      renderStore.setError(tag, error instanceof Error ? error : new Error(String(error)));
      renderStore.setRendering(tag, false);
    } finally {
      if (this.activeRenders.get(tag) === requestId) {
        this.activeRenders.delete(tag);
      }
    }
  }

  /**
   * Cancel any active renders for the given tags.
   */
  cancelRenders(tags: string[]): void {
    const renderStore = useRenderStateStore.getState();
    for (const tag of tags) {
      if (!this.activeRenders.has(tag)) {
        continue;
      }
      this.activeRenders.delete(tag);
      renderStore.setRendering(tag, false);
    }
  }

  private createBatches<T>(items: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }
}

// Singleton
let instance: ComparisonRenderService | null = null;

export function getComparisonRenderService(): ComparisonRenderService {
  if (!instance) {
    instance = new ComparisonRenderService();
  }
  return instance;
}

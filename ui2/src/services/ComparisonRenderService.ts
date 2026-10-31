/**
 * ComparisonRenderService
 *
 * Renders comparison panels by cloning the global ViewState, masking layer
 * visibility per panel, and calling apiService.applyAndRenderViewState().
 * Results are stored in renderStateStore under per-panel tags, following
 * the same pattern as MosaicRenderService.
 */

import { linkModeOf, panelDisplayLayers } from '@/utils/compareDisplay';
import { widenToVoxelEdges } from '@/utils/voxelEdges';
import type { CompareLinkMode } from '@/types/comparison';
import { getApiService } from '@/services/apiService';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useRenderStateStore } from '@/stores/renderStateStore';
import { useLayerStore } from '@/stores/layerStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import type { ViewState } from '@/types/viewState';
import type { ComparisonPanelConfig } from '@/types/comparison';
import type { ViewPlane, WorldCoordinates } from '@/types/coordinates';
import { resizeViewPlanePreservingFieldOfView } from '@/utils/viewGeometry';
import { getViewPlaneService } from '@/services/ViewPlaneService';
import { createDebugLogger } from '@/utils/debug';

const debug = createDebugLogger('comparison-render');
const COMPARISON_VIEW_PADDING_SCALE = 1.12;
type VolumeBounds = { min: [number, number, number]; max: [number, number, number] };

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

export function padComparisonBounds(
  bounds: VolumeBounds,
  scale: number = COMPARISON_VIEW_PADDING_SCALE
): VolumeBounds {
  if (!Number.isFinite(scale) || scale <= 1) {
    return bounds;
  }

  return {
    min: [
      (bounds.min[0] + bounds.max[0]) / 2 - ((bounds.max[0] - bounds.min[0]) * scale) / 2,
      (bounds.min[1] + bounds.max[1]) / 2 - ((bounds.max[1] - bounds.min[1]) * scale) / 2,
      (bounds.min[2] + bounds.max[2]) / 2 - ((bounds.max[2] - bounds.min[2]) * scale) / 2,
    ],
    max: [
      (bounds.min[0] + bounds.max[0]) / 2 + ((bounds.max[0] - bounds.min[0]) * scale) / 2,
      (bounds.min[1] + bounds.max[1]) / 2 + ((bounds.max[1] - bounds.min[1]) * scale) / 2,
      (bounds.min[2] + bounds.max[2]) / 2 + ((bounds.max[2] - bounds.min[2]) * scale) / 2,
    ],
  };
}

/**
 * Underlay for a panel that shows only overlays: the base volume (the first
 * non-atlas layer, as in the Scene stack), composed underneath exactly as the
 * orthogonal views compose it (same ViewState layer order and display
 * properties). Null when the panel already shows the base, shows nothing, or
 * there is no base.
 */
export function resolvePanelUnderlayId(
  panel: Pick<ComparisonPanelConfig, 'visibleLayerIds'>,
  layers: ReadonlyArray<{ id: string; source?: string }>,
): string | null {
  if (panel.visibleLayerIds.size === 0) return null;
  const base = layers.find((layer) => layer.source !== 'atlas');
  if (!base || panel.visibleLayerIds.has(base.id)) return null;
  return base.id;
}

/**
 * The layers each pane frames: its first visible layer and the underlay
 * composed under an overlay-only pane.
 */
export function comparisonPaneLayerIds(
  viewState: Pick<ViewState, 'layers'>,
  panels: ReadonlyArray<Pick<ComparisonPanelConfig, 'visibleLayerIds'>>,
): string[] {
  const { layers } = useLayerStore.getState();
  const ids = new Set<string>();
  for (const panel of panels) {
    const primary = viewState.layers.find((layer) => panel.visibleLayerIds.has(layer.id) && layer.visible);
    if (primary) ids.add(primary.id);
    const underlay = resolvePanelUnderlayId(panel, layers);
    if (underlay) ids.add(underlay);
  }
  return [...ids];
}

function boxesOverlap(a: VolumeBounds, b: VolumeBounds): boolean {
  return [0, 1, 2].every((axis) => a.min[axis] <= b.max[axis] && b.min[axis] <= a.max[axis]);
}

/**
 * The world box a pane frames so that the panes share one scale (QA
 * 2026-10-30 F7): the union of its own box and every other pane's box that
 * overlaps it. A box in another space (native vs MNI, no overlap) is left
 * out, so it does not shrink the image to a corner of a combined frame.
 */
export function sharedComparisonFrame(own: VolumeBounds, others: ReadonlyArray<VolumeBounds>): VolumeBounds {
  return unionBounds([own, ...others.filter((box) => boxesOverlap(own, box))]);
}

function unionBounds(boxes: ReadonlyArray<VolumeBounds>): VolumeBounds {
  const axes = [0, 1, 2] as const;
  return {
    min: axes.map((a) => Math.min(...boxes.map((b) => b.min[a]))) as [number, number, number],
    max: axes.map((a) => Math.max(...boxes.map((b) => b.max[a]))) as [number, number, number],
  };
}

export class ComparisonRenderService {
  private apiService = getApiService();
  private static readonly MAX_CONCURRENT = 4;
  private activeRenders = new Map<string, number>();
  private nextRequestId = 1;
  // Bounds fetched from the backend for layers whose metadata has none, by
  // volume id: every pane's frame sees them, not only the pane that fetched.
  private fetchedBounds = new Map<string, Promise<VolumeBounds | null>>();

  /** World bounds of a volume: its layer metadata, else the backend (once). */
  private volumeBounds(layerId: string, volumeId: string): Promise<VolumeBounds | null> {
    const recorded = useLayerStore.getState().getLayerMetadata(layerId)?.worldBounds as VolumeBounds | undefined;
    if (recorded) return Promise.resolve(recorded);
    let pending = this.fetchedBounds.get(volumeId);
    if (!pending) {
      pending = this.apiService.getVolumeBounds(volumeId).then(
        (bounds) => bounds as VolumeBounds,
        () => {
          this.fetchedBounds.delete(volumeId);
          return null;
        },
      );
      this.fetchedBounds.set(volumeId, pending);
    }
    return pending;
  }

  /** The voxel-edge box of a layer, or null when its bounds are unknown. */
  private async layerEdgeBox(globalViewState: ViewState, layerId: string): Promise<VolumeBounds | null> {
    const volumeId = globalViewState.layers.find((layer) => layer.id === layerId)?.volumeId;
    if (!volumeId) return null;
    const bounds = await this.volumeBounds(layerId, volumeId);
    if (!bounds) return null;
    const dims =
      useLayerStore.getState().getLayerMetadata(layerId)?.dimensions ?? (bounds as { dims?: number[] }).dims;
    return widenToVoxelEdges(bounds, dims);
  }

  /**
   * Build a ViewState with layer visibility filtered to a panel's subset.
   */
  buildPanelViewState(
    globalViewState: ViewState,
    panel: ComparisonPanelConfig,
    viewPlane: ViewPlane,
    crosshair?: WorldCoordinates,
    underlayLayerId: string | null = null,
    linkMode: CompareLinkMode = 'all'
  ): ViewState {
    return {
      ...globalViewState,
      crosshair: crosshair
        ? {
            ...globalViewState.crosshair,
            world_mm: crosshair,
          }
        : globalViewState.crosshair,
      views: {
        ...globalViewState.views,
        [panel.viewType]: viewPlane,
      },
      // Unlinked display (P3.9): the panel's own window/threshold/colormap.
      layers: panelDisplayLayers(globalViewState.layers, panel, linkMode).map(layer => ({
        ...layer,
        visible:
          panel.visibleLayerIds.has(layer.id) || layer.id === underlayLayerId
            ? layer.visible
            : false,
      })),
    };
  }

  private isPointInsideBounds(
    point: WorldCoordinates,
    bounds?: VolumeBounds
  ): boolean {
    if (!bounds) {
      return false;
    }

    return point.every((value, index) => (
      value >= bounds.min[index] && value <= bounds.max[index]
    ));
  }

  private getBoundsCenter(
    bounds?: VolumeBounds
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

  private createBoundsFittedViewPlane(
    panel: ComparisonPanelConfig,
    bounds: VolumeBounds,
    crosshair: WorldCoordinates,
    width: number,
    height: number
  ): ViewPlane {
    const paddedBounds = padComparisonBounds(bounds);
    const slicePosition = panel.viewType === 'sagittal'
      ? crosshair[0]
      : panel.viewType === 'coronal'
        ? crosshair[1]
        : crosshair[2];

    return getViewPlaneService().createSliceViewPlane(
      panel.viewType,
      slicePosition,
      paddedBounds,
      [width, height]
    );
  }

  private async resolvePanelViewPlane(
    globalViewState: ViewState,
    panel: ComparisonPanelConfig,
    width: number,
    height: number,
    workspaceId?: string
  ): Promise<ViewPlane | { viewPlane: ViewPlane; crosshair: WorldCoordinates }> {
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
    const boundsSource: 'layer-metadata' | 'api' = metadata?.worldBounds ? 'layer-metadata' : 'api';
    const bounds = (await this.volumeBounds(primaryLayer.id, primaryLayer.volumeId)) ?? undefined;
    if (!bounds) {
      console.warn(
        `[ComparisonRenderService] No bounds for panel ${panel.id}; falling back to backend fit`
      );
    }

    const globalCrosshair = globalViewState.crosshair.world_mm;
    const boundsCenter = this.getBoundsCenter(bounds) ?? globalCrosshair;
    const crosshair = this.isPointInsideBounds(globalCrosshair, bounds)
      ? globalCrosshair
      : boundsCenter;

    if (bounds) {
      debug(`[ComparisonRenderService] fitting panel ${panel.id} from bounds`, {
        boundsSource,
        bounds,
        paddedBounds: padComparisonBounds(bounds),
        requestedSize: { width, height },
        globalCrosshair,
        sliceCrosshair: crosshair,
        viewType: panel.viewType,
        primaryLayer: {
          id: primaryLayer.id,
          volumeId: primaryLayer.volumeId,
        },
      });

      // Frame the outer voxel edges, not the outer voxel centres (native N1).
      const dims = metadata?.dimensions ?? (bounds as { dims?: number[] }).dims;
      // Every pane frames the same world box, so the panes share one scale
      // (QA 2026-10-30 F7: a small oblique image filled its pane while the
      // T1 pane showed the whole head).
      const own = widenToVoxelEdges(bounds, dims);
      let frame = own;
      if (workspaceId) {
        const ids = comparisonPaneLayerIds(globalViewState, useComparisonStore.getState().getPanels(workspaceId));
        const others = await Promise.all(ids.map((id) => this.layerEdgeBox(globalViewState, id)));
        frame = sharedComparisonFrame(own, others.filter((box): box is VolumeBounds => !!box));
      }
      const viewPlane = this.createBoundsFittedViewPlane(panel, frame, crosshair, width, height);
      return { viewPlane, crosshair };
    }

    try {
      const viewPlane = await this.apiService.recalculateViewForDimensions(
        primaryLayer.volumeId,
        panel.viewType,
        [width, height],
        crosshair
      );
      return { viewPlane, crosshair };
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
  async renderPanel(req: ComparisonRenderRequest): Promise<void> {
    const tag = comparisonTag(req.panel.id, req.panel.viewType);
    useRenderStateStore.getState().setRendering(tag, true);

    const workspaceViewState = useViewStateStore
      .getState()
      .getWorkspaceViewState(req.workspaceId);

    await this.renderSinglePanel(workspaceViewState, req);
  }

  async renderPanels(panels: ComparisonRenderRequest[]): Promise<void> {
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
        batch.map(req => {
          const workspaceViewState = useViewStateStore.getState().getWorkspaceViewState(req.workspaceId);
          return this.renderSinglePanel(workspaceViewState, req);
        })
      );
    }
  }

  /**
   * Render a single comparison panel.
   */
  private async renderSinglePanel(
    globalViewState: ViewState,
    { workspaceId, panel, width, height }: ComparisonRenderRequest
  ): Promise<void> {
    const tag = comparisonTag(panel.id, panel.viewType);
    const requestId = this.nextRequestId++;
    this.activeRenders.set(tag, requestId);

    try {
      const resolvedPanelView = await this.resolvePanelViewPlane(globalViewState, panel, width, height, workspaceId);
      const panelView = 'viewPlane' in resolvedPanelView
        ? resolvedPanelView.viewPlane
        : resolvedPanelView;
      const panelCrosshair = 'viewPlane' in resolvedPanelView
        ? resolvedPanelView.crosshair
        : globalViewState.crosshair.world_mm;

      if (this.activeRenders.get(tag) !== requestId) {
        return;
      }

      debug(`[ComparisonRenderService] resolved panel ${panel.id}`, {
        tag,
        requestSize: { width, height },
        viewType: panel.viewType,
        panelView: {
          origin_mm: panelView.origin_mm,
          u_mm: panelView.u_mm,
          v_mm: panelView.v_mm,
          dim_px: panelView.dim_px,
        },
        visibleLayerIds: Array.from(panel.visibleLayerIds),
      });

      useComparisonStore.getState().setPanelViewPlane(panel.id, panelView);
      const underlayLayerId = resolvePanelUnderlayId(panel, useLayerStore.getState().layers);
      const filteredState = this.buildPanelViewState(
        globalViewState,
        panel,
        panelView,
        panelCrosshair,
        underlayLayerId,
        linkModeOf(useComparisonStore.getState(), workspaceId)
      );

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
        debug(`[ComparisonRenderService] rendered panel ${panel.id}`, {
          tag,
          requestSize: { width, height },
          bitmapSize: {
            width: imageBitmap.width,
            height: imageBitmap.height,
          },
        });
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

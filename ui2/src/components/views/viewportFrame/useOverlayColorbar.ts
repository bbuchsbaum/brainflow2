import { useMemo } from 'react';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { activeVolumeLayerId, useActiveLayer } from '@/utils/activeLayer';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';
import type { ViewLayer } from '@/types/viewState';
import { shortLayerLabel, type FramePlane } from './frameFormat';
import { chooseColorbarHost, useViewportFrameStore } from './viewportFrameStore';
import type { VolumeMetadata } from '@/stores/layerStore';
import type { ColorbarLayer } from './ViewportColorbar';
import { isInferredStatistic, statisticUnits } from '@/utils/statistic';
import { runGroupIds } from '@/services/series/runWindow';

/**
 * Overlay classification, matching the Scene stack (`buildSceneStack`): the
 * first non-atlas volume is the base; other non-atlas volumes are overlays.
 */
export function isOverlayLayer(layers: readonly LayerInfo[], layerId: string): boolean {
  // Label maps count as atlases here, as in the Scene stack.
  const isAtlas = (l: LayerInfo) => l.source === 'atlas' || l.isLabelMap === true;
  const base = layers.find((l) => !isAtlas(l));
  const layer = layers.find((l) => l.id === layerId);
  return !!layer && !isAtlas(layer) && base?.id !== layerId;
}

/** Pure selection of the colorbar layer; null when none should be drawn. */
export function resolveColorbarLayer(
  layers: readonly LayerInfo[],
  selectedLayerId: string | null,
  viewLayer: ViewLayer | null | undefined,
  showColorbar: boolean,
  metadata?: VolumeMetadata | null,
  /** Exports may describe the base layer itself (a statistic loaded alone, native R2-4). */
  options: { allowBase?: boolean } = {},
): ColorbarLayer | null {
  if (!selectedLayerId || !viewLayer || !showColorbar) return null;
  if (!isOverlayLayer(layers, selectedLayerId) && !options.allowBase) return null;
  if (!viewLayer.visible || (viewLayer.layerMode ?? 'scalar') !== 'scalar') return null;
  if (!viewLayer.colormap || !viewLayer.intensity) return null;
  const info = layers.find((l) => l.id === selectedLayerId);
  const name = info?.name ?? viewLayer.name;
  return {
    layerId: selectedLayerId,
    name,
    colormap: viewLayer.colormap,
    intensity: viewLayer.intensity,
    threshold: viewLayer.threshold ?? [0, 0],
    dataRange: metadata?.dataRange ?? null,
    // Value units come from the header's statistic ("z", "t(24)");
    // VolumeMetadata.units is spatial. Nothing is guessed from the file name.
    units: statisticUnits(info?.statistic, metadata?.dataRange),
    unitsFromName: isInferredStatistic(info?.statistic),
    // One caption rule everywhere (Proposal C): "z · zmap_synthetic", so the
    // bar's identity never depends on selection or workspace.
    nameLabel: shortLayerLabel(name),
  };
}

/**
 * Which layer the view's colorbar describes: the selected layer when it is a
 * visible scalar overlay; otherwise (nothing, the base, an atlas or a hidden
 * layer selected) the topmost visible scalar overlay. `viewLayers` is in
 * composite order, so "topmost" is the last match.
 *
 * With no such overlay, a selected base that `baseHasColorbar` accepts is
 * described itself: runs of one acquisition are peers, so the focused run's
 * bar shows whether or not it happens to be the base (native R4-1).
 */
export function chooseColorbarLayerId(
  layers: readonly LayerInfo[],
  viewLayers: readonly ViewLayer[],
  selectedLayerId: string | null,
  baseHasColorbar: (layerId: string) => boolean = () => false,
): string | null {
  const scalarVisible = (l: ViewLayer | undefined): l is ViewLayer =>
    !!l && l.visible && (l.layerMode ?? 'scalar') === 'scalar';
  const eligible = (l: ViewLayer | undefined) => scalarVisible(l) && isOverlayLayer(layers, l.id);
  const selected = selectedLayerId ? viewLayers.find((l) => l.id === selectedLayerId) : undefined;
  if (selectedLayerId && eligible(selected)) {
    return selectedLayerId;
  }
  for (let i = viewLayers.length - 1; i >= 0; i -= 1) {
    if (eligible(viewLayers[i])) return viewLayers[i].id;
  }
  if (selectedLayerId && scalarVisible(selected) && baseHasColorbar(selectedLayerId)) {
    return selectedLayerId;
  }
  return null;
}

/** A base volume that is one run of several (its siblings are its peers). */
export function isRunGroupMember(layerId: string): boolean {
  return runGroupIds(layerId).length > 1;
}

/** Colorbar data for one layer of a workspace (null when it should not be drawn). */
export function useLayerColorbar(
  layerId: string | null,
  workspaceId?: string,
  options: { allowBase?: boolean } = {},
): ColorbarLayer | null {
  const allowBase = options.allowBase === true;
  const layers = useLayerStore((s) => s.layers);
  const viewLayer = useViewStateStore((s) => {
    if (!layerId) return undefined;
    const vs = workspaceId ? s.getWorkspaceViewState(workspaceId) : s.viewState;
    return vs.layers.find((l) => l.id === layerId);
  });
  const showColorbar = useDisplayOptionsStore((s) =>
    layerId ? s.options.get(layerId)?.showColorbar !== false : true,
  );
  const metadata = useLayerStore((s) => (layerId ? s.layerMetadata.get(layerId) : undefined));
  return useMemo(
    () => resolveColorbarLayer(layers, layerId, viewLayer, showColorbar, metadata, { allowBase }),
    [layers, layerId, viewLayer, showColorbar, metadata, allowBase],
  );
}

/**
 * The orthogonal views' colorbar (active workspace): the active layer when it
 * is an overlay, else the topmost visible overlay, else the active base when
 * it is one of several runs. The caption always names the layer (see
 * `resolveColorbarLayer`).
 */
export function useOverlayColorbar(): ColorbarLayer | null {
  const layers = useLayerStore((s) => s.layers);
  const viewLayers = useViewStateStore((s) => s.viewState.layers);
  // Same active layer as the header and the status bar (utils/activeLayer).
  const activeLayerId = useActiveLayer(viewLayers)?.id ?? null;
  const layerId = useMemo(
    () => chooseColorbarLayerId(layers, viewLayers, activeLayerId, isRunGroupMember),
    [layers, viewLayers, activeLayerId],
  );
  const isBase = !!layerId && !isOverlayLayer(layers, layerId);
  return useLayerColorbar(layerId, undefined, { allowBase: isBase });
}

/**
 * The layer {@link useOverlayColorbar} shows, read from the stores outside
 * React (the view context menu's "Hide colorbar"): the same inputs, the
 * active layer and the run-group rule, so the menu toggles the colorbar on
 * screen.
 */
export function currentOverlayColorbarLayerId(): string | null {
  const layers = useLayerStore.getState().layers;
  const viewLayers = useViewStateStore.getState().viewState.layers;
  return chooseColorbarLayerId(layers, viewLayers, activeVolumeLayerId(viewLayers), isRunGroupMember);
}

/** Which orthogonal view hosts the colorbar (see `chooseColorbarHost`). */
export function useColorbarHostPlane(): FramePlane | null {
  return useViewportFrameStore((s) => chooseColorbarHost(s.slots));
}

import { useMemo } from 'react';
import { useLayerStore, type LayerInfo } from '@/stores/layerStore';
import { useActiveLayer } from '@/utils/activeLayer';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useDisplayOptionsStore } from '@/stores/displayOptionsStore';
import type { ViewLayer } from '@/types/viewState';
import { shortLayerLabel, type FramePlane } from './frameFormat';
import { chooseColorbarHost, useViewportFrameStore } from './viewportFrameStore';
import type { VolumeMetadata } from '@/stores/layerStore';
import type { ColorbarLayer } from './ViewportColorbar';
import { statisticUnits } from '@/utils/statistic';

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
): ColorbarLayer | null {
  if (!selectedLayerId || !viewLayer || !showColorbar) return null;
  if (!isOverlayLayer(layers, selectedLayerId)) return null;
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
 */
export function chooseColorbarLayerId(
  layers: readonly LayerInfo[],
  viewLayers: readonly ViewLayer[],
  selectedLayerId: string | null,
): string | null {
  const eligible = (l: ViewLayer | undefined) =>
    !!l &&
    l.visible &&
    (l.layerMode ?? 'scalar') === 'scalar' &&
    isOverlayLayer(layers, l.id);
  if (selectedLayerId && eligible(viewLayers.find((l) => l.id === selectedLayerId))) {
    return selectedLayerId;
  }
  for (let i = viewLayers.length - 1; i >= 0; i -= 1) {
    if (eligible(viewLayers[i])) return viewLayers[i].id;
  }
  return null;
}

/** Colorbar data for one layer of a workspace (null when it should not be drawn). */
export function useLayerColorbar(
  layerId: string | null,
  workspaceId?: string,
): ColorbarLayer | null {
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
    () => resolveColorbarLayer(layers, layerId, viewLayer, showColorbar, metadata),
    [layers, layerId, viewLayer, showColorbar, metadata],
  );
}

/**
 * The orthogonal views' colorbar (active workspace): the active layer when it
 * is an overlay, else the topmost visible overlay. The caption always names
 * the layer (see `resolveColorbarLayer`).
 */
export function useOverlayColorbar(): ColorbarLayer | null {
  const layers = useLayerStore((s) => s.layers);
  const viewLayers = useViewStateStore((s) => s.viewState.layers);
  // Same active layer as the header and the status bar (utils/activeLayer).
  const activeLayerId = useActiveLayer(viewLayers)?.id ?? null;
  const layerId = useMemo(
    () => chooseColorbarLayerId(layers, viewLayers, activeLayerId),
    [layers, viewLayers, activeLayerId],
  );
  return useLayerColorbar(layerId);
}

/** Which orthogonal view hosts the colorbar (see `chooseColorbarHost`). */
export function useColorbarHostPlane(): FramePlane | null {
  return useViewportFrameStore((s) => chooseColorbarHost(s.slots));
}

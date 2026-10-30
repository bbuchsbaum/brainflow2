import { useMemo } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import type { SceneItemKind } from '@/types/sceneItem';

type ViewLayerLike = { id: string; name?: string; visible: boolean };

/**
 * The two selection sources behind "the active layer".
 *
 * - `inspectorLayerId`: the Inspector's active scene item when it is a volume
 *   (volume scene items use the layer id as their item id), else null.
 * - `selectedLayerId`: `layerStore.selectedLayerId`.
 */
export interface ActiveLayerSelection {
  inspectorLayerId: string | null;
  selectedLayerId: string | null;
}

const VOLUME_KINDS: ReadonlySet<SceneItemKind> = new Set([
  'volume-base',
  'volume-overlay',
  'volume-overlay-atlas',
]);

/** The Inspector item's layer id when the item is a volume layer. */
export function inspectorVolumeLayerId(
  activeItemId: string | null | undefined,
  activeItemKind: SceneItemKind | null | undefined,
): string | null {
  if (!activeItemId || !activeItemKind) return null;
  return VOLUME_KINDS.has(activeItemKind) ? activeItemId : null;
}

/**
 * THE active-layer rule. Every consumer (viewport header name, colorbar
 * layer choice, status-bar Layer and Value slots) goes through this function,
 * so they always name and sample the same layer:
 *
 *   1. the Inspector's active scene item, if it is a volume layer in the view;
 *   2. else `layerStore.selectedLayerId`, if it is in the view;
 *   3. else the topmost visible layer.
 *
 * `viewLayers` is in composite order (index 0 is the base, drawn first), so
 * the topmost visible layer is the LAST visible entry.
 */
export function resolveActiveLayer<T extends ViewLayerLike>(
  viewLayers: ReadonlyArray<T>,
  selection: ActiveLayerSelection | string | null | undefined,
): T | null {
  const sel: ActiveLayerSelection =
    selection && typeof selection === 'object'
      ? selection
      : { inspectorLayerId: null, selectedLayerId: selection ?? null };
  for (const id of [sel.inspectorLayerId, sel.selectedLayerId]) {
    if (!id) continue;
    const hit = viewLayers.find((l) => l.id === id);
    if (hit) return hit;
  }
  for (let i = viewLayers.length - 1; i >= 0; i -= 1) {
    if (viewLayers[i].visible) return viewLayers[i];
  }
  return null;
}

export function resolveActiveLayerName(
  viewLayers: ReadonlyArray<ViewLayerLike>,
  selection: ActiveLayerSelection | string | null | undefined,
): string | null {
  const layer = resolveActiveLayer(viewLayers, selection);
  return layer ? layer.name || layer.id : null;
}

/** Live selection sources (primitive selectors only: stable). */
export function useActiveLayerSelection(): ActiveLayerSelection {
  const activeItemId = useInspectorSelectionStore((s) => s.activeItemId);
  const activeItemKind = useInspectorSelectionStore((s) => s.activeItemKind);
  const selectedLayerId = useLayerStore((s) => s.selectedLayerId);
  return useMemo(
    () => ({
      inspectorLayerId: inspectorVolumeLayerId(activeItemId, activeItemKind),
      selectedLayerId,
    }),
    [activeItemId, activeItemKind, selectedLayerId],
  );
}

/** The active layer of `viewLayers` under the single rule above. */
export function useActiveLayer<T extends ViewLayerLike>(viewLayers: ReadonlyArray<T>): T | null {
  const selection = useActiveLayerSelection();
  return useMemo(() => resolveActiveLayer(viewLayers, selection), [viewLayers, selection]);
}

/**
 * The active layer's id read from the stores outside React (commands, menus):
 * the same rule as `useActiveLayer` over the given (active workspace) view layers.
 */
export function activeVolumeLayerId(viewLayers: ReadonlyArray<ViewLayerLike>): string | null {
  const { activeItemId, activeItemKind } = useInspectorSelectionStore.getState();
  const selection: ActiveLayerSelection = {
    inspectorLayerId: inspectorVolumeLayerId(activeItemId, activeItemKind),
    selectedLayerId: useLayerStore.getState().selectedLayerId,
  };
  return resolveActiveLayer(viewLayers, selection)?.id ?? null;
}

/**
 * The status bar's layer: the single active-layer rule (`resolveActiveLayer`,
 * shared with the viewport header and the colorbar), unless a Compare panel
 * has claimed the readout (pointer over it, or last focused): then that
 * panel's layer, so the status bar and the pane never disagree.
 */
export function resolveStatusLayer<T extends ViewLayerLike>(
  viewLayers: ReadonlyArray<T>,
  selection: ActiveLayerSelection,
  override: { layerId: string; name: string } | null,
): { id: string; name: string } | null {
  if (override) return { id: override.layerId, name: override.name };
  const layer = resolveActiveLayer(viewLayers, selection);
  return layer ? { id: layer.id, name: layer.name || layer.id } : null;
}

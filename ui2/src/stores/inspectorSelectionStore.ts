import { create } from 'zustand';
import { useLayerStore } from '@/stores/layerStore';
import { useSurfaceStore } from '@/stores/surfaceStore';
import { collectRenderSurfaces } from '@/components/views/surfaceRenderSurfaces';
import type { SceneItem, SceneItemKind } from '@/types/sceneItem';
import { volumeSceneItemKind } from '@/utils/sceneItemKind';

interface InspectorSelectionState {
  activeItemId: string | null;
  activeItemKind: SceneItemKind | null;

  /**
   * Select a scene item from the unified Inspector. For volume-kind items
   * this also mirrors the selection into `layerStore.selectedLayerId` so any
   * legacy code reading the per-store selection stays in sync.
   *
   * Surface items are mirrored one way into surfaceStore's per-view selection
   * (see `mirrorSurfaceSelection`): every surface view drawing the surface
   * selects it, so a view's camera presets aim at the hemisphere the user
   * picked (run 6 N35: rh row under Medial). Nothing writes back from
   * surfaceStore to this store, so the mirror cannot loop; the inspector
   * itself still reads `inspectorSelectionStore` only.
   */
  setActive: (item: SceneItem | null) => void;

  /** Clear the inspector's active item. */
  clear: () => void;
}

export const useInspectorSelectionStore = create<InspectorSelectionState>((set) => ({
  activeItemId: null,
  activeItemKind: null,

  setActive: (item) => {
    if (!item) {
      set({ activeItemId: null, activeItemKind: null });
      return;
    }

    set({ activeItemId: item.id, activeItemKind: item.kind });

    if (item.ref.type === 'volume') {
      useLayerStore.getState().selectLayer(item.ref.layerId);
    } else if (item.ref.type === 'surface-geometry') {
      mirrorSurfaceSelection(item.ref.surfaceId, null);
    } else if (item.ref.type === 'surface-overlay') {
      mirrorSurfaceSelection(item.ref.surfaceId, item.ref.surfaceLayerId);
    }
  },

  clear: () => set({ activeItemId: null, activeItemKind: null }),
}));

/**
 * Select a surface (or one of its data layers) in every surface view that
 * draws it. A view's render anchor (the tab's bound surface, which decides
 * pairing and tab identity) is unchanged; only its selection moves. When no
 * view draws the surface (hidden, or no surface tab), only the compatibility
 * selection follows.
 */
function mirrorSurfaceSelection(surfaceId: string, surfaceLayerId: string | null): void {
  // Guarded: some unit tests mock `surfaceStore` without a real store.
  const store = (useSurfaceStore as { getState?: typeof useSurfaceStore.getState }).getState?.();
  if (!store?.surfaces?.has(surfaceId)) return;
  const itemType = surfaceLayerId ? 'dataLayer' : 'geometry';
  const viewIds = Array.from(store.surfaceViewHandles.entries())
    .filter(([, anchor]) =>
      collectRenderSurfaces(store.surfaces, anchor, null, anchor).some(
        (surface) => surface.handle === surfaceId,
      ),
    )
    .map(([viewId]) => viewId);
  if (viewIds.length === 0) {
    store.setCompatibilitySelection(surfaceId, itemType, surfaceLayerId);
    return;
  }
  for (const viewId of viewIds) {
    useSurfaceStore.getState().setSurfaceSelectionForView(viewId, surfaceId, itemType, surfaceLayerId);
  }
}

const VOLUME_ITEM_KINDS: ReadonlySet<SceneItemKind> = new Set([
  'volume-base',
  'volume-overlay',
  'volume-overlay-atlas',
]);

/**
 * Keep the two selections in lockstep (one active-layer rule, see
 * `utils/activeLayer`). When the Inspector shows a volume layer and the layer
 * store's selection moves to another layer (Studio "show", "Open in dock",
 * surface mapping controls, layer removal), the Inspector follows; when the
 * layer selection is cleared, a volume Inspector item is cleared with it.
 * Surface / mapping items and an empty Inspector are left alone, so a silent
 * first-load auto-select never opens an Inspector section by itself.
 */
export function syncInspectorWithLayerSelection(selectedLayerId: string | null): void {
  const { activeItemId, activeItemKind } = useInspectorSelectionStore.getState();
  if (!activeItemId || !activeItemKind || !VOLUME_ITEM_KINDS.has(activeItemKind)) return;
  if (activeItemId === selectedLayerId) return;
  if (!selectedLayerId) {
    useInspectorSelectionStore.setState({ activeItemId: null, activeItemKind: null });
    return;
  }
  // Same base/overlay/atlas classification as the Scene stack.
  const kind = volumeSceneItemKind(useLayerStore.getState().layers, selectedLayerId);
  if (!kind) return;
  useInspectorSelectionStore.setState({ activeItemId: selectedLayerId, activeItemKind: kind });
}

/**
 * Select a volume layer in both selections, opening its Inspector item even
 * when the Inspector was empty (a newly opened layer, the neighbour of a
 * removed one). Unknown ids are ignored.
 */
export function focusVolumeLayer(layerId: string): void {
  const kind = volumeSceneItemKind(useLayerStore.getState().layers, layerId);
  if (!kind) return;
  useInspectorSelectionStore.setState({ activeItemId: layerId, activeItemKind: kind });
  useLayerStore.getState().selectLayer(layerId);
}

// Guarded: some unit tests mock `layerStore` without a real store.
if (typeof (useLayerStore as { subscribe?: unknown } | undefined)?.subscribe === 'function') {
  useLayerStore.subscribe((state, prev) => {
    if (state.selectedLayerId !== prev.selectedLayerId) {
      syncInspectorWithLayerSelection(state.selectedLayerId);
    }
  });
}

export function useActiveSceneItemId(): string | null {
  return useInspectorSelectionStore((state) => state.activeItemId);
}

export function useActiveSceneItemKind(): SceneItemKind | null {
  return useInspectorSelectionStore((state) => state.activeItemKind);
}

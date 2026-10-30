import { create } from 'zustand';
import { useLayerStore } from '@/stores/layerStore';
import type { SceneItem, SceneItemKind } from '@/types/sceneItem';
import { volumeSceneItemKind } from '@/utils/sceneItemKind';

interface InspectorSelectionState {
  activeItemId: string | null;
  activeItemKind: SceneItemKind | null;

  /**
   * Select a scene item from the unified Inspector. For volume-kind items
   * this also mirrors the selection into `layerStore.selectedLayerId` so any
   * legacy code reading the per-store selection stays in sync. Surface
   * selection bridging is intentionally NOT mirrored: the existing
   * surfaceStore selection is per-view (keyed by surfaceViewId) and lives
   * in a different abstraction layer; the inspector consumes
   * `inspectorSelectionStore` directly.
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
    }
  },

  clear: () => set({ activeItemId: null, activeItemKind: null }),
}));

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

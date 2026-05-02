import { create } from 'zustand';
import { useLayerStore } from '@/stores/layerStore';
import type { SceneItem, SceneItemKind } from '@/types/sceneItem';

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

export function useActiveSceneItemId(): string | null {
  return useInspectorSelectionStore((state) => state.activeItemId);
}

export function useActiveSceneItemKind(): SceneItemKind | null {
  return useInspectorSelectionStore((state) => state.activeItemKind);
}

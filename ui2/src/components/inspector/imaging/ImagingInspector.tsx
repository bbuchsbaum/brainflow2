import React from 'react';
import { useSceneStack } from '@/hooks/useSceneStack';
import { useInspectorSelectionStore } from '@/stores/inspectorSelectionStore';
import type { SceneItem } from '@/types/sceneItem';
import { SceneStack } from './SceneStack';
import { SectionRouter } from './SectionRouter';

/**
 * Imaging Inspector body. Mounted by `InspectorRouter` for orthogonal /
 * integrated / mosaic / compare workspaces. Layout:
 *
 *   ┌─ Scene Stack (Volume View / Surface View / Mappings — empty groups hidden)
 *   └─ SectionRouter for the selected item (Render / Data / Geometry / Mapping / …)
 *
 * The Scene row's selected-state ring already conveys "this is the active
 * item" — there is intentionally no separate `SelectedItemHeader` block.
 */
export function ImagingInspector() {
  const stack = useSceneStack();
  const activeItemId = useInspectorSelectionStore((state) => state.activeItemId);

  const activeItem: SceneItem | null = React.useMemo(() => {
    if (!activeItemId) return null;
    return (
      stack.volumes.find((i) => i.id === activeItemId) ??
      stack.surfaces.find((i) => i.id === activeItemId) ??
      stack.mappings.find((i) => i.id === activeItemId) ??
      null
    );
  }, [activeItemId, stack]);

  return (
    <div className="flex flex-col">
      <SceneStack />
      {activeItem ? <SectionRouter item={activeItem} /> : <NoSelectionHint />}
    </div>
  );
}

function NoSelectionHint() {
  return (
    <div className="border-t border-border/60 px-3 py-6 text-center text-[11px] text-muted-foreground/80">
      Select a scene item above to edit its render, data, or mapping settings.
    </div>
  );
}

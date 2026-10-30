import { useEffect, useId } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useAppModeStore } from '@/stores/appModeStore';
import { findLayerIdForSourcePath } from '@/services/studio/StudioDisplayService';
import {
  clearRenderLayerScope,
  setRenderLayerScope,
} from '@/services/render/RenderLayerScope';

/**
 * While mounted, enabled and the Studio is the active mode, the orthogonal
 * views draw only the layer loaded from `sourcePath` (nothing until it
 * loads), so a Studio view shows its member rather than the workspace scene
 * (QA rerun §2). A Studio tab left mounted behind another workspace tab
 * hands the views back.
 */
export function useStudioMemberRenderScope(
  sourcePath: string | null | undefined,
  enabled: boolean,
): void {
  const owner = `studio-member:${useId()}`;
  const layerId = useLayerStore((state) => findLayerIdForSourcePath(state, sourcePath));
  const studioActive = useAppModeStore((state) => state.mode === 'studio');
  const scoped = enabled && studioActive;

  useEffect(() => {
    if (scoped) {
      setRenderLayerScope(owner, layerId ? [layerId] : []);
    } else {
      clearRenderLayerScope(owner);
    }
  }, [scoped, layerId, owner]);

  // Clear only on unmount: clearing between members would flash the
  // workspace scene before the next member is drawn.
  useEffect(() => () => clearRenderLayerScope(owner), [owner]);
}

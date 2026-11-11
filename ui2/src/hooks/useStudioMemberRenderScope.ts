import { useEffect, useId } from 'react';
import { useAppModeStore } from '@/stores/appModeStore';
import { useStudioLayerId } from './useStudioLayerId';
import {
  clearRenderLayerScope,
  setRenderLayerScope,
} from '@/services/render/RenderLayerScope';

/**
 * While mounted, enabled and the Studio is the active mode, the orthogonal
 * views draw only the layer loaded from `sourcePath` (nothing until it
 * loads), so a Studio view shows its member rather than the workspace scene
 * (QA rerun §2). With a background, the layer loaded from
 * `backgroundSourcePath` is drawn beneath the member, and stays drawn while
 * the next member loads. A Studio tab left mounted behind another workspace
 * tab hands the views back.
 */
export function useStudioMemberRenderScope(
  sourcePath: string | null | undefined,
  enabled: boolean,
  backgroundSourcePath?: string | null,
): void {
  const owner = `studio-member:${useId()}`;
  // Layers of the active view only: the scope cannot draw any other.
  const layerId = useStudioLayerId(sourcePath);
  const backgroundLayerId = useStudioLayerId(backgroundSourcePath);
  const studioActive = useAppModeStore((state) => state.mode === 'studio');
  const scoped = enabled && studioActive;

  useEffect(() => {
    if (scoped) {
      // Bottom first: the scope draws in this order, not the workspace's.
      setRenderLayerScope(
        owner,
        [backgroundLayerId, layerId].filter((id): id is string => !!id),
      );
    } else {
      clearRenderLayerScope(owner);
    }
  }, [scoped, layerId, backgroundLayerId, owner]);

  // Clear only on unmount: clearing between members would flash the
  // workspace scene before the next member is drawn.
  useEffect(() => () => clearRenderLayerScope(owner), [owner]);
}

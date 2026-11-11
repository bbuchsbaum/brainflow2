import { useMemo } from 'react';
import { getStudioDisplayService } from '@/services/studio/StudioDisplayService';
import type { StudioMapWindow } from '@/services/studio/studioMapDisplay';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useStudioLayerId } from './useStudioLayerId';

/**
 * The display of the member loaded from `sourcePath` in the Studio's view,
 * when it is a map the Studio draws by its rule (a layer the Studio loaded,
 * not anatomy); else null. The group mean beside the member in Compare takes
 * this display, so one colour is one value in both panes: the Studio's
 * default, or whatever the user set for the member in the Inspector.
 */
export function useStudioMemberMapDisplay(
  sourcePath: string | null | undefined,
  workspaceId: string | null | undefined,
): StudioMapWindow | null {
  const layerId = useStudioLayerId(sourcePath);
  // One string: a primitive, stable while the display is.
  const key = useViewStateStore((state) => {
    if (!layerId || !workspaceId) return null;
    const layer = state.getWorkspaceViewState(workspaceId).layers.find((l) => l.id === layerId);
    if (!layer?.intensity || !layer.threshold || !layer.colormap) return null;
    if ((layer.layerMode ?? 'scalar') !== 'scalar') return null;
    // Read with the display it follows: the Studio marks the layer its own
    // before it writes the display.
    if (!getStudioDisplayService().isStudioMap(layerId)) return null;
    return JSON.stringify([layer.colormap, layer.intensity, layer.threshold]);
  });
  return useMemo(() => {
    if (!key) return null;
    const [colormap, intensity, threshold] = JSON.parse(key) as [
      string,
      [number, number],
      [number, number],
    ];
    return { colormap, intensity, threshold };
  }, [key]);
}

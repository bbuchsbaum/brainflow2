/**
 * Which source the Series mode shows (phase 4 E5): the active 4D layer at the
 * crosshair, or the active Set Studio dataset's lag / time series. The
 * dataset's series belongs to the Studio: leaving it for another workspace
 * takes the Studio series out of the Plot dock (QA F11). "Auto" in the Studio
 * shows the dataset when both exist.
 */
import { useSetStudioStore } from '@/stores/setStudioStore';
import { useSeriesStore, type SeriesSourceChoice } from '@/stores/seriesStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { activeSetSeriesBinding } from '@/services/series/sampleSetSeries';
import { isLayerFourD } from './crosshairTimeSeriesPlot.helpers';

export function resolveSeriesSource(
  choice: SeriesSourceChoice,
  available: { layer: boolean; set: boolean },
  inStudio: boolean,
): 'layer' | 'set' | null {
  if (choice === 'layer' && available.layer) return 'layer';
  if (choice === 'set' && available.set) return 'set';
  if (available.layer && available.set) return inStudio ? 'set' : 'layer';
  return available.set ? 'set' : available.layer ? 'layer' : null;
}

/** Whether the active workspace is the Set Studio (non-reactive read). */
export function isStudioWorkspaceActive(): boolean {
  return useWorkspaceStore.getState().getActiveWorkspace?.()?.type === 'set-studio';
}

/**
 * True when the Set Studio is the active workspace and its dataset declares a
 * lag / time axis (non-reactive read).
 */
export function hasSetSeries(): boolean {
  return (
    isStudioWorkspaceActive() && activeSetSeriesBinding(useSetStudioStore.getState()) !== null
  );
}

/** The source the Series mode shows now, and what is available. */
export function useSeriesSource(layerId: string | undefined) {
  const choice = useSeriesStore((s) => s.source);
  const binding = useSetStudioStore((s) => activeSetSeriesBinding(s) !== null);
  const inStudio = useWorkspaceStore((s) => s.getActiveWorkspace?.()?.type === 'set-studio');
  const set = binding && inStudio;
  const layer = isLayerFourD(layerId);
  return { source: resolveSeriesSource(choice, { layer, set }, inStudio), available: { layer, set } };
}

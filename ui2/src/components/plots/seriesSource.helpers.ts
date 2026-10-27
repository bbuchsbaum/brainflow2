/**
 * Which source the Series mode shows (phase 4 E5): the active 4D layer at the
 * crosshair, or the active Set Studio dataset's lag / time series. "Auto"
 * follows the workspace: the dataset in Set Studio, the 4D layer elsewhere,
 * whichever exists otherwise.
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

/** True when the active dataset declares a lag / time axis (non-reactive read). */
export function hasSetSeries(): boolean {
  return activeSetSeriesBinding(useSetStudioStore.getState()) !== null;
}

/** The source the Series mode shows now, and what is available. */
export function useSeriesSource(layerId: string | undefined) {
  const choice = useSeriesStore((s) => s.source);
  const set = useSetStudioStore((s) => activeSetSeriesBinding(s) !== null);
  const inStudio = useWorkspaceStore((s) => s.getActiveWorkspace?.()?.type === 'set-studio');
  const layer = isLayerFourD(layerId);
  return { source: resolveSeriesSource(choice, { layer, set }, inStudio), available: { layer, set } };
}

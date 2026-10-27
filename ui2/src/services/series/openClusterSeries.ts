/**
 * "Series for this cluster" (phase 4 E3): the selected cluster row becomes the
 * Series locus (its cluster-id label volume region), shown in the Plot dock's
 * Series mode, over the dataset's lag / time series, else a loaded 4D layer.
 */
import { openDockTab } from '@/components/layout/openDockTab';
import { useClusterStore } from '@/stores/clusterStore';
import { useLayerStore } from '@/stores/layerStore';
import { usePlotModeStore } from '@/stores/plotModeStore';
import { useSeriesStore } from '@/stores/seriesStore';
import { useSetStudioStore } from '@/stores/setStudioStore';
import { activeSetSeriesBinding } from './sampleSetSeries';

/** The series mode's id (kept from the Phase 4c time-series mode). */
const SERIES_MODE_ID = 'crosshair-time-series';

/** A loaded 4D layer (the first one), for a cluster series without a dataset. */
function fourDLayerId(): string | null {
  const layer = useLayerStore
    .getState()
    .layers.find((l) => ((l as { timeSeriesInfo?: { num_timepoints: number } }).timeSeriesInfo?.num_timepoints ?? 0) >= 2);
  return layer?.id ?? null;
}

/** Why a cluster series cannot be shown now, or null when it can. */
export function clusterSeriesUnavailable(): string | null {
  const { result, selectedId } = useClusterStore.getState();
  if (!result || selectedId === null) return 'Select a cluster row.';
  if (!result.table.labelVolumeId) return 'Compute the table again to use its clusters as regions.';
  if (!activeSetSeriesBinding(useSetStudioStore.getState()) && !fourDLayerId())
    return 'Needs a dataset with a lag or time axis, or a 4D layer.';
  return null;
}

export function openClusterSeries(): void {
  if (clusterSeriesUnavailable()) return;
  const dataset = activeSetSeriesBinding(useSetStudioStore.getState()) !== null;
  useSeriesStore.getState().update({ locus: 'cluster', source: dataset ? 'set' : 'layer' });
  if (!dataset) {
    const id = fourDLayerId();
    if (id) useLayerStore.getState().selectLayer?.(id);
  }
  openDockTab('plot');
  usePlotModeStore.getState().setActivePlotMode(SERIES_MODE_ID);
}

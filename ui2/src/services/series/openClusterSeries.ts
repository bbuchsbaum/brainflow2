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

const isFourD = (l: unknown) => ((l as { timeSeriesInfo?: { num_timepoints: number } }).timeSeriesInfo?.num_timepoints ?? 0) >= 2;

/**
 * The 4D layer for a cluster series without a dataset: the selected layer
 * when it is 4D (another run, another subject; review m14), else the first.
 */
function fourDLayerId(): string | null {
  const { layers, selectedLayerId } = useLayerStore.getState();
  const selected = layers.find((l) => l.id === selectedLayerId);
  if (selected && isFourD(selected)) return selected.id;
  return layers.find(isFourD)?.id ?? null;
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
  // Keyboard focus follows the user into the plot (round 3 S3), never <body>.
  const from = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  openDockTab('plot');
  usePlotModeStore.getState().setActivePlotMode(SERIES_MODE_ID);
  focusSeriesPlot(from);
}

/** The Series plot's values (its roving tab stop), else its first control. */
const SERIES_FOCUS = [
  '[data-testid="set-series-plot"] [data-datum-id][tabindex="0"]',
  '[data-testid="crosshair-ts-plot-body"] [data-datum-id][tabindex="0"]',
  '[data-testid="set-series-plot"] button:not([disabled])',
  '[data-testid="crosshair-ts-plot-body"] button:not([disabled])',
];

/**
 * Move focus to the Series plot once it has mounted and sampled (a few
 * frames, up to ~1 s); if it never appears, return focus to where it was
 * when focus fell to <body> (the clicked button may unmount with the tab).
 */
function focusSeriesPlot(from: HTMLElement | null): void {
  if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
  let tries = 0;
  const attempt = () => {
    tries += 1;
    const target = SERIES_FOCUS.map((sel) => document.querySelector<HTMLElement>(sel)).find(Boolean);
    // A datum stop appears after sampling: wait for it a while before settling for a control.
    if (target && (target.hasAttribute('data-datum-id') || tries > 30)) {
      target.focus();
      return;
    }
    if (tries < 60) {
      requestAnimationFrame(attempt);
      return;
    }
    if (target) target.focus();
    else if ((!document.activeElement || document.activeElement === document.body) && from?.isConnected) from.focus();
  };
  requestAnimationFrame(attempt);
}

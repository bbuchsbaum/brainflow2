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
import { getClusterService, clusterTableCsv } from '@/services/ClusterService';
import { statisticUnits } from '@/utils/statistic';
import { isRegionSource } from '@/services/atlasRegionLookup';

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

/** A table without its cluster-id label volume (one computed on load): "Use as region" computes it again. */
export const LABEL_REASON = 'Compute the table again to use its clusters as regions.';

/** Why there is nothing to show a series over (no dataset with a lag/time axis, no 4D layer). */
function seriesSourceUnavailable(): string | null {
  if (!activeSetSeriesBinding(useSetStudioStore.getState()) && !fourDLayerId())
    return 'Needs a dataset with a lag or time axis, or a 4D layer.';
  return null;
}

/** Why a cluster series cannot be shown now, or null when it can. */
export function clusterSeriesUnavailable(): string | null {
  const { result, selectedId } = useClusterStore.getState();
  if (!result || selectedId === null) return 'Select a cluster row.';
  if (!result.table.labelVolumeId) return LABEL_REASON;
  return seriesSourceUnavailable();
}

/**
 * Why "Use cluster as region" cannot run now (`clusterId`: the row it is
 * for, else the selected one). A missing label volume is not a reason (it is
 * computed again), but a missing series source is, before anything is
 * recomputed (review of F5.4, M2).
 */
export function clusterRegionUnavailable(clusterId?: number | null): string | null {
  const { result, selectedId } = useClusterStore.getState();
  if (!result) return 'Compute clusters first.';
  if ((clusterId ?? selectedId) === null) return 'Select a cluster row.';
  return seriesSourceUnavailable();
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

/**
 * Why a label legend region cannot be the Series region now (the Regions row
 * menu, QA run 5 N25), or null when it can.
 */
export function regionSeriesUnavailable(layerId: string): string | null {
  const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
  if (!layer || !isRegionSource(layer)) return 'This layer has no named regions.';
  return seriesSourceUnavailable();
}

/**
 * "Use as series region": the legend region (`labelId` of the label layer
 * `layerId`) becomes the Series region, shown in the Plot dock's Series mode.
 */
export function openRegionSeries(layerId: string, labelId: number): void {
  if (regionSeriesUnavailable(layerId)) return;
  const dataset = activeSetSeriesBinding(useSetStudioStore.getState()) !== null;
  useSeriesStore.getState().update({
    locus: 'region',
    regionPick: { layerId, labelId },
    source: dataset ? 'set' : 'layer',
  });
  if (!dataset) {
    const id = fourDLayerId();
    if (id) useLayerStore.getState().selectLayer?.(id);
  }
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

/**
 * "Use cluster as region" (QA 2026-10-31 F5.4): the cluster row (the selected
 * one, or `clusterId`) becomes the Series region. A table without its
 * cluster-id label volume (one computed on load, which never makes one) is
 * computed again with the same parameters first; the row ids are the same.
 * Rejects with the reason when it cannot (⌘K shows it).
 */
export async function openClusterAsRegion(clusterId?: number): Promise<void> {
  const reason = clusterRegionUnavailable(clusterId);
  if (reason) throw new Error(reason);
  const store = useClusterStore.getState();
  const result = store.result!;
  const id = (clusterId ?? store.selectedId)!;
  if (!result.table.labelVolumeId) {
    const layerId = result.layerId;
    const t = result.table;
    const mask = t.searchVolume?.kind === 'mask' ? t.searchVolume.maskVolumeId : null;
    const table = await getClusterService().compute({
      layerId: result.layerId,
      threshold: t.threshold,
      negativeThreshold: t.negativeThreshold ?? null,
      sign: t.sign,
      connectivity: t.connectivity as 6 | 18 | 26,
      minVoxels: t.minVoxels,
      extent: t.extentInference
        ? {
            fwhmMm: t.extentInference.fwhmMm,
            // A statistic the table's request declared (one inferred from the file name).
            statistic: t.extentInference.statisticSource === 'request' ? t.extentInference.statistic : null,
          }
        : null,
      ...(mask ? { searchMask: mask } : {}),
    });
    // Superseded, failed, or another table (another layer) published meanwhile:
    // never select a row of a table this was not about (review M1).
    const now = useClusterStore.getState();
    if (!table) throw new Error(now.status === 'error' && now.error ? now.error : 'The table changed.');
    if (now.result?.table !== table || now.result.layerId !== layerId) throw new Error('The table changed.');
    if (!table.labelVolumeId) throw new Error('The clusters could not be made regions.');
  }
  useClusterStore.getState().select(id);
  const blocked = clusterSeriesUnavailable();
  if (blocked) throw new Error(blocked);
  openClusterSeries();
}

/** One cluster row as CSV (header + row, ASCII), for "Copy row". */
export function clusterRowCsv(clusterId: number): string | null {
  const result = useClusterStore.getState().result;
  const index = result?.table.clusters.findIndex((c) => c.id === clusterId) ?? -1;
  if (!result || index < 0) return null;
  const layer = useLayerStore.getState().layers.find((l) => l.id === result.layerId);
  const csv = clusterTableCsv(
    { ...result.table, clusters: [result.table.clusters[index]] },
    [result.regions[index] ?? null],
    {
      layerName: result.layerName,
      maskName: result.maskName ?? null,
      symbol: statisticUnits(layer?.statistic, useLayerStore.getState().layerMetadata.get(result.layerId)?.dataRange),
    },
    [result.subPeakRegions?.[index] ?? []],
  );
  // The row without the methods comment lines (they describe the whole table).
  return csv
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n');
}

/** The ⌘K command for {@link openClusterAsRegion} (App's command palette). */
export const CLUSTER_AS_REGION_COMMAND = {
  id: 'statistics.clusterAsRegion',
  title: 'Use Cluster as Region',
  subtitle: 'Use the selected cluster row as the Series region (clusters as regions).',
  keywords: ['clusters', 'regions', 'region', 'series', 'roi', 'statistics'],
  group: 'Statistics',
  run: () => openClusterAsRegion(),
};

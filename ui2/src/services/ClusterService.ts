/**
 * ClusterService (UI redesign phase 3, item 5): connected suprathreshold
 * clusters (`compute_clusters`) and the volume's max / min voxel
 * (`volume_extremum`), plus the table's region column, CSV and the methods
 * sentence.
 *
 * Backend semantics (core/api_bridge/src/clusters.rs): strict thresholds
 * (positive `v > t`, negative `v < −t`), each sign labelled separately,
 * 6/18/26-connectivity, rows sorted by |peak| descending, peak = the voxel
 * with the largest |value|, centroid = unweighted mean voxel position, COG =
 * |value|-weighted mean (CSV).
 */
import type {
  ClusterSign,
  ClusterTable,
  ComputeClustersRequest,
  ExtremumKind,
  VolumeExtremumRequest,
  VoxelLocation,
} from '@brainflow/api';
import { getTransport, type BackendTransport } from './transport';
import { getEventBus } from '@/events/EventBus';
import { useClusterStore, type ClusterConnectivity } from '@/stores/clusterStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { formatRegionLabel, resolveAtlasRegionAtWorld } from './atlasRegionLookup';
import { formatTauriError } from '@/utils/formatTauriError';
import {
  formatLayerValue,
  formatLayerValueAscii,
  formatWorldMm,
} from '@/utils/valueFormat';
import { statisticUnits } from '@/utils/statistic';
import { announce } from '@/utils/announce';
import { colormaps } from '@/components/ui/colormapOptions';

export interface ComputeClustersInput {
  layerId: string;
  threshold: number;
  sign: ClusterSign;
  connectivity: ClusterConnectivity;
  minVoxels: number;
}

/** Region lookups at cluster peaks are sampled; cap them for very long tables. */
const MAX_REGION_LOOKUPS = 200;
/** Region lookups in flight at once while a table is computed. */
const REGION_LOOKUP_CONCURRENCY = 8;

export class ClusterService {
  private transport: BackendTransport | null;
  private seq = 0;

  constructor(transport?: BackendTransport) {
    this.transport = transport ?? null;
  }

  private bridge(): BackendTransport {
    this.transport ??= getTransport();
    return this.transport;
  }

  /**
   * Compute the cluster table for a layer and publish it in the cluster
   * store. A later call supersedes an earlier one still in flight, and a
   * result for a layer removed meanwhile is dropped.
   */
  async compute(input: ComputeClustersInput): Promise<ClusterTable | null> {
    const request = ++this.seq;
    const store = useClusterStore.getState();
    store.setComputing();
    const layer = useLayerStore.getState().layers.find((l) => l.id === input.layerId);
    const body: ComputeClustersRequest = {
      layerId: input.layerId,
      volumeId: layer?.volumeId ?? input.layerId,
      threshold: input.threshold,
      sign: input.sign,
      connectivity: input.connectivity,
      minVoxels: input.minVoxels,
    };
    try {
      const table = await this.bridge().invoke<ClusterTable>('compute_clusters', { request: body });
      if (request !== this.seq) return null;
      const regions = await this.regionsAtPeaks(table);
      if (request !== this.seq) return null;
      if (!useLayerStore.getState().layers.some((l) => l.id === input.layerId)) {
        useClusterStore.getState().setError('The layer was removed while clusters were computed');
        return null;
      }
      useClusterStore.getState().setResult({
        layerId: input.layerId,
        layerName: layer?.name ?? input.layerId,
        table,
        regions,
        computedAt: Date.now(),
      });
      const voxels = table.clusters.reduce((n, c) => n + c.voxelCount, 0);
      announce(
        `${table.totalClusters} cluster${table.totalClusters === 1 ? '' : 's'}, ${voxels} voxel${voxels === 1 ? '' : 's'}`,
      );
      return table;
    } catch (error) {
      if (request === this.seq) {
        useClusterStore
          .getState()
          .setError(formatTauriError(error) || 'Clusters could not be computed');
      }
      return null;
    }
  }

  /**
   * Atlas/label region at each peak ("—" in the table when null), at most
   * REGION_LOOKUP_CONCURRENCY lookups in flight (not one IPC per cluster at
   * once; review R6).
   */
  private async regionsAtPeaks(table: ClusterTable): Promise<Array<string | null>> {
    const clusters = table.clusters.slice(0, MAX_REGION_LOOKUPS);
    const out: Array<string | null> = table.clusters.map(() => null);
    let next = 0;
    const worker = async () => {
      while (next < clusters.length) {
        const index = next;
        next += 1;
        try {
          const hit = await resolveAtlasRegionAtWorld(clusters[index].peakMm);
          out[index] = hit ? formatRegionLabel(hit.entry) : null;
        } catch {
          out[index] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(REGION_LOOKUP_CONCURRENCY, clusters.length) }, worker));
    return out;
  }

  /**
   * Select a row and move the crosshair to its peak voxel exactly. Peak and
   * extremum moves are NOT snapped: they are explicit requests for one voxel
   * of the statistic layer, and snapping to a coarser reference grid (a 1 mm
   * map over a 2 mm base) would land in a neighbouring voxel, so the readout
   * would contradict "Moved to max z 5.97" (review R2).
   */
  async selectCluster(id: number): Promise<void> {
    const { result, select } = useClusterStore.getState();
    const cluster = result?.table.clusters.find((c) => c.id === id);
    if (!cluster) return;
    select(id);
    await useViewStateStore.getState().setCrosshair([...cluster.peakMm], true, false, undefined, { snap: false });
  }

  /** Location of the max / min voxel of a layer (null when it has no finite value). */
  async extremum(layerId: string, kind: ExtremumKind): Promise<VoxelLocation | null> {
    const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
    const request: VolumeExtremumRequest = { layerId, volumeId: layer?.volumeId ?? layerId, kind };
    return this.bridge().invoke<VoxelLocation | null>('volume_extremum', { request });
  }

  /**
   * Move the crosshair to the max / min voxel; returns the location. When it
   * lands in a row of the current table (the same layer), that row becomes
   * selected. The move is announced in the polite live region.
   */
  async goToExtremum(layerId: string, kind: ExtremumKind): Promise<VoxelLocation | null> {
    const location = await this.extremum(layerId, kind);
    if (location) {
      // Exact, not snapped (see selectCluster).
      await useViewStateStore.getState().setCrosshair([...location.worldMm], true, false, undefined, { snap: false });
      const { result, select } = useClusterStore.getState();
      if (result?.layerId === layerId) {
        const hit = result.table.clusters.find(
          (c) => c.peakIjk.every((v, i) => v === location.ijk[i]),
        );
        if (hit) select(hit.id);
      }
      const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
      const units = statisticUnits(layer?.statistic, useLayerStore.getState().layerMetadata.get(layerId)?.dataRange);
      announce(
        `Moved to ${kind} ${units ? `${stripDof(units)} ` : ''}${formatLayerValue(location.value)} at ${location.worldMm
          .map((v) => formatWorldMm(v))
          .join(', ')} mm`,
      );
    }
    return location;
  }
}

/**
 * The footer's methods sentence (the parameters a figure caption needs),
 * e.g. "26-connected clusters of |z| > 3.1, two-sided, uncorrected, ≥ 1
 * voxel; 4 clusters, 873 voxels". `symbol` is the statistic label ("z",
 * "t(24)") or null ("value"). One-sided tables read "z > 3.1, one-sided
 * (positive)" / "z < −3.1, one-sided (negative)".
 */
export function clusterMethodsSentence(table: ClusterTable, symbol: string | null): string {
  const variable = symbol ? stripDof(symbol) : 'value';
  const voxels = table.clusters.reduce((n, c) => n + c.voxelCount, 0);
  const minVox = `≥ ${table.minVoxels} voxel${table.minVoxels === 1 ? '' : 's'}`;
  const count = `${table.totalClusters} cluster${table.totalClusters === 1 ? '' : 's'}`;
  const dropped =
    table.discardedClusters > 0 ? ` (${table.discardedClusters} smaller dropped)` : '';
  const df = symbol && symbol !== variable ? ` (${symbol})` : '';
  const t = formatLayerValueAscii(table.threshold);
  const test =
    table.sign === 'both'
      ? `|${variable}| > ${t}${df}, two-sided`
      : table.sign === 'positive'
        ? `${variable} > ${t}${df}, one-sided (positive)`
        : `${variable} < \u2212${t}${df}, one-sided (negative)`;
  return `${table.connectivity}-connected clusters of ${test}, uncorrected, ${minVox}; ${count}, ${voxels} voxels${dropped}`;
}

function stripDof(symbol: string): string {
  return symbol.replace(/\(.*\)$/, '');
}

const csvCell = (value: string | number | null) => {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * CSV of the table, ASCII minus throughout, with the methods sentence as a
 * leading comment line so a pasted table carries its parameters.
 */
export function clusterTableCsv(
  table: ClusterTable,
  regions: ReadonlyArray<string | null>,
  meta: { layerName: string; symbol: string | null },
): string {
  // Coordinates at 2 decimals (ASCII minus): centroids are not on voxel centres.
  const mm = (v: readonly number[]) => v.map((x) => Number(x.toFixed(2)));
  const header = [
    'cluster',
    'sign',
    'voxels',
    'volume_mm3',
    'peak_value',
    'peak_x_mm',
    'peak_y_mm',
    'peak_z_mm',
    'peak_i',
    'peak_j',
    'peak_k',
    'centroid_x_mm',
    'centroid_y_mm',
    'centroid_z_mm',
    'cog_abs_weighted_x_mm',
    'cog_abs_weighted_y_mm',
    'cog_abs_weighted_z_mm',
    'mean_value',
    'region_at_peak',
  ];
  const rows = table.clusters.map((c, i) => [
    c.id,
    c.sign,
    c.voxelCount,
    Number(c.volumeMm3.toFixed(3)),
    Number(c.peakValue.toFixed(4)),
    ...mm(c.peakMm),
    ...c.peakIjk,
    ...mm(c.centroidMm),
    // Missing weighted COG: empty cells, never the unweighted values.
    ...(c.weightedCentroidMm ? mm(c.weightedCentroidMm) : [null, null, null]),
    Number(c.meanValue.toFixed(4)),
    regions[i] ?? null,
  ]);
  // The comment line is ASCII too (">=", "-"), like the numbers.
  const comment = `# ${meta.layerName}: ${clusterMethodsSentence(table, meta.symbol)
    .replace(/[−\u2212]/g, '-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')}`;
  return (
    [comment, header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n'
  );
}

/** Ends of a colormap (negative end, positive end), for the sign swatch. */
export function colormapEnds(name: string | undefined): [string, string] {
  const option = colormaps.find((c) => c.name === name) ?? colormaps.find((c) => c.name === 'fmri');
  const stops = option?.gradient.match(/#[0-9a-f]{6}/gi) ?? [];
  return [stops[0] ?? 'currentColor', stops[stops.length - 1] ?? 'currentColor'];
}

/** |threshold| implied by a layer's display threshold (hidden band [lo, hi]). */
export function displayThresholdMagnitude(
  threshold: readonly [number, number] | undefined,
): number | null {
  if (!threshold) return null;
  const t = Math.max(Math.abs(threshold[0]), Math.abs(threshold[1]));
  // [0, 0] is "no threshold", not a threshold of 0 (review R7).
  return Number.isFinite(t) && t > 0 ? t : null;
}

let instance: ClusterService | null = null;

export const getClusterService = (): ClusterService => {
  if (!instance) {
    instance = new ClusterService();
    getEventBus().on('layer.removed', ({ layerId }) => clearResultForRemovedLayer(layerId));
  }
  return instance;
};

/**
 * A table whose layer is gone is cleared (rows would navigate to peaks of a
 * layer that no longer exists; review R8). The parameters are kept.
 */
export function clearResultForRemovedLayer(layerId: string): void {
  const state = useClusterStore.getState();
  if (state.result?.layerId !== layerId) return;
  useClusterStore.setState({ status: 'idle', result: null, error: null, selectedId: null });
}

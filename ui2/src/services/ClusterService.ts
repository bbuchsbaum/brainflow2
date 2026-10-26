/**
 * ClusterService (UI redesign phase 3, item 5): connected suprathreshold
 * clusters (`compute_clusters`) and the volume's max / min voxel
 * (`volume_extremum`), plus the table's region column, CSV and the methods
 * sentence.
 *
 * Backend semantics (core/api_bridge/src/clusters.rs): strict thresholds
 * (positive `v > t`, negative `v < −t`), each sign labelled separately,
 * 6/18/26-connectivity, rows sorted by |peak| descending, peak = the voxel
 * with the largest |value|, centre of mass = unweighted mean voxel position.
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
import { useClusterStore, type ClusterConnectivity } from '@/stores/clusterStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { formatRegionLabel, resolveAtlasRegionAtWorld } from './atlasRegionLookup';
import { formatTauriError } from '@/utils/formatTauriError';
import { formatLayerValueAscii, formatWorldMmAscii } from '@/utils/valueFormat';
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

  /** Atlas/label region at each peak ("—" in the table when null). */
  private async regionsAtPeaks(table: ClusterTable): Promise<Array<string | null>> {
    return Promise.all(
      table.clusters.map(async (cluster, index) => {
        if (index >= MAX_REGION_LOOKUPS) return null;
        try {
          const hit = await resolveAtlasRegionAtWorld(cluster.peakMm);
          return hit ? formatRegionLabel(hit.entry) : null;
        } catch {
          return null;
        }
      }),
    );
  }

  /** Select a row and move the crosshair to its peak (snapped like any placement). */
  async selectCluster(id: number): Promise<void> {
    const { result, select } = useClusterStore.getState();
    const cluster = result?.table.clusters.find((c) => c.id === id);
    if (!cluster) return;
    select(id);
    await useViewStateStore.getState().setCrosshair([...cluster.peakMm], true);
  }

  /** Location of the max / min voxel of a layer (null when it has no finite value). */
  async extremum(layerId: string, kind: ExtremumKind): Promise<VoxelLocation | null> {
    const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
    const request: VolumeExtremumRequest = { layerId, volumeId: layer?.volumeId ?? layerId, kind };
    return this.bridge().invoke<VoxelLocation | null>('volume_extremum', { request });
  }

  /** Move the crosshair to the max / min voxel; returns the location. */
  async goToExtremum(layerId: string, kind: ExtremumKind): Promise<VoxelLocation | null> {
    const location = await this.extremum(layerId, kind);
    if (location) await useViewStateStore.getState().setCrosshair([...location.worldMm], true);
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
  const mm = (v: readonly number[]) => v.map((x) => formatWorldMmAscii(x));
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
    'com_x_mm',
    'com_y_mm',
    'com_z_mm',
    'mean_value',
    'region',
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
    Number(c.meanValue.toFixed(4)),
    regions[i] ?? null,
  ]);
  const comment = `# ${meta.layerName}: ${clusterMethodsSentence(table, meta.symbol).replace(/−/g, '-')}`;
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
  return Number.isFinite(t) ? t : null;
}

let instance: ClusterService | null = null;

export const getClusterService = (): ClusterService => {
  instance ??= new ClusterService();
  return instance;
};

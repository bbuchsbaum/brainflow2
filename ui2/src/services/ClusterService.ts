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
  ClusterExtentInference,
  ClusterSign,
  ClusterTable,
  ComputeClustersRequest,
  ExtentStatistic,
  ExtremumKind,
  FwhmMm,
  VolumeExtremumRequest,
  VoxelLocation,
} from '@brainflow/api';
import { getTransport, type BackendTransport } from './transport';
import { getEventBus } from '@/events/EventBus';
import { useClusterStore, type ClusterConnectivity } from '@/stores/clusterStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { formatRegionLabel, resolveAtlasRegionAtWorld } from './atlasRegionLookup';
import { formatTauriError, tauriErrorCode } from '@/utils/formatTauriError';
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
  /** Opt-in cluster-level p (RFT); the statistic only when the header cannot say it. */
  extent?: { fwhmMm: FwhmMm; statistic?: ExtentStatistic | null } | null;
  /**
   * Volume id of a mask bounding the search (clusters form only inside it;
   * RFT search volume = mask ∩ finite map voxels). Absent: the map's
   * finite non-zero voxels.
   */
  searchMask?: string | null;
}

/** `compute_clusters` rejected because a newer request superseded it. */
export const CLUSTERS_CANCELLED_CODE = 4077;

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
      // The cluster-id label volume, so a row can be a series region (E3).
      emitLabelVolume: true,
      ...(input.extent
        ? {
            extent: {
              method: 'rft-extent' as const,
              fwhmMm: input.extent.fwhmMm,
              ...(input.extent.statistic ? { statistic: input.extent.statistic } : {}),
            },
          }
        : {}),
      ...(input.searchMask ? { searchMask: input.searchMask } : {}),
    };
    try {
      const table = await this.bridge().invoke<ClusterTable>('compute_clusters', { request: body });
      if (request !== this.seq) return null;
      const { regions, subPeakRegions } = await this.regionsAtPeaks(table);
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
        subPeakRegions,
        computedAt: Date.now(),
      });
      const voxels = table.clusters.reduce((n, c) => n + c.voxelCount, 0);
      announce(
        `${table.totalClusters} cluster${table.totalClusters === 1 ? '' : 's'}, ${voxels} voxel${voxels === 1 ? '' : 's'}`,
      );
      return table;
    } catch (error) {
      // Superseded (a newer request, from here or another view): not an
      // error to show; the newer request reports its own outcome.
      if (tauriErrorCode(error) === CLUSTERS_CANCELLED_CODE) {
        if (request === this.seq) useClusterStore.getState().cancelComputing();
        return null;
      }
      if (request === this.seq) {
        useClusterStore
          .getState()
          .setError(formatTauriError(error) || 'Clusters could not be computed');
      }
      return null;
    }
  }

  /**
   * Atlas/label region at each peak and sub-peak ("—" in the table when
   * null), at most REGION_LOOKUP_CONCURRENCY lookups in flight (not one IPC
   * per cluster at once; review R6) and MAX_REGION_LOOKUPS in all.
   */
  private async regionsAtPeaks(
    table: ClusterTable,
  ): Promise<{ regions: Array<string | null>; subPeakRegions: Array<Array<string | null>> }> {
    const regions: Array<string | null> = table.clusters.map(() => null);
    const subPeakRegions = table.clusters.map((c) => (c.subPeaks ?? []).map((): string | null => null));
    // Main peaks first, then sub-peaks, within the lookup budget.
    const jobs: Array<{ mm: readonly number[]; put: (region: string | null) => void }> = [];
    table.clusters.forEach((c, i) => jobs.push({ mm: c.peakMm, put: (r) => (regions[i] = r) }));
    table.clusters.forEach((c, i) =>
      (c.subPeaks ?? []).forEach((p, j) => jobs.push({ mm: p.mm, put: (r) => (subPeakRegions[i][j] = r) })),
    );
    const budget = jobs.slice(0, MAX_REGION_LOOKUPS);
    let next = 0;
    const worker = async () => {
      while (next < budget.length) {
        const job = budget[next];
        next += 1;
        try {
          const hit = await resolveAtlasRegionAtWorld([job.mm[0], job.mm[1], job.mm[2]]);
          job.put(hit ? formatRegionLabel(hit.entry) : null);
        } catch {
          job.put(null);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(REGION_LOOKUP_CONCURRENCY, budget.length) }, worker));
    return { regions, subPeakRegions };
  }

  /** Move the crosshair to a sub-peak exactly (like a cluster's peak; not snapped). */
  async goToSubPeak(clusterId: number, index: number): Promise<void> {
    const { result, select } = useClusterStore.getState();
    const cluster = result?.table.clusters.find((c) => c.id === clusterId);
    const peak = cluster?.subPeaks?.[index];
    if (!peak) return;
    select(clusterId);
    await useViewStateStore.getState().setCrosshair([...peak.mm], true, false, undefined, { snap: false });
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

/** How the search volume was chosen, for the methods paragraph. */
export interface ClusterSearchLabel {
  /** Display name of the mask layer when `table.searchVolume.kind` is "mask". */
  maskName?: string | null;
}

const thousands = (n: number) => n.toLocaleString('en-US');
const fixedThousands = (n: number, digits: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/**
 * Mask voxels where the map is 0 or non-finite (round 3 T2): searched but
 * with no data. `maskVoxelsOutsideMap` is not in the generated bindings yet
 * (asked of p3-backend); read it when present.
 */
export function maskVoxelsOutsideMap(table: ClusterTable): number | null {
  const n = (table.searchVolume as { maskVoxelsOutsideMap?: unknown } | undefined)?.maskVoxelsOutsideMap;
  return table.searchVolume?.kind === 'mask' && typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** "non-zero voxels of the map" / "brain mask T1" (what the backend searched). */
function searchDescription(table: ClusterTable, label?: ClusterSearchLabel): string {
  if (table.searchVolume?.kind === 'mask') {
    const name = label?.maskName ?? table.searchVolume.maskVolumeId ?? 'a mask';
    const outside = maskVoxelsOutsideMap(table);
    return `brain mask ${name}${outside ? `; ${thousands(outside)} mask voxel${outside === 1 ? '' : 's'} where the map is 0 or non-finite` : ''}`;
  }
  return 'non-zero voxels of the map';
}

/**
 * A volume the cluster search may use as a brain mask (round 4 C7): binary
 * data ({0, 1}: isBinaryLike, or a data range of exactly 0..1 when the
 * loader did not say otherwise), or a file whose name has the whole token
 * "mask" / "brainmask" ("brain_mask", "_mask.nii"; not "masked"). A
 * probability map (continuous 0..1, isBinaryLike false) is never offered, even
 * when named as a mask. Any other volume would silently set the search volume
 * to its non-zero support.
 */
export function isMaskLike(
  layer: { name?: string; type?: string; sourcePath?: string },
  metadata?: { isBinaryLike?: boolean; dataRange?: { min: number; max: number } } | null,
): boolean {
  if (metadata?.isBinaryLike === false) return false;
  if (metadata?.isBinaryLike === true) return true;
  const range = metadata?.dataRange;
  if (range && range.min === 0 && range.max === 1) return true;
  if (range && !(range.min >= 0 && range.max <= 1)) return false;
  const base = (path: string | undefined) => (path ?? '').split(/[\\/]/).pop() ?? '';
  return [layer.name, base(layer.sourcePath)].some((n) => MASK_TOKEN.test(n ?? ''));
}

/** "mask" or "brainmask" as a whole token: brain_mask, sub-01_mask.nii.gz, brainmask; not "masked". */
const MASK_TOKEN = /(?:^|[^a-z])(?:brain)?mask(?:[^a-z]|$)/i;

/**
 * The footer's methods paragraph (what a figure caption or methods section
 * needs), every number stated once, in methods order, e.g. "26-connected
 * clusters of |z| > 3.1, two-tailed, uncorrected, ≥ 1 voxel; 4 clusters, 873
 * voxels. Cluster-level p(FWE) by Gaussian random field theory, two-tailed
 * (1 − (1 − p)²), 8 mm FWHM (4.0 voxels, user-supplied); search volume 43,051
 * voxels (non-zero voxels of the map), 577.2 resels; 6.54 clusters expected
 * per tail, 13.4 voxels each." `symbol` is the statistic label ("z",
 * "t(24)") or null ("value"). One-tailed tables read "z > 3.1, one-tailed
 * (positive)" / "z < −3.1, one-tailed (negative)". The caveats are
 * {@link clusterCaveats}.
 */
export function clusterMethodsSentence(
  table: ClusterTable,
  symbol: string | null,
  label?: ClusterSearchLabel,
): string {
  const variable = symbol ? stripDof(symbol) : 'value';
  const voxels = table.clusters.reduce((n, c) => n + c.voxelCount, 0);
  const minVox = `≥ ${table.minVoxels} voxel${table.minVoxels === 1 ? '' : 's'}`;
  const count = `${thousands(table.totalClusters)} cluster${table.totalClusters === 1 ? '' : 's'}`;
  const dropped =
    table.discardedClusters > 0 ? `, ${table.discardedClusters} smaller dropped` : '';
  const df = symbol && symbol !== variable ? ` (${symbol})` : '';
  const t = formatLayerValueAscii(table.threshold);
  const test =
    table.sign === 'both'
      ? `|${variable}| > ${t}${df}, two-tailed`
      : table.sign === 'positive'
        ? `${variable} > ${t}${df}, one-tailed (positive)`
        : `${variable} < \u2212${t}${df}, one-tailed (negative)`;
  const peaks =
    (table.maxPeaksPerCluster ?? 1) > 1
      ? `; up to ${table.maxPeaksPerCluster} peaks per cluster, ≥ ${formatLayerValueAscii(table.minPeakDistanceMm)} mm apart`
      : '';
  const inference = table.extentInference;
  // The search volume decides every p(FWE): state it (v0 fidelity 5), and
  // which voxels it is (S3). Without p values it matters only for a mask.
  const maskOnly =
    !inference && table.searchVolume?.kind === 'mask'
      ? `; search volume ${thousands(table.searchVolume.voxels)} voxels (${searchDescription(table, label)})`
      : '';
  const first = `${table.connectivity}-connected clusters of ${test}, uncorrected, ${minVox}; ${count}, ${thousands(voxels)} voxels${dropped}${peaks}${maskOnly}.`;
  if (!inference) return first;
  const tails = inference.tails === 2 ? 'two-tailed (1 \u2212 (1 \u2212 p)\u00b2)' : 'one-tailed';
  const fwhmVox = fwhmVoxels(inference, table.voxelVolumeMm3);
  const second =
    `Cluster-level p(FWE) by Gaussian random field theory, ${tails}, ` +
    `${fwhmDescription(inference)} FWHM (${fwhmVox ? `${fwhmVox}, ` : ''}user-supplied); ` +
    `search volume ${thousands(inference.searchVoxels)} voxels (${searchDescription(table, label)}), ` +
    `${fixedThousands(inference.resels[3], 1)} resels; ` +
    `${inference.expectedClusters.toFixed(2)} clusters expected per tail, ` +
    `${fixedThousands(inference.expectedVoxelsPerCluster, 1)} voxels each.`;
  return `${first} ${second}`;
}

/**
 * The caveats behind a table's cluster p values (none without them): the
 * standing RFT assumptions, and a warning when the stated smoothness is
 * under 3 voxels FWHM on some axis (RFT p values are then conservative and
 * unstable). The warning is shown whenever it applies.
 */
export function clusterCaveats(table: ClusterTable): { assumptions: string; warning: string | null } | null {
  const inference = table.extentInference;
  if (!inference) return null;
  const edge = Math.cbrt(table.voxelVolumeMm3);
  const minFwhmVoxels = edge > 0 ? Math.min(...inference.fwhmMm) / edge : Infinity;
  return {
    assumptions:
      'Assumes stationary smoothness; approximate unless the cluster-forming threshold is high and the map is smooth relative to its voxels (SPM spm_P_RF).',
    warning:
      minFwhmVoxels < 3
        ? `Smoothness is only ${minFwhmVoxels.toFixed(1)} voxels FWHM: p values are likely conservative and unstable.`
        : null,
  };
}

/** "4.0 voxels" for an isotropic FWHM on isotropic voxels (SPM's footer states both), else "". */
function fwhmVoxels(inference: Pick<ClusterExtentInference, 'fwhmMm'>, voxelVolumeMm3: number): string {
  const [x, y, z] = inference.fwhmMm;
  const edge = Math.cbrt(voxelVolumeMm3);
  if (!(edge > 0) || x !== y || y !== z) return '';
  return `${(x / edge).toFixed(1)} voxels`;
}

/** "8 mm" (isotropic) or "6 × 6 × 8 mm" (per voxel axis). */
export function fwhmDescription(inference: Pick<ClusterExtentInference, 'fwhmMm'>): string {
  const [x, y, z] = inference.fwhmMm.map((v) => formatLayerValueAscii(v));
  return x === y && y === z ? `${x} mm` : `${x} × ${y} × ${z} mm`;
}

/**
 * The FWHM field: one positive value (isotropic) or three (voxel axes i j
 * k), separated by spaces, commas or "x". Null when it is not that.
 */
export function parseFwhm(text: string): FwhmMm | null {
  // The unit may be typed: "8mm", "8 mm", "6 x 6 x 8 mm".
  const parts = text
    .replace(/mm\b/gi, ' ')
    .trim()
    .split(/[\s,x×]+/i)
    .filter(Boolean)
    .map(Number);
  if (!parts.every((v) => Number.isFinite(v) && v > 0)) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 3) return [parts[0], parts[1], parts[2]];
  return null;
}

/** A cluster-level p for the table: "< 0.001", three decimals, or four just below 1. */
export function formatClusterP(p: number | null | undefined): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  if (p < 0.001) return '< 0.001';
  // Near 1, three decimals would round 0.9996 up to "1.000" (round 4 C9).
  return p > 0.999 && p < 1 ? p.toFixed(4) : p.toFixed(3);
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
  meta: { layerName: string; symbol: string | null; maskName?: string | null },
  subPeakRegions?: ReadonlyArray<ReadonlyArray<string | null>>,
): string {
  // Coordinates at 2 decimals (ASCII minus): centroids are not on voxel centres.
  const mm = (v: readonly number[]) => v.map((x) => Number(x.toFixed(2)));
  const extent = !!table.extentInference;
  const header = [
    'cluster',
    // 1: the cluster's peak (its row); 2.. its sub-peaks (rows with only the
    // peak columns and the region filled).
    'peak',
    'sign',
    'voxels',
    'volume_mm3',
    ...(extent ? ['p_fwe_extent', 'p_unc_extent'] : []),
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
  const pCell = (p: number | null | undefined) => (p === null || p === undefined ? null : Number(p.toPrecision(4)));
  const rows = table.clusters.flatMap((c, i) => [
    [
      c.id,
      1,
      c.sign,
      c.voxelCount,
      Number(c.volumeMm3.toFixed(3)),
      ...(extent ? [pCell(c.pFweExtent), pCell(c.pUncorrectedExtent)] : []),
      Number(c.peakValue.toFixed(4)),
      ...mm(c.peakMm),
      ...c.peakIjk,
      ...mm(c.centroidMm),
      // Missing weighted COG: empty cells, never the unweighted values.
      ...(c.weightedCentroidMm ? mm(c.weightedCentroidMm) : [null, null, null]),
      Number(c.meanValue.toFixed(4)),
      regions[i] ?? null,
    ],
    ...(c.subPeaks ?? []).map((p, j) => [
      c.id,
      j + 2,
      c.sign,
      null,
      null,
      ...(extent ? [null, null] : []),
      Number(p.value.toFixed(4)),
      ...mm(p.mm),
      ...p.ijk,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      subPeakRegions?.[i]?.[j] ?? null,
    ]),
  ]);
  // The comment lines are ASCII too (">=", "-"), like the numbers.
  const ascii = (text: string) =>
    text
      .replace(/[−\u2212]/g, '-')
      .replace(/≥/g, '>=')
      .replace(/≤/g, '<=')
      .replace(/×/g, 'x')
      .replace(/\u00b2/g, '^2');
  const comments = [
    `# ${meta.layerName}: ${ascii(clusterMethodsSentence(table, meta.symbol, { maskName: meta.maskName }))}`,
  ];
  const caveats = clusterCaveats(table);
  if (caveats) comments.push(`# ${ascii([caveats.assumptions, caveats.warning].filter(Boolean).join(' '))}`);
  return (
    [...comments, header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n'
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

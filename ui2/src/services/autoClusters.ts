/**
 * Clusters on load (QA features 2026-10-31 §8, QA 2026-10-30 C1): a
 * statistic map's clusters at its display threshold are computed as soon
 * as it loads, and again (debounced) whenever that threshold changes, so the
 * Inspector can say "Peak z 6.41 at (−40, −20, 50)" and the Clusters tab
 * has a table without pressing Compute.
 *
 * - Which layers: the statistic band of the stack rule (`layerPlacement.ts`)
 *   that also has statistic units (z, t, F…), the panel's own test. A signed
 *   beta map or a count map is placed like a statistic but has no units: it
 *   is left to the manual Compute.
 * - Threshold: each tail of the display threshold at display precision, as
 *   the panel and the Inspector show it (−3.1 ≤ z ≤ 3.93 hidden clusters
 *   z < −3.1 and z > 3.93; QA 2026-10-31 N6). Cluster p needs one forming
 *   threshold, so it is left out while the tails differ. A z or t map
 *   without a threshold uses the conventional 3.1, as the panel
 *   seeds it. Sign, connectivity, minimum size, search mask and the opt-in
 *   cluster p follow the panel's parameters.
 * - Which layers are run: visible ones in the active view, not image-set
 *   members (a set of 40 maps would start 40 runs). A hidden layer runs when
 *   it is shown.
 * - Ordering: one queue, one run at a time, the active layer first. A
 *   threshold change makes the layer's run stale at once (its result is
 *   dropped) and queues it again after the debounce. Nothing starts or lands
 *   while the user's Compute is in flight: the run waits and is redone after
 *   it (the backend keeps background runs in their own supersede order, so
 *   neither cancels the other). A removed layer's timer, queue entry and
 *   peak go with it.
 * - Publishing: the layer's strongest peak always (`clusterStore.peaks`).
 *   The table only while the panel follows the layer threshold, no Compute
 *   is running, and the table shown is this layer's, there is none, or this
 *   layer is the active one: an automatic run never replaces a table the
 *   user computed for another layer or at a threshold they typed.
 */
import type { ClusterTable } from '@brainflow/api';
import { getEventBus } from '@/events/EventBus';
import { useClusterStore, type LayerPeak } from '@/stores/clusterStore';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { DEFAULT_STAT_THRESHOLD } from './IntensityRangeComputer';
import { PlacementBand, placementBand } from './layerPlacement';
import {
  clusterThresholds,
  displayThresholdBounds,
  type ThresholdBounds,
  getClusterService,
  parseFwhm,
  type ComputeClustersInput,
} from './ClusterService';
import { isInferredStatistic, statisticUnits } from '@/utils/statistic';
import { activeVolumeLayerId } from '@/utils/activeLayer';

/** Quiet period after the last threshold change before clusters are recomputed. */
export const AUTO_CLUSTER_DEBOUNCE_MS = 400;

interface Tracked {
  /** Thresholds of the latest scheduled, queued or running request. */
  threshold: ThresholdBounds | null;
  /** `boundsKey` of the thresholds whose result was published (null: none yet). */
  done: string | null;
  seq: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const tracked = new Map<string, Tracked>();
/** Layers waiting for their run, in order of arrival. */
const queue: string[] = [];
let running: string | null = null;
let started = false;
let lastViewState: unknown = null;

const boundsKey = (b: ThresholdBounds | null) => (b ? `${b.positive}/${b.negative}` : null);

/** The layer's display threshold tails at display precision, or the z / t default; null when neither applies. */
export function autoClusterThreshold(layerId: string): ThresholdBounds | null {
  const layer = useLayerStore.getState().layers.find((l) => l.id === layerId);
  if (!layer) return null;
  const range = useLayerStore.getState().layerMetadata.get(layerId)?.dataRange;
  const symbol = statisticUnits(layer.statistic, range);
  const views = useViewStateStore.getState();
  const viewLayer =
    views.viewState.layers.find((l) => l.id === layerId) ??
    [...views.workspaceViewStates.values()].flatMap((s) => s.layers).find((l) => l.id === layerId);
  const bounds = displayThresholdBounds(viewLayer?.threshold);
  if (bounds) return bounds;
  return symbol && /^[zt]/.test(symbol)
    ? { positive: DEFAULT_STAT_THRESHOLD, negative: DEFAULT_STAT_THRESHOLD }
    : null;
}

/** A layer whose clusters are computed on load: statistic band and statistic units. */
export function isAutoClusterLayer(layerId: string): boolean {
  const store = useLayerStore.getState();
  const layer = store.layers.find((l) => l.id === layerId);
  if (!layer?.volumeId || layer.imageSetId) return false;
  if ((layer.timeSeriesInfo?.num_timepoints ?? 1) > 1) return false;
  const meta = store.layerMetadata.get(layerId);
  if (placementBand(layer, meta) !== PlacementBand.Statistic) return false;
  return statisticUnits(layer.statistic, meta?.dataRange) !== null;
}

/** The strongest peak of a table (rows are sorted by |peak|), with the test it was formed at. */
export function strongestPeak(table: ClusterTable): LayerPeak {
  const top = table.clusters[0];
  return {
    threshold: table.threshold,
    negativeThreshold: table.negativeThreshold ?? null,
    sign: table.sign,
    value: top ? top.peakValue : null,
    mm: top ? [top.peakMm[0], top.peakMm[1], top.peakMm[2]] : null,
    clusters: table.totalClusters,
  };
}

function requestFor(layerId: string, bounds: ThresholdBounds): ComputeClustersInput | null {
  const { params } = useClusterStore.getState();
  if (params.minVoxels === null || !Number.isInteger(params.minVoxels) || params.minVoxels < 1)
    return null;
  const layers = useLayerStore.getState().layers;
  const layer = layers.find((l) => l.id === layerId);
  const fwhm = params.extentP ? parseFwhm(params.fwhmText) : null;
  const statistic = layer?.statistic;
  const declared =
    statistic && isInferredStatistic(statistic) && statistic.kind === 'z' ? ('z' as const) : null;
  const mask = params.searchMaskLayerId
    ? layers.find((l) => l.id === params.searchMaskLayerId)
    : undefined;
  // Only the tails the display thresholds (a one-sided band searches one sign).
  const tails = clusterThresholds(bounds, params.sign);
  if (!tails) return null;
  const { threshold, negativeThreshold, sign } = tails;
  return {
    layerId,
    threshold,
    ...(negativeThreshold !== null ? { negativeThreshold } : {}),
    sign,
    connectivity: params.connectivity,
    minVoxels: params.minVoxels,
    // Cluster p is refused with two forming thresholds: the peak still comes.
    extent: fwhm !== null && negativeThreshold === null ? { fwhmMm: fwhm, statistic: declared } : null,
    ...(mask?.volumeId && mask.id !== layerId ? { searchMask: mask.volumeId } : {}),
  };
}

/** Drawn in the active view: only those layers are run. */
function visibleInView(layerId: string): boolean {
  const layer = useViewStateStore.getState().viewState.layers.find((l) => l.id === layerId);
  return !!layer && layer.visible !== false && layer.opacity !== 0;
}

const userComputing = () => useClusterStore.getState().status === 'computing';

/** Start the next queued run (active layer first), unless one runs or Compute is in flight. */
function pump(): void {
  if (running || userComputing() || queue.length === 0) return;
  const active = activeVolumeLayerId(useViewStateStore.getState().viewState.layers);
  const at = active ? queue.indexOf(active) : -1;
  const [layerId] = queue.splice(at >= 0 ? at : 0, 1);
  const entry = tracked.get(layerId);
  if (!entry) return pump();
  running = layerId;
  void run(layerId, entry, entry.seq).finally(() => {
    running = null;
    pump();
  });
}

function enqueue(layerId: string): void {
  if (!queue.includes(layerId)) queue.push(layerId);
  pump();
}

async function run(layerId: string, entry: Tracked, seq: number): Promise<void> {
  const threshold = entry.threshold;
  if (threshold === null || !visibleInView(layerId)) return;
  const input = requestFor(layerId, threshold);
  if (!input) {
    entry.done = boundsKey(threshold); // nothing to run until a parameter or the threshold changes
    useClusterStore.getState().setPeak(layerId, null);
    return;
  }
  const isCurrent = () => tracked.get(layerId) === entry && entry.seq === seq;
  try {
    const result = await getClusterService().computeQuiet(input, isCurrent);
    if (!result || !isCurrent()) return;
    // A Compute started meanwhile: its result comes first; redo this after it.
    if (userComputing()) {
      if (!queue.includes(layerId)) queue.push(layerId);
      return;
    }
    const store = useClusterStore.getState();
    store.setPeak(layerId, strongestPeak(result.table));
    entry.done = boundsKey(threshold);
    const shown = store.result;
    const active = activeVolumeLayerId(useViewStateStore.getState().viewState.layers);
    if (store.params.linked && (!shown || shown.layerId === layerId || active === layerId)) {
      store.setResult(result);
    }
  } catch (error) {
    // The Inspector simply shows no peak; Compute in the panel reports errors.
    if (isCurrent()) {
      // Not retried on every view change; the next threshold change runs again.
      entry.done = boundsKey(threshold);
      console.warn(`[autoClusters] clusters for ${layerId} failed:`, error);
    }
  }
}

/** Queue now (load, shown) or after the debounce (threshold change); a pending or running request goes stale. */
function schedule(layerId: string, threshold: ThresholdBounds | null, delayMs: number): void {
  const entry = tracked.get(layerId);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.threshold = threshold;
  entry.seq += 1;
  const queued = queue.indexOf(layerId);
  if (queued >= 0) queue.splice(queued, 1);
  if (threshold === null) {
    entry.done = null;
    useClusterStore.getState().setPeak(layerId, null);
    return;
  }
  if (!visibleInView(layerId)) return; // runs when shown (onViewState)
  entry.timer = setTimeout(() => {
    entry.timer = null;
    enqueue(layerId);
  }, delayMs);
}

function track(layerId: string): void {
  if (tracked.has(layerId) || !isAutoClusterLayer(layerId)) return;
  tracked.set(layerId, { threshold: null, done: null, seq: 0, timer: null });
  schedule(layerId, autoClusterThreshold(layerId), 0);
}

function forget(layerId: string): void {
  const entry = tracked.get(layerId);
  if (entry?.timer) clearTimeout(entry.timer);
  tracked.delete(layerId);
  const queued = queue.indexOf(layerId);
  if (queued >= 0) queue.splice(queued, 1);
  useClusterStore.getState().setPeak(layerId, null);
}

/** Threshold edits (Inspector, histogram, undo…): recompute the layers whose threshold moved. */
function onViewState(): void {
  const viewState = useViewStateStore.getState().viewState;
  if (viewState === lastViewState) return;
  lastViewState = viewState;
  for (const [layerId, entry] of tracked) {
    const threshold = autoClusterThreshold(layerId);
    if (boundsKey(threshold) !== boundsKey(entry.threshold))
      schedule(layerId, threshold, AUTO_CLUSTER_DEBOUNCE_MS);
    else if (
      // Shown (or the view switched to it) without a result for this threshold.
      threshold !== null &&
      entry.done !== boundsKey(threshold) &&
      !entry.timer &&
      running !== layerId &&
      !queue.includes(layerId) &&
      visibleInView(layerId)
    ) {
      schedule(layerId, threshold, 0);
    }
  }
}

/** Start following loads and threshold changes (once; services init). */
export function initializeAutoClusters(): () => void {
  if (started) return () => {};
  started = true;
  const bus = getEventBus();
  const offAdded = bus.on('layer.added', ({ layer }) => track(layer.id));
  const offRemoved = bus.on('layer.removed', ({ layerId }) => forget(layerId));
  lastViewState = useViewStateStore.getState().viewState;
  const offView = useViewStateStore.subscribe(onViewState);
  // A Compute finished: the runs that waited for it go.
  let wasComputing = userComputing();
  const offCompute = useClusterStore.subscribe((state) => {
    const computing = state.status === 'computing';
    if (wasComputing && !computing) pump();
    wasComputing = computing;
  });
  return () => {
    offAdded();
    offRemoved();
    offView();
    offCompute();
    for (const id of [...tracked.keys()]) forget(id);
    queue.length = 0;
    running = null;
    started = false;
  };
}

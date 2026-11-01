/**
 * One display window for the runs of one acquisition (round 3 C1, native
 * R3-2): p2–p98 of ONE pooled distribution — all voxels of all frames of all
 * runs, background zeros included — so switching runs never re-scales the
 * image. A sibling's window is updated only while it still shows the
 * window this module last set (a user's window is left alone).
 */
import { getEventBus } from '@/events/EventBus';
import { useLayerStore } from '@/stores/layerStore';
import { runGroupFor } from './seriesSegments';

type Window = [number, number];

const own = new Map<string, Window>();
const applied = new Map<string, Window>();

// A removed layer leaves the pool (REVIEW m15).
let pruning = false;
function prune(): void {
  if (pruning) return;
  pruning = true;
  getEventBus().on('layer.removed', ({ layerId }: { layerId: string }) => {
    own.delete(layerId);
    applied.delete(layerId);
  });
}

// Windows survive a float32 round trip (the render path stores f32), so
// "still the window the view set" allows a relative tolerance (native R2-1).
const same = (a: readonly number[] | undefined, b: readonly number[] | undefined) => {
  if (!a || !b) return false;
  const tol = 1e-4 * Math.max(1, Math.abs(b[1] - b[0]));
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
};

/** A histogram on the pool's common range (same bins for every run). */
export interface PoolHistogram {
  bins: readonly { x0: number; x1: number; count: number }[];
  totalCount: number;
}

/**
 * The EPI window of a run group from ONE pooled distribution (native R3-2):
 * per-run histograms on a common range with the same bins are summed, then
 * p2–p98 is read from the sum — every voxel of every frame of every run,
 * zeros included (not the max of per-run p98s, which over-shoots: 114.56 vs
 * the pooled 112.94). A background-dominated p2 is the background (min); a
 * window under 5% of the range widens to the range.
 */
export function pooledWindow(
  hists: readonly PoolHistogram[],
  percentile: (bins: PoolHistogram['bins'], total: number, q: number) => number,
): Window | null {
  const first = hists.find((h) => h.bins.length > 0);
  if (!first) return null;
  const bins = first.bins.map((b, i) => ({
    x0: b.x0,
    x1: b.x1,
    count: hists.reduce((n, h) => n + (h.bins[i]?.count ?? 0), 0),
  }));
  const total = bins.reduce((n, b) => n + b.count, 0);
  if (!(total > 0)) return null;
  const lo = bins[0].x0;
  const hi = bins[bins.length - 1].x1;
  const span = hi - lo;
  const p2 = percentile(bins, total, 2);
  const p98 = percentile(bins, total, 98);
  const low = p2 - lo < 0.01 * span ? lo : p2;
  if (!(p98 - low >= 0.05 * span && p98 > low)) return [lo, hi];
  return [low, unsaturatedTop(bins, low, p98, span) ?? p98];
}

/**
 * A window top that keeps the brain mid grey when p98 does not (QA
 * 2026-10-30 F16): in a series whose tissue is nearly uniform (a synthetic
 * or bias-flattened run, in-brain ≈ 100 on a zero background) p98 is the
 * tissue value itself, and the run opens as a flat white slab. When at least
 * a quarter of the non-background voxels sit in the top 5 % of the window,
 * the top moves to twice the tissue median above the floor. Real EPI, whose
 * tissue spreads over the window, is unchanged.
 */
function unsaturatedTop(
  bins: readonly { x0: number; x1: number; count: number }[],
  low: number,
  top: number,
  span: number,
): number | null {
  const tissue = bins.filter((b) => b.x0 >= low + 0.05 * span);
  const count = tissue.reduce((n, b) => n + b.count, 0);
  if (!(count > 0)) return null;
  const nearTop = tissue.filter((b) => b.x1 > low + 0.95 * (top - low)).reduce((n, b) => n + b.count, 0);
  if (nearTop < 0.25 * count) return null;
  let seen = 0;
  for (const b of tissue) {
    seen += b.count;
    if (seen >= count / 2) {
      const median = (b.x0 + b.x1) / 2;
      return median > low ? Math.max(top, low + 2 * (median - low)) : null;
    }
  }
  return null;
}

/** The run group of a layer (the layer alone when it has none). */
export function runGroupIds(layerId: string): string[] {
  const { layers, layerMetadata } = useLayerStore.getState();
  const grid = (id: string) => {
    const m = layerMetadata?.get?.(id);
    return m ? { dimensions: m.dimensions, voxelToWorld: m.voxelToWorld } : undefined;
  };
  const group = runGroupFor(layerId, layers ?? [], grid);
  return group ? [...new Set(group.segments.map((s) => s.layerId))] : [layerId];
}

/**
 * The pooled window for `layerId`'s run group (`window`, computed over every
 * run in `ids`); siblings still on the window this module set get it too.
 */
export function shareRunWindow(
  layerId: string,
  window: Window,
  current: (id: string) => readonly number[] | undefined,
  apply: (id: string, window: Window) => void,
  ids: readonly string[] = runGroupIds(layerId),
): Window {
  prune();
  own.set(layerId, window);
  for (const id of ids) {
    if (id === layerId || !applied.has(id)) continue;
    if (!same(current(id), applied.get(id))) continue;
    apply(id, window);
    applied.set(id, window);
  }
  applied.set(layerId, window);
  return window;
}

/** Test hook. */
export function resetRunWindows(): void {
  own.clear();
  applied.clear();
}

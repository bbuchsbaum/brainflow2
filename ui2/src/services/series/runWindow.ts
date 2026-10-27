/**
 * One display window for the runs of one acquisition (round 3 C1): each BOLD
 * run's own EPI window (p2–p98 of all its voxels and frames, background zeros
 * included) is pooled with its run group's, so switching runs never re-scales
 * the image. A sibling's window is updated only while it still shows the
 * window this module last set (a user's window is left alone).
 */
import { useLayerStore } from '@/stores/layerStore';
import { runGroupFor } from './seriesSegments';

type Window = [number, number];

const own = new Map<string, Window>();
const applied = new Map<string, Window>();

const same = (a: readonly number[] | undefined, b: readonly number[] | undefined) =>
  !!a && !!b && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/**
 * Record `layerId`'s own window and return the pooled window for it; siblings
 * still on their auto window get the pooled one through `apply`.
 */
export function shareRunWindow(
  layerId: string,
  window: Window,
  current: (id: string) => readonly number[] | undefined,
  apply: (id: string, window: Window) => void,
): Window {
  own.set(layerId, window);
  const { layers, layerMetadata } = useLayerStore.getState();
  const grid = (id: string) => {
    const m = layerMetadata?.get?.(id);
    return m ? { dimensions: m.dimensions, voxelToWorld: m.voxelToWorld } : undefined;
  };
  const group = runGroupFor(layerId, layers ?? [], grid);
  const ids = group ? [...new Set(group.segments.map((s) => s.layerId))] : [layerId];
  const windows = ids.map((id) => own.get(id)).filter((w): w is Window => !!w);
  const pooled: Window = [
    Math.min(...windows.map((w) => w[0])),
    Math.max(...windows.map((w) => w[1])),
  ];
  for (const id of ids) {
    if (id === layerId || !own.has(id)) continue;
    if (!same(current(id), applied.get(id))) continue;
    apply(id, pooled);
    applied.set(id, pooled);
  }
  applied.set(layerId, pooled);
  return pooled;
}

/** Test hook. */
export function resetRunWindows(): void {
  own.clear();
  applied.clear();
}

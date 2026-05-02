/**
 * Helpers for `PinnedTimeRow` and the integrated workspace shell. Lives in
 * its own file so the React component file can satisfy the
 * `react-refresh/only-export-components` invariant.
 */

import { useLayerStore } from '@/stores/layerStore';

/**
 * Reactive Zustand selector hook: `true` when the currently selected layer is
 * a 4D volume (has `timeSeriesInfo` with at least 2 timepoints).
 *
 * Re-renders the consumer only when the boolean flips — selecting different
 * 3D layers, or different 4D layers, does not cause a re-render.
 */
export function useActiveLayerIsFourD(): boolean {
  return useLayerStore((state) => {
    const id = state.selectedLayerId;
    if (!id) return false;
    const layer = state.layers.find((l) => l.id === id);
    if (!layer) return false;
    const ts = (layer as typeof layer & { timeSeriesInfo?: { num_timepoints: number } })
      .timeSeriesInfo;
    return Boolean(ts && ts.num_timepoints >= 2);
  });
}

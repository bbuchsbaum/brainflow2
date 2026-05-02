/**
 * Plot-mode resolution helpers.
 *
 * The bottom dock plot should adapt to the selected layer rather than
 * hard-coding a single default. This file owns:
 *   - `getDefaultPlotModeForLayer` — pure resolver for the most relevant
 *     plot mode given a layer descriptor (4D → crosshair-time-series,
 *     3D scalar → histogram, etc.);
 *   - `useDefaultPlotModeForActiveLayer` — reactive Zustand-bound hook that
 *     wraps the resolver and watches `selectedLayerId`;
 *   - `pickFirstSupportedMode` — pure helper that returns the first mode
 *     in `modes` whose `supports(ctx)` reports `true`, used as the transient
 *     fallback when a manual user pick becomes unsupported;
 *   - `usePlotModeSelection` — the small selection-policy state machine
 *     described in mote `bd-01KQK24YYRXCDJKAPE6SBB84JE`. It coordinates the
 *     `plotModeStore` singleton with the active layer + supported-mode
 *     check so the integrated workspace's bottom plot adapts in `auto` mode
 *     but preserves explicit user picks.
 *
 * Pinned-only callers (e.g. `PinnedTimeRow`, which only mounts for 4D
 * layers) should NOT use this resolver — they pin a single mode by design.
 * Adaptive callers (the integrated workspace's bottom Plot pane) should.
 */

import { useCallback, useEffect, useMemo } from 'react';

import { useLayerStore } from '@/stores/layerStore';
import { usePlotModeStore } from '@/stores/plotModeStore';

import type { PlotMode, PlotModeContext } from './plotHost.types';

/** Plot mode ids the resolver may return. Add new ids here as plot modes ship. */
export type DefaultPlotModeId = 'crosshair-time-series' | 'histogram';

/** Minimal layer shape consumed by the resolver — keeps it decoupled from the full Layer union. */
export interface LayerLikeForPlotMode {
  readonly id?: string;
  readonly timeSeriesInfo?: { readonly num_timepoints: number };
  // Future: readonly type?: 'surface' | 'atlas' | … to drive surface/atlas modes.
}

/**
 * Pure resolver: returns the most relevant default plot mode id for the
 * provided layer. Falls back to `'histogram'` whenever no better match is
 * available — that mode renders a useful empty state for unsupported layers
 * via the `PlotHost` empty-state machine.
 */
export function getDefaultPlotModeForLayer(
  layer: LayerLikeForPlotMode | null | undefined,
): DefaultPlotModeId {
  if (!layer) return 'histogram';
  const ts = layer.timeSeriesInfo;
  if (ts && ts.num_timepoints >= 2) return 'crosshair-time-series';
  return 'histogram';
}

/**
 * Reactive selector hook: returns the default plot mode id for the currently
 * selected layer. Re-renders the consumer only when the resolved id flips.
 */
export function useDefaultPlotModeForActiveLayer(): DefaultPlotModeId {
  return useLayerStore((state) => {
    const id = state.selectedLayerId;
    if (!id) return 'histogram';
    const layer = state.layers.find((l) => l.id === id) as LayerLikeForPlotMode | undefined;
    return getDefaultPlotModeForLayer(layer);
  });
}

/**
 * Pure helper: returns the id of the first mode in `modes` whose `supports`
 * function reports `{ supported: true }` for `ctx`, or `undefined` if none
 * qualify. Used as the transient fallback for manual user picks that become
 * unsupported after an active-layer change.
 */
export function pickFirstSupportedMode(
  modes: readonly PlotMode[],
  ctx: PlotModeContext,
): string | undefined {
  for (const m of modes) {
    if (m.supports(ctx).supported) return m.id;
  }
  return undefined;
}

export interface PlotModeSelectionInput {
  /** Registered plot modes, in the same order PlotHost will display them. */
  readonly modes: readonly PlotMode[];
  /** PlotHost mode context for the active layer / crosshair / size. */
  readonly layerCtx: PlotModeContext;
}

export interface PlotModeSelection {
  /** Effective mode id to pass to PlotHost (may differ from store value during transient fallback). */
  readonly modeId: string | undefined;
  /** Wire to PlotHost.onModeChange. Records the click as a user pick. */
  readonly onModeChange: (id: string) => void;
}

/**
 * Selection-policy state machine described in mote
 * `bd-01KQK24YYRXCDJKAPE6SBB84JE`.
 *
 * Behavior (matches the four ACs in the mote):
 *   1. On first mount the store is populated with the auto default for the
 *      active layer (`getDefaultPlotModeForLayer`) and `selectionSource =
 *      'auto'`.
 *   2. While `selectionSource === 'auto'`, the active mode re-derives
 *      whenever the active-layer-derived default flips (3D → histogram,
 *      4D → crosshair-time-series, …).
 *   3. A manual user pick (PlotHost tab click → `onModeChange` here, or the
 *      Inspector's "Open in Plot" via `usePlotModeStore.setActivePlotMode`)
 *      sets `selectionSource = 'user'` and is preserved across active-layer
 *      changes for as long as the chosen mode is supported.
 *   4. If the user-chosen mode becomes unsupported for the new layer
 *      (e.g. crosshair-time-series with a 3D layer), the *visible* mode
 *      transiently falls back to the first supported mode. The store value
 *      and `selectionSource` are NOT mutated — when the layer changes back
 *      to a supporting one, the user pick is restored.
 */
export function usePlotModeSelection({
  modes,
  layerCtx,
}: PlotModeSelectionInput): PlotModeSelection {
  const activeId = usePlotModeStore((s) => s.activePlotModeId);
  const selectionSource = usePlotModeStore((s) => s.selectionSource);
  const setActivePlotMode = usePlotModeStore((s) => s.setActivePlotMode);
  const setAutoActivePlotMode = usePlotModeStore((s) => s.setAutoActivePlotMode);

  // ----- Auto-default driven by the active layer ----------------------------
  // We re-read the layer via `getState()` (rather than subscribing to the
  // full layer object) and key only on `layerCtx.layerId`, since the
  // resolver only depends on the layer's 4D-ness. Subscribing to the full
  // layer would re-run on render-prop changes that are irrelevant here.
  const autoDefault = useMemo<DefaultPlotModeId>(() => {
    if (!layerCtx.layerId) return getDefaultPlotModeForLayer(undefined);
    const layer = useLayerStore.getState().layers.find((l) => l.id === layerCtx.layerId) as
      | LayerLikeForPlotMode
      | undefined;
    return getDefaultPlotModeForLayer(layer);
  }, [layerCtx.layerId]);

  // Initialize on mount + adapt on auto. `setAutoActivePlotMode` is a no-op
  // when `selectionSource === 'user'`, so this single effect covers AC#1
  // (mount default) and AC#2 (adapt-while-auto) without an init ref.
  useEffect(() => {
    if (activeId === autoDefault && selectionSource === 'auto') return;
    if (selectionSource === 'user' && activeId !== null) return;
    setAutoActivePlotMode(autoDefault);
  }, [autoDefault, activeId, selectionSource, setAutoActivePlotMode]);

  // ----- Resolved (visible) mode id ----------------------------------------
  // For `auto`: pass the store value through. For `user`: keep the user's
  // pick if it's supported, otherwise transient fall back to the first
  // supported mode. The store is NOT mutated by the fallback.
  const resolvedModeId = useMemo<string | undefined>(() => {
    if (!activeId) return undefined;
    if (selectionSource !== 'user') return activeId;
    const mode = modes.find((m) => m.id === activeId);
    if (mode && mode.supports(layerCtx).supported) return activeId;
    return pickFirstSupportedMode(modes, layerCtx) ?? activeId;
  }, [activeId, selectionSource, modes, layerCtx]);

  const onModeChange = useCallback(
    (id: string) => {
      setActivePlotMode(id);
    },
    [setActivePlotMode],
  );

  return { modeId: resolvedModeId, onModeChange };
}

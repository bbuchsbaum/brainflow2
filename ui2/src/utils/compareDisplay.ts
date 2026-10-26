/**
 * Linked Compare (UI redesign phase 3, item 9). Compare panels share their
 * display (window, threshold, colormap) per the workspace's link mode: "all"
 * (the default and today's behaviour), "window", "threshold" or "none". A
 * property that is not shared is set per panel: the Inspector edits the
 * active panel, stored as that panel's `renderOverrides` and merged over the
 * shared layer state when the panel renders.
 */
import { useMemo } from 'react';
import { useComparisonStore } from '@/stores/comparisonStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { ViewLayer } from '@/types/viewState';
import {
  LINKED_FIELDS,
  panelLetter,
  type CompareLinkMode,
  type ComparisonPanelConfig,
  type LayerRenderOverride,
  type PanelOverrideField,
} from '@/types/comparison';

type CompareState = ReturnType<typeof useComparisonStore.getState>;

export function linkModeOf(
  state: Pick<CompareState, 'linkModes'>,
  workspaceId: string,
): CompareLinkMode {
  return state.linkModes.get(workspaceId) ?? 'all';
}

/** True when every display property is shared (no override applies). */
export function isDisplayLinked(
  state: Pick<CompareState, 'linkModes'>,
  workspaceId: string,
): boolean {
  return linkModeOf(state, workspaceId) === 'all';
}

export function isFieldLinked(mode: CompareLinkMode, field: PanelOverrideField): boolean {
  return LINKED_FIELDS[mode].includes(field);
}

/** A layer with a panel's overrides of the unshared fields merged in. */
export function applyLayerOverride(
  layer: ViewLayer,
  override: LayerRenderOverride | undefined,
  mode: CompareLinkMode = 'none',
): ViewLayer {
  if (!override) return layer;
  const own = (field: PanelOverrideField) =>
    override[field] !== undefined && !isFieldLinked(mode, field);
  return {
    ...layer,
    ...(own('intensity') ? { intensity: override.intensity! } : {}),
    ...(own('threshold') ? { threshold: override.threshold! } : {}),
    ...(own('colormap') ? { colormap: override.colormap! } : {}),
  };
}

/** The panel's layers as it renders them under a link mode. */
export function panelDisplayLayers(
  layers: readonly ViewLayer[],
  panel: Pick<ComparisonPanelConfig, 'renderOverrides'>,
  mode: CompareLinkMode,
): ViewLayer[] {
  if (mode === 'all' || !panel.renderOverrides) return layers as ViewLayer[];
  return layers.map((layer) => applyLayerOverride(layer, panel.renderOverrides?.[layer.id], mode));
}

/** True when a panel shows a value of its own for some unshared field. */
export function panelHasOverrides(
  panel: Pick<ComparisonPanelConfig, 'renderOverrides'>,
  mode: CompareLinkMode,
): boolean {
  if (mode === 'all' || !panel.renderOverrides) return false;
  return Object.values(panel.renderOverrides).some((o) =>
    (Object.keys(o) as PanelOverrideField[]).some(
      (f) => o[f] !== undefined && !isFieldLinked(mode, f),
    ),
  );
}

/**
 * Panels thresholding the same layer differently (v2 user critic): the
 * effective [lo, hi] per panel letter, when they differ. Null otherwise.
 */
export function thresholdMismatch(
  panels: readonly ComparisonPanelConfig[],
  layers: readonly ViewLayer[],
  mode: CompareLinkMode,
): { layerId: string; thresholds: Array<{ letter: string; threshold: [number, number] }> } | null {
  if (isFieldLinked(mode, 'threshold')) return null;
  for (const layer of layers) {
    const showing = panels
      .map((panel, i) => ({ panel, letter: panelLetter(i) }))
      .filter(({ panel }) => panel.visibleLayerIds.has(layer.id));
    if (showing.length < 2) continue;
    const thresholds = showing.map(({ panel, letter }) => ({
      letter,
      threshold: applyLayerOverride(layer, panel.renderOverrides?.[layer.id], mode).threshold as [
        number,
        number,
      ],
    }));
    const [first] = thresholds;
    const differs = thresholds.some(
      (t) => t.threshold[0] !== first.threshold[0] || t.threshold[1] !== first.threshold[1],
    );
    if (differs) return { layerId: layer.id, thresholds };
  }
  return null;
}

export interface ActiveComparePanel {
  panel: ComparisonPanelConfig;
  index: number;
  letter: string;
}

/** The unlinked edit target: the chosen panel, else the first one. */
export function resolveActivePanel(
  state: Pick<CompareState, 'panels' | 'activePanelIds'>,
  workspaceId: string,
): ActiveComparePanel | null {
  const panels = state.panels.get(workspaceId) ?? [];
  if (panels.length === 0) return null;
  const chosen = state.activePanelIds.get(workspaceId);
  const index = Math.max(
    0,
    panels.findIndex((p) => p.id === chosen),
  );
  return { panel: panels[index], index, letter: panelLetter(index) };
}

export interface CompareEditTarget extends ActiveComparePanel {
  workspaceId: string;
  mode: CompareLinkMode;
  /** 'panel': unshared edits go to the active panel; 'all': to every panel. */
  scope: 'panel' | 'all';
  panelCount: number;
  letters: string[];
}

function activeComparisonWorkspaceId(): string | null {
  const ws = useWorkspaceStore.getState().getActiveWorkspace?.();
  return ws?.type === 'comparison' ? ws.id : null;
}

/** Where Inspector display edits go right now (null: the shared display, as always). */
export function compareEditTarget(
  state: CompareState = useComparisonStore.getState(),
  workspaceId: string | null = activeComparisonWorkspaceId(),
): CompareEditTarget | null {
  if (!workspaceId) return null;
  const mode = linkModeOf(state, workspaceId);
  if (mode === 'all') return null;
  const active = resolveActivePanel(state, workspaceId);
  if (!active) return null;
  const panels = state.panels.get(workspaceId) ?? [];
  return {
    ...active,
    workspaceId,
    mode,
    scope: state.editScopes.get(workspaceId) ?? 'panel',
    panelCount: panels.length,
    letters: panels.map((_, i) => panelLetter(i)),
  };
}

/** Hook form of {@link compareEditTarget} (re-renders on compare or workspace changes). */
export function useCompareEditTarget(): CompareEditTarget | null {
  const workspaceId = useWorkspaceStore((s) => {
    const ws = s.activeWorkspaceId ? s.getWorkspace(s.activeWorkspaceId) : null;
    return ws?.type === 'comparison' ? ws.id : null;
  });
  const mode = useComparisonStore((s) => (workspaceId ? linkModeOf(s, workspaceId) : 'all'));
  const panels = useComparisonStore((s) => (workspaceId ? s.panels.get(workspaceId) : undefined));
  const activeId = useComparisonStore((s) =>
    workspaceId ? s.activePanelIds.get(workspaceId) : undefined,
  );
  const scope = useComparisonStore((s) =>
    workspaceId ? s.editScopes.get(workspaceId) : undefined,
  );
  return useMemo(
    () => compareEditTarget(useComparisonStore.getState(), workspaceId),
    // The selected primitives are the inputs compareEditTarget reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId, mode, panels, activeId, scope],
  );
}

/** The panel's own layer: its topmost layer in composite order. */
export function panelLayerIdOf(
  panel: Pick<ComparisonPanelConfig, 'visibleLayerIds'>,
  layers: readonly Pick<ViewLayer, 'id'>[],
): string | null {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    if (panel.visibleLayerIds.has(layers[i].id)) return layers[i].id;
  }
  return null;
}

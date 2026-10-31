/**
 * Compare panes (QA features 2026-10-31 §6): Compare opens with two panes,
 * a pane-count control offers 2, 3 or 4, and each pane picks its layer in
 * its header; the anatomy is drawn under every pane (resolvePanelUnderlayId).
 */

/** Pane counts the toolbar offers. */
export const COMPARE_PANE_COUNTS = [2, 3, 4] as const;

/** Panes a new Compare tab opens with (it used to open one per layer). */
export const DEFAULT_COMPARE_PANES = 2;

/**
 * The layers new panes take, in order: the maps over the anatomy (stack
 * order), then the anatomy itself, so a single map is compared with its
 * anatomy. The anatomy is the base: the first non-atlas layer, the same rule
 * as the underlay every pane draws.
 */
export function comparePaneCandidates(
  visibleLayerIds: readonly string[],
  layers: ReadonlyArray<{ id: string; source?: string }>,
): string[] {
  const base = layers.find((layer) => layer.source !== 'atlas')?.id;
  const maps = visibleLayerIds.filter((id) => id !== base);
  return base && visibleLayerIds.includes(base) ? [...maps, base] : maps;
}

/**
 * The pane header picker's choices: the tab's VISIBLE layers by the
 * {@link comparePaneCandidates} rule (a pane draws only visible layers, and
 * frames on its first visible one, so a hidden pick showed only the anatomy).
 * The pane's current layer stays listed, marked "(hidden)", once it is hidden.
 */
export function comparePickerOptions(
  workspaceLayers: ReadonlyArray<{ id: string; visible: boolean }>,
  loadedLayers: ReadonlyArray<{ id: string; name?: string; source?: string; volumeId?: string | null }>,
  currentLayerId: string | null,
): Array<{ id: string; name: string }> {
  const byId = new Map(loadedLayers.map((l) => [l.id, l]));
  const visibleIds = workspaceLayers.filter((l) => l.visible).map((l) => l.id);
  const options = comparePaneCandidates(visibleIds, loadedLayers)
    .filter((id) => byId.get(id)?.volumeId)
    .map((id) => ({ id, name: byId.get(id)?.name ?? id }));
  if (currentLayerId && !options.some((o) => o.id === currentLayerId)) {
    const current = byId.get(currentLayerId);
    if (current) options.push({ id: currentLayerId, name: `${current.name ?? currentLayerId} (hidden)` });
  }
  return options;
}

/**
 * The anatomy drawn under an overlay-only pane: the base (first non-atlas
 * layer), unless the pane shows it or nothing. Same rule as
 * ComparisonRenderService's resolvePanelUnderlayId (the renderer), for the
 * pane's crosshair clip.
 */
export function paneUnderlayId(
  visibleLayerIds: ReadonlySet<string>,
  layers: ReadonlyArray<{ id: string; source?: string }>,
): string | null {
  if (visibleLayerIds.size === 0) return null;
  const base = layers.find((layer) => layer.source !== 'atlas');
  return !base || visibleLayerIds.has(base.id) ? null : base.id;
}

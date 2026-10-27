/**
 * Which run layers the Series view shows (round 3 C3). Runs share a grid, so
 * the view shows the focused run and hides the others, and the anatomy under
 * an opaque EPI, but only by explicit events: once when a run group forms, and
 * when the user activates a different run through the plot. It never fights
 * the user: a layer whose visibility no longer matches what the view last set
 * belongs to the user from then on, and "This layer only" restores what the
 * view changed.
 */
import { getLayerService } from '@/services/LayerService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { SegmentGroup } from './seriesSegments';

interface Tracked {
  /** Visibility before the view first changed it. */
  original: boolean;
  /** What the view last set. */
  lastSet: boolean;
}

const tracked = new Map<string, Map<string, Tracked>>();
/**
 * Layers whose visibility the user set against the view: no later group
 * hides them again (REVIEW m4: "All 3 4D layers" re-hid a T1 the user showed).
 */
const userChoice = new Set<string>();
/** Series views showing each group (several Plot docks can show one series): the last to leave restores. */
const holders = new Map<string, number>();

const viewVisible = (id: string) =>
  useViewStateStore.getState().viewState?.layers?.find?.((l) => l.id === id)?.visible ?? isVisible(id);
const isVisible = (id: string) =>
  useLayerStore.getState().layers?.find?.((l) => l.id === id)?.visible !== false;

/** The view still owns a layer while its visibility is what the view last set. */
const owned = (key: string, id: string) => {
  const t = tracked.get(key)?.get(id);
  return !!t && isVisible(id) === t.lastSet;
};

function setVisible(key: string, id: string, want: boolean): void {
  let layers = tracked.get(key);
  if (!layers) {
    layers = new Map();
    tracked.set(key, layers);
  }
  const current = isVisible(id);
  const t = layers.get(id);
  // A layer the user changed since the view last set it is the user's.
  if (t && current !== t.lastSet) {
    userChoice.add(id);
    return;
  }
  if (!want && userChoice.has(id)) return;
  if (!t) layers.set(id, { original: viewVisible(id), lastSet: want });
  else t.lastSet = want;
  // The view state can disagree with the layer store (a layer added hidden):
  // what is drawn must follow too.
  if (current !== want || viewVisible(id) !== want) getLayerService().toggleVisibility(id, want);
}

const runIds = (group: SegmentGroup) => [...new Set(group.segments.map((s) => s.layerId))];

/** Volumes drawn under the runs (the anatomy an opaque EPI would hide anyway). */
function baseIds(group: SegmentGroup): string[] {
  const layers = useLayerStore.getState().layers ?? [];
  const runs = new Set(runIds(group));
  const lowest = Math.min(...layers.filter((l) => runs.has(l.id)).map((l) => l.order ?? 0));
  return layers
    .filter((l) => !runs.has(l.id) && l.type !== 'label' && l.volumeId && (l.order ?? 0) < lowest)
    .map((l) => l.id);
}

/** Once per group: show the focused run only, over nothing. Sidecar groups are one layer. */
export function formRunGroup(group: SegmentGroup, focusedId: string): void {
  if (group.source === 'sidecar') return;
  holders.set(group.key, (holders.get(group.key) ?? 0) + 1);
  if (tracked.has(group.key)) return;
  tracked.set(group.key, new Map());
  for (const id of runIds(group)) setVisible(group.key, id, id === focusedId);
  for (const id of baseIds(group)) setVisible(group.key, id, false);
}

/** The user activated another run through the plot: show it; hide the previous one if the view showed it. */
export function activateRun(
  group: SegmentGroup,
  targetId: string,
  previousId: string | undefined,
): void {
  if (group.source === 'sidecar' || targetId === previousId) return;
  if (!tracked.has(group.key)) tracked.set(group.key, new Map());
  if (!isVisible(targetId)) setVisible(group.key, targetId, true);
  if (
    previousId &&
    owned(group.key, previousId) &&
    tracked.get(group.key)!.get(previousId)!.lastSet
  )
    setVisible(group.key, previousId, false);
}

/** "This layer only" (the group dissolves): undo what the view changed and the user did not. */
export function restoreRunGroup(key: string): void {
  const held = (holders.get(key) ?? 1) - 1;
  if (held > 0) {
    holders.set(key, held);
    return;
  }
  holders.delete(key);
  const layers = tracked.get(key);
  if (!layers) return;
  tracked.delete(key);
  for (const [id, t] of layers) {
    if (isVisible(id) !== t.lastSet) userChoice.add(id);
    else if (t.original !== t.lastSet) getLayerService().toggleVisibility(id, t.original);
  }
}

/** Test hook. */
export function resetRunVisibility(): void {
  tracked.clear();
  userChoice.clear();
  holders.clear();
}

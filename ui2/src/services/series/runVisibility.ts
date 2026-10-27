/**
 * Which run layers the Series view shows (round 3 C3, native R3-1). Runs share
 * a grid, so the view shows the focused run and hides the others, and the
 * anatomy under an opaque EPI. It acts on explicit events only: once when a
 * run group forms, and when the user activates a different run (through the
 * plot, the Inspector or the layer list).
 *
 * What is drawn is the view state, so that is the truth here. A layer stays
 * the view's until the USER toggles it (noteUserVisibility, called by the
 * Visible switch, the layer list and the toggle keys); nothing else counts
 * as a user choice. Natively, a run's own load or GPU promotion could re-show
 * it after the view hid it, and the old "differs from what the view set means
 * the user did it" rule then gave that run to the user for good: run-2 was
 * never hidden again. Now such a change is undone (enforce), and only real
 * user toggles are respected. "This layer only" (or leaving the Series view)
 * restores what the view changed.
 */
import { getLayerService } from '@/services/LayerService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import type { SegmentGroup } from './seriesSegments';
import { asView, isUserVisibility, resetVisibilityIntent } from './visibilityIntent';

interface Tracked {
  /** Visibility before the view first changed it. */
  original: boolean;
  /** What the view wants. */
  lastSet: boolean;
}

const tracked = new Map<string, Map<string, Tracked>>();
/** Series views showing each group (several Plot docks can show one series): the last to leave restores. */
const holders = new Map<string, number>();

const storeVisible = (id: string) =>
  useLayerStore.getState().layers?.find?.((l) => l.id === id)?.visible !== false;
/** What is drawn (the view state), else the layer store. */
const drawn = (id: string) =>
  useViewStateStore.getState().viewState?.layers?.find?.((l) => l.id === id)?.visible ??
  storeVisible(id);

let applying = false;
const userChoice = { has: (id: string) => isUserVisibility(id) };
const exists = (id: string) => !!useLayerStore.getState().layers?.some?.((l) => l.id === id);
function apply(id: string, visible: boolean): void {
  if (!exists(id) || (drawn(id) === visible && storeVisible(id) === visible)) return;
  applying = true;
  try {
    asView(() => getLayerService().toggleVisibility(id, visible));
  } finally {
    applying = false;
  }
}

function setVisible(key: string, id: string, want: boolean): void {
  if (userChoice.has(id)) return;
  let layers = tracked.get(key);
  if (!layers) {
    layers = new Map();
    tracked.set(key, layers);
  }
  const t = layers.get(id);
  if (!t) layers.set(id, { original: drawn(id), lastSet: want });
  else t.lastSet = want;
  apply(id, want);
}

/**
 * Undo changes nobody asked for: a tracked layer the user has not toggled
 * shows what the view wants (a load completion or promotion re-showed it).
 */
function enforce(): void {
  if (applying) return;
  for (const layers of tracked.values())
    for (const [id, t] of layers)
      if (!userChoice.has(id) && drawn(id) !== t.lastSet) apply(id, t.lastSet);
}

let unsubscribe: (() => void) | null = null;
function watch(): void {
  if (unsubscribe || typeof useViewStateStore.subscribe !== 'function') return;
  unsubscribe = useViewStateStore.subscribe(() => enforce());
}
function unwatch(): void {
  if (tracked.size > 0 || !unsubscribe) return;
  unsubscribe();
  unsubscribe = null;
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
  watch();
}

/** The user activated another run: show it, and hide the previous one the view showed. */
export function activateRun(
  group: SegmentGroup,
  targetId: string,
  previousId: string | undefined,
): void {
  if (group.source === 'sidecar' || targetId === previousId) return;
  if (!tracked.has(group.key)) tracked.set(group.key, new Map());
  setVisible(group.key, targetId, true);
  const previous = previousId ? tracked.get(group.key)!.get(previousId) : undefined;
  if (previousId && previous?.lastSet) setVisible(group.key, previousId, false);
  watch();
}

/** "This layer only" (the group dissolves) or the last Series view leaves: undo what the view changed. */
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
  for (const [id, t] of layers)
    if (!userChoice.has(id) && t.original !== t.lastSet) apply(id, t.original);
  unwatch();
}

/** Test hook. */
export function resetRunVisibility(): void {
  tracked.clear();
  resetVisibilityIntent();
  holders.clear();
  unsubscribe?.();
  unsubscribe = null;
}

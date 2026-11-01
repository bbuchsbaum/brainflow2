/**
 * Undo for scene edits (QA features 2026-10-31 §4, QA 2026-10-30 F28 / C7).
 *
 * - **What is undoable:** a layer's visibility, opacity, colormap, intensity
 *   window, threshold, blend mode, interpolation and label outline / display
 *   mode; the layer order; removing a layer. Loads, Studio actions and
 *   layout changes are not, and nothing else is recorded: a step is made only
 *   where the user's edit enters the services (`record`, `recordOrder`,
 *   `recordRemoval`), so programmatic writes (histogram refinement, Series
 *   visibility, palettes, image-set swaps) never become steps.
 * - **How a step is made:** the tracked fields of the workspace's layers are
 *   read before and after the edit; the difference is the step. A slider
 *   drag is one step: edits with the same key coalesce while the pointer that
 *   started them is held, or (keyboard) while they follow each other within
 *   {@link COALESCE_MS}. An edit that ends where it started is no step.
 * - **Removal:** undone by reopening the source (file or template) through the
 *   normal load path into the workspace it was removed from, then giving the
 *   new layer the saved display settings and stack position. The reopened
 *   layer has a new id; the workspace's other steps follow it. If the
 *   workspace closed meanwhile the undo is dropped.
 * - **History:** per workspace (the active one), at most {@link HISTORY_LIMIT}
 *   steps, cleared when the workspace closes. A step whose layers are all
 *   gone (removed by a non-undoable path) is skipped.
 * - **Keys:** ⌘Z / ⇧⌘Z and Edit › Undo / Redo. In a text field both keep the
 *   field's own undo (`runEditCommand`).
 */
import { getEventBus } from '@/events/EventBus';
import { getLayerService } from '@/services/LayerService';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { focusVolumeLayer } from '@/stores/inspectorSelectionStore';
import type { ViewLayer } from '@/types/viewState';
import type { Layer } from '@/types/layers';
import { addLogEntry } from '@/stores/logStore';
import { useComparisonStore } from '@/stores/comparisonStore';
import { preserveLayerDisplay } from './restoredDisplay';
import type { LayerRenderOverride } from '@/types/comparison';
import { removeLayerFromScene } from './layerRemoval';
import { isTextEditingElement } from '@/utils/editSelectAll';

export { isTextEditingElement };

/** Steps kept per workspace. */
export const HISTORY_LIMIT = 50;
/** Keyboard edits of one control this close together are one step. */
export const COALESCE_MS = 700;

const TRACKED = [
  'visible',
  'opacity',
  'colormap',
  'intensity',
  'threshold',
  'blendMode',
  'interpolation',
  'outline',
  'labelDisplay',
] as const;
type TrackedField = (typeof TRACKED)[number];
export type LayerDisplay = Partial<Pick<ViewLayer, TrackedField>>;

interface DisplayChange {
  layerId: string;
  before: LayerDisplay;
  after: LayerDisplay;
}

/** Per Compare panel id: its `renderOverrides` (layer id → fields), undefined when it has none. */
type PanelOverrides = Record<string, Record<string, LayerRenderOverride> | undefined>;

interface OverrideChange {
  workspaceId: string;
  before: PanelOverrides;
  after: PanelOverrides;
}

interface OrderSnapshot {
  ids: string[];
  userMoved: Record<string, boolean>;
}

/** What it takes to reopen a removed layer as it was. */
export interface RemovedLayer {
  workspaceId: string;
  name: string;
  source: 'file' | 'template';
  sourcePath: string;
  display: LayerDisplay;
  /** Layer below / above it in the stack (bottom first), and its index. */
  belowId: string | null;
  aboveId: string | null;
  index: number;
  userMoved: boolean;
}

export type SceneStep =
  | {
      kind: 'display';
      key: string;
      label: string;
      changes: DisplayChange[];
      /** Compare panel overrides (unlinked, panel scope) that the edit changed. */
      overrides: OverrideChange | null;
      /** Pointer gesture that made it (null: keyboard). */
      gesture: number | null;
      touchedAt: number;
    }
  | { kind: 'order'; label: string; before: OrderSnapshot; after: OrderSnapshot }
  | { kind: 'removal'; label: string; removed: RemovedLayer; layerId: string };

interface History {
  undo: SceneStep[];
  redo: SceneStep[];
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function pick(layer: ViewLayer): LayerDisplay {
  const out: Record<string, unknown> = {};
  for (const field of TRACKED) if (layer[field] !== undefined) out[field] = layer[field];
  return out as LayerDisplay;
}

/** The panels whose overrides an edit changed, or null. */
function diffOverrides(workspaceId: string, before: PanelOverrides, after: PanelOverrides): OverrideChange | null {
  const b: PanelOverrides = {};
  const a: PanelOverrides = {};
  for (const panelId of Object.keys(after)) {
    if (!(panelId in before) || same(before[panelId] ?? null, after[panelId] ?? null)) continue;
    b[panelId] = before[panelId];
    a[panelId] = after[panelId];
  }
  return Object.keys(a).length > 0 ? { workspaceId, before: b, after: a } : null;
}

/** Put the saved overrides back on the panels that still exist; false when none does. */
function applyOverrides(change: OverrideChange, direction: 'undo' | 'redo'): boolean {
  const values = direction === 'undo' ? change.before : change.after;
  const store = useComparisonStore.getState();
  const panels = store.panels.get(change.workspaceId);
  if (!panels?.some((p) => p.id in values)) return false;
  const next = new Map(store.panels);
  next.set(
    change.workspaceId,
    panels.map((p) => (p.id in values ? { ...p, renderOverrides: values[p.id] } : p)),
  );
  useComparisonStore.setState({ panels: next });
  return true;
}

export class SceneHistoryService {
  private readonly histories = new Map<string, History>();
  /** Applying a step: edits made meanwhile are not recorded. */
  private replaying = false;
  /** A removal being undone: other undo / redo waits for it. */
  private busy = false;
  /** Name of the removed layer being reopened (while `busy`). */
  private restoring: string | null = null;
  private pointerHeld = false;
  private gesture = 0;
  private now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  /** Pointer and workspace-closure listeners (once, services init). */
  start(): () => void {
    const offs: Array<() => void> = [];
    if (typeof window !== 'undefined') {
      const down = () => {
        this.pointerHeld = true;
        this.gesture += 1;
      };
      const up = () => {
        this.pointerHeld = false;
      };
      window.addEventListener('pointerdown', down, true);
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
      offs.push(() => {
        window.removeEventListener('pointerdown', down, true);
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
      });
    }
    let workspaces = useViewStateStore.getState().workspaceViewStates;
    offs.push(
      useViewStateStore.subscribe((state) => {
        if (state.workspaceViewStates === workspaces) return;
        workspaces = state.workspaceViewStates;
        for (const id of [...this.histories.keys()])
          if (!workspaces.has(id)) this.histories.delete(id);
      }),
    );
    return () => offs.forEach((off) => off());
  }

  private history(workspaceId: string): History {
    let h = this.histories.get(workspaceId);
    if (!h) {
      h = { undo: [], redo: [] };
      this.histories.set(workspaceId, h);
    }
    return h;
  }

  private push(workspaceId: string, step: SceneStep, keepRedo = false): void {
    const h = this.history(workspaceId);
    h.undo.push(step);
    if (h.undo.length > HISTORY_LIMIT) h.undo.splice(0, h.undo.length - HISTORY_LIMIT);
    if (!keepRedo) h.redo = [];
  }

  private snapshot(workspaceId: string): Map<string, LayerDisplay> {
    const views = useViewStateStore.getState();
    const state =
      views.activeWorkspaceKey === workspaceId ? views.viewState : views.workspaceViewStates?.get(workspaceId);
    return new Map((state?.layers ?? []).map((l) => [l.id, pick(l)]));
  }

  /** The layer being restored by an undo still loading, else null. */
  restoringName(): string | null {
    return this.busy ? this.restoring : null;
  }

  canUndo(workspaceId = useViewStateStore.getState().activeWorkspaceKey): boolean {
    return (this.histories.get(workspaceId)?.undo.length ?? 0) > 0;
  }

  canRedo(workspaceId = useViewStateStore.getState().activeWorkspaceKey): boolean {
    return (this.histories.get(workspaceId)?.redo.length ?? 0) > 0;
  }

  /** The steps of a workspace (tests, diagnostics). */
  steps(workspaceId = useViewStateStore.getState().activeWorkspaceKey): Readonly<History> {
    return this.history(workspaceId);
  }

  /**
   * Run a user's display edit of the active workspace and record what it
   * changed. `key` names the control ("opacity:<layer>"): consecutive edits
   * with the same key during one drag (or keyboard burst) are one step.
   */
  record<T>(key: string, label: string, edit: () => T): T {
    if (this.replaying) return edit();
    const workspaceId = useViewStateStore.getState().activeWorkspaceKey;
    const before = this.snapshot(workspaceId);
    const overridesBefore = this.overrideSnapshot(workspaceId);
    const result = edit();
    const after = this.snapshot(workspaceId);
    const overridesAfter = this.overrideSnapshot(workspaceId);
    const changes: DisplayChange[] = [];
    for (const [layerId, next] of after) {
      const prev = before.get(layerId);
      if (!prev) continue;
      const b: Record<string, unknown> = {};
      const a: Record<string, unknown> = {};
      for (const field of TRACKED) {
        if (!same(prev[field], next[field])) {
          b[field] = prev[field];
          a[field] = next[field];
        }
      }
      if (Object.keys(a).length > 0)
        changes.push({ layerId, before: b as LayerDisplay, after: a as LayerDisplay });
    }
    const overrides = diffOverrides(workspaceId, overridesBefore, overridesAfter);
    if (changes.length > 0 || overrides) this.addDisplay(workspaceId, key, label, changes, overrides);
    return result;
  }

  /** The Compare panels' own overrides in a workspace ({} outside Compare). */
  private overrideSnapshot(workspaceId: string): PanelOverrides {
    const panels = useComparisonStore.getState().panels?.get(workspaceId) ?? [];
    return Object.fromEntries(panels.map((p) => [p.id, p.renderOverrides]));
  }

  private addDisplay(
    workspaceId: string,
    key: string,
    label: string,
    changes: DisplayChange[],
    overrides: OverrideChange | null = null,
  ): void {
    const h = this.history(workspaceId);
    const top = h.undo[h.undo.length - 1];
    const now = this.now();
    const gesture = this.pointerHeld ? this.gesture : null;
    const coalesce =
      top?.kind === 'display' &&
      top.key === key &&
      (top.gesture !== null
        ? top.gesture === gesture
        : gesture === null && now - top.touchedAt < COALESCE_MS);
    if (!coalesce || top?.kind !== 'display') {
      this.push(workspaceId, {
        kind: 'display',
        key,
        label,
        changes,
        overrides,
        gesture,
        touchedAt: now,
      });
      return;
    }
    if (overrides) {
      top.overrides ??= { workspaceId, before: {}, after: {} };
      for (const panelId of Object.keys(overrides.after)) {
        if (!(panelId in top.overrides.before)) top.overrides.before[panelId] = overrides.before[panelId];
        top.overrides.after[panelId] = overrides.after[panelId];
      }
      for (const panelId of Object.keys(top.overrides.after)) {
        if (same(top.overrides.before[panelId] ?? null, top.overrides.after[panelId] ?? null)) {
          delete top.overrides.before[panelId];
          delete top.overrides.after[panelId];
        }
      }
      if (Object.keys(top.overrides.after).length === 0) top.overrides = null;
    }
    for (const change of changes) {
      const prior = top.changes.find((c) => c.layerId === change.layerId);
      if (!prior) {
        top.changes.push(change);
        continue;
      }
      for (const field of Object.keys(change.after) as TrackedField[]) {
        if (!(field in prior.before))
          (prior.before as Record<string, unknown>)[field] = change.before[field];
        (prior.after as Record<string, unknown>)[field] = change.after[field];
      }
    }
    top.touchedAt = now;
    h.redo = [];
    // Dragged back to where it started: no step.
    top.changes = top.changes.filter((c) =>
      (Object.keys(c.after) as TrackedField[]).some((f) => !same(c.before[f], c.after[f])),
    );
    if (top.changes.length === 0 && !top.overrides) h.undo.pop();
  }

  /** Record a user's reorder of the layer stack (`ids` bottom first) and run it. */
  async recordOrder(ids: string[], movedId: string, run: () => Promise<void>): Promise<void> {
    if (this.replaying) return run();
    const workspaceId = useViewStateStore.getState().activeWorkspaceKey;
    const before = this.orderSnapshot();
    await run();
    const after = this.orderSnapshot();
    after.userMoved[movedId] = true;
    if (same(before.ids, after.ids) && same(before.userMoved, after.userMoved)) return;
    if (!useViewStateStore.getState().workspaceViewStates.has(workspaceId)) return;
    this.push(workspaceId, { kind: 'order', label: 'Layer order', before, after });
  }

  private orderSnapshot(): OrderSnapshot {
    const layers = useLayerStore.getState().layers;
    return {
      ids: layers.map((l) => l.id),
      userMoved: Object.fromEntries(layers.map((l) => [l.id, l.userMoved === true])),
    };
  }

  /**
   * What a removal must save to be undone, read before the layer goes; null
   * when its source cannot be reopened (an atlas, a parcel table, an image-set
   * member) or it is not in the active workspace.
   */
  captureRemoval(layerId: string): RemovedLayer | null {
    if (this.replaying) return null;
    const workspaceId = useViewStateStore.getState().activeWorkspaceKey;
    const layers = useLayerStore.getState().layers;
    const index = layers.findIndex((l) => l.id === layerId);
    const layer = layers[index];
    const viewLayer = useViewStateStore
      .getState()
      .workspaceViewStates.get(workspaceId)
      ?.layers.find((l) => l.id === layerId);
    if (!layer || !viewLayer || !layer.sourcePath || layer.imageSetId) return null;
    const source =
      layer.source === 'file'
        ? 'file'
        : layer.source === 'template' && layer.sourcePath.startsWith('template:')
          ? 'template'
          : null;
    if (!source) return null;
    return {
      workspaceId,
      name: layer.name ?? layerId,
      source,
      sourcePath: layer.sourcePath,
      display: pick(viewLayer),
      belowId: layers[index - 1]?.id ?? null,
      aboveId: layers[index + 1]?.id ?? null,
      index,
      userMoved: layer.userMoved === true,
    };
  }

  /** The removal of `layerId` happened: it becomes a step. Returns it (the toast's Undo). */
  commitRemoval(layerId: string, removed: RemovedLayer, keepRedo = false): SceneStep | null {
    if (!useViewStateStore.getState().workspaceViewStates.has(removed.workspaceId)) return null;
    const step: SceneStep = { kind: 'removal', label: `Remove ${removed.name}`, removed, layerId };
    this.push(removed.workspaceId, step, keepRedo);
    return step;
  }

  async undo(): Promise<boolean> {
    return this.step('undo');
  }

  async redo(): Promise<boolean> {
    return this.step('redo');
  }

  /** Undo one particular step (the toast's Undo), wherever it is in the history. */
  async undoStep(step: SceneStep): Promise<boolean> {
    if (this.busy) return false;
    for (const [workspaceId, h] of this.histories) {
      const at = h.undo.indexOf(step);
      if (at < 0) continue;
      if (workspaceId !== useViewStateStore.getState().activeWorkspaceKey) return false;
      h.undo.splice(at, 1);
      return this.apply(workspaceId, step, 'undo');
    }
    return false;
  }

  private async step(direction: 'undo' | 'redo'): Promise<boolean> {
    if (this.busy) return false;
    const workspaceId = useViewStateStore.getState().activeWorkspaceKey;
    const h = this.histories.get(workspaceId);
    const stack = direction === 'undo' ? h?.undo : h?.redo;
    while (stack && stack.length > 0) {
      const step = stack.pop()!;
      if (await this.apply(workspaceId, step, direction)) return true;
    }
    return false;
  }

  /** Apply a step; false when nothing of it is left to apply (it is dropped). */
  private async apply(
    workspaceId: string,
    step: SceneStep,
    direction: 'undo' | 'redo',
  ): Promise<boolean> {
    const h = this.history(workspaceId);
    const opposite = direction === 'undo' ? h.redo : h.undo;
    if (step.kind === 'display') {
      const applied = this.applyDisplay(workspaceId, step.changes, direction);
      const overridden = step.overrides ? applyOverrides(step.overrides, direction) : false;
      if (!applied && !overridden) return false;
      opposite.push({ ...step, gesture: null, touchedAt: 0 });
      return true;
    }
    if (step.kind === 'order') {
      const target = direction === 'undo' ? step.before : step.after;
      const present = new Set(useLayerStore.getState().layers.map((l) => l.id));
      if (!target.ids.some((id) => present.has(id))) return false;
      this.replaying = true;
      try {
        await getLayerService().reorderLayers(
          target.ids.filter((id) => present.has(id)),
          workspaceId,
        );
        for (const [id, moved] of Object.entries(target.userMoved)) {
          if (present.has(id)) useLayerStore.getState().updateLayer(id, { userMoved: moved });
        }
      } finally {
        this.replaying = false;
      }
      opposite.push(step);
      return true;
    }
    if (direction === 'redo') {
      // Remove the reopened layer again.
      if (!useLayerStore.getState().getLayer(step.layerId)) return false;
      const removed = this.captureRemoval(step.layerId) ?? step.removed;
      this.replaying = true;
      try {
        if (!(await removeLayerFromScene(step.layerId))) return false;
      } finally {
        this.replaying = false;
      }
      this.commitRemoval(step.layerId, removed, true);
      return true;
    }
    this.busy = true;
    this.restoring = step.removed.name;
    try {
      const layer = await this.reopen(step.removed);
      // Closed meanwhile: the undo goes with its history.
      if (!useViewStateStore.getState().workspaceViewStates.has(workspaceId)) return true;
      if (!layer) {
        // The step is used up; never fall through to undo another one.
        getEventBus().emit('ui.notification', {
          type: 'warning',
          message: `Could not restore ${step.removed.name}`,
          logSource: 'layer',
        });
        return true;
      }
      this.remapLayer(workspaceId, step.layerId, layer.id);
      this.history(workspaceId).redo.push({ ...step, layerId: layer.id });
      addLogEntry({ level: 'info', source: 'layer', message: `Restored ${step.removed.name}` });
      return true;
    } finally {
      this.busy = false;
      this.restoring = null;
    }
  }

  private applyDisplay(
    workspaceId: string,
    changes: DisplayChange[],
    direction: 'undo' | 'redo',
  ): boolean {
    const views = useViewStateStore.getState();
    const state = views.workspaceViewStates.get(workspaceId);
    if (!state) return false;
    const live = changes.filter((c) => state.layers.some((l) => l.id === c.layerId));
    if (live.length === 0) return false;
    const active = views.activeWorkspaceKey === workspaceId;
    this.replaying = true;
    try {
      views.setViewState((draft) => {
        for (const change of live) {
          const values = direction === 'undo' ? change.before : change.after;
          const target = draft.layers.find((l) => l.id === change.layerId);
          if (!target) continue;
          for (const [field, value] of Object.entries(values)) {
            if (field === 'visible') continue;
            (target as unknown as Record<string, unknown>)[field] = value;
          }
        }
      }, workspaceId);
      // Visibility through the layer service: GPU residency and the layer registry follow.
      for (const change of live) {
        const values = direction === 'undo' ? change.before : change.after;
        if (values.visible === undefined) continue;
        if (active) getLayerService().toggleVisibility(change.layerId, values.visible);
        else {
          views.setViewState((draft) => {
            const target = draft.layers.find((l) => l.id === change.layerId);
            if (target) target.visible = values.visible!;
          }, workspaceId);
          useLayerStore.getState().updateLayer(change.layerId, { visible: values.visible });
        }
      }
    } finally {
      this.replaying = false;
    }
    return true;
  }

  /** Steps that named the removed layer now name its reopened copy. */
  private remapLayer(workspaceId: string, from: string, to: string): void {
    const h = this.history(workspaceId);
    const rename = (id: string) => (id === from ? to : id);
    for (const step of [...h.undo, ...h.redo]) {
      if (step.kind === 'display') {
        step.changes.forEach((c) => (c.layerId = rename(c.layerId)));
        if (step.overrides) {
          for (const side of [step.overrides.before, step.overrides.after]) {
            for (const [panelId, map] of Object.entries(side)) {
              if (map && from in map) {
                const next = { ...map, [to]: map[from] };
                delete next[from];
                side[panelId] = next;
              }
            }
          }
        }
      }
      else if (step.kind === 'order') {
        for (const snap of [step.before, step.after]) {
          snap.ids = snap.ids.map(rename);
          if (from in snap.userMoved) {
            snap.userMoved[to] = snap.userMoved[from];
            delete snap.userMoved[from];
          }
        }
      } else {
        if (step.layerId === from) step.layerId = to;
        if (step.removed.belowId === from) step.removed.belowId = to;
        if (step.removed.aboveId === from) step.removed.aboveId = to;
      }
    }
  }

  /**
   * Reopen a removed layer through the normal load path, then restore its
   * display settings and stack position. Null when the workspace closed or
   * the load did not produce the layer.
   */
  private async reopen(removed: RemovedLayer): Promise<Layer | null> {
    const { workspaceId } = removed;
    const exists = () => useViewStateStore.getState().workspaceViewStates.has(workspaceId);
    if (!exists()) return null;
    const before = new Set(useLayerStore.getState().layers.map((l) => l.id));
    let added: Layer | null = null;
    const off = getEventBus().on('layer.added', ({ layer }) => {
      const info = layer as Layer & { sourcePath?: string };
      // This request's layer: the same source, new, and committed to the
      // workspace it was removed from (not a load of the same file elsewhere).
      const inWorkspace = useViewStateStore
        .getState()
        .workspaceViewStates.get(workspaceId)
        ?.layers.some((l) => l.id === layer.id);
      if (added || before.has(layer.id) || info.sourcePath !== removed.sourcePath || !inWorkspace) return;
      added = layer;
      // Before the histogram refinement can land: the saved display wins.
      preserveLayerDisplay(layer.id);
    });
    try {
      if (removed.source === 'template') {
        const { getTemplateService } = await import('./TemplateService');
        await getTemplateService().loadTemplateBySourcePath(removed.sourcePath);
      } else {
        const { getFileLoadingService } = await import('./FileLoadingService');
        await getFileLoadingService().loadFile(
          removed.sourcePath,
          'programmatic',
          'add-layer',
          workspaceId,
        );
      }
    } catch (error) {
      console.warn('[SceneHistory] reopening the removed layer failed:', error);
    } finally {
      off();
    }
    const layer = added as Layer | null;
    if (!layer || !exists() || !useLayerStore.getState().getLayer(layer.id)) return null;

    this.replaying = true;
    try {
      const { display } = removed;
      useViewStateStore.getState().setViewState((draft) => {
        const target = draft.layers.find((l) => l.id === layer.id);
        if (!target) return;
        for (const [field, value] of Object.entries(display)) {
          if (field !== 'visible') (target as unknown as Record<string, unknown>)[field] = value;
        }
      }, workspaceId);
      if (display.visible === false) {
        if (useViewStateStore.getState().activeWorkspaceKey === workspaceId) {
          getLayerService().toggleVisibility(layer.id, false);
        } else {
          useViewStateStore.getState().setViewState((draft) => {
            const target = draft.layers.find((l) => l.id === layer.id);
            if (target) target.visible = false;
          }, workspaceId);
          useLayerStore.getState().updateLayer(layer.id, { visible: false });
        }
      }
      const others = useLayerStore
        .getState()
        .layers.map((l) => l.id)
        .filter((id) => id !== layer.id);
      const below = removed.belowId ? others.indexOf(removed.belowId) : -1;
      const above = removed.aboveId ? others.indexOf(removed.aboveId) : -1;
      const at =
        below >= 0 ? below + 1 : above >= 0 ? above : Math.min(removed.index, others.length);
      const order = [...others.slice(0, at), layer.id, ...others.slice(at)];
      await getLayerService().reorderLayers(order, workspaceId);
      if (removed.userMoved) useLayerStore.getState().updateLayer(layer.id, { userMoved: true });
      if (useViewStateStore.getState().activeWorkspaceKey === workspaceId)
        focusVolumeLayer(layer.id);
    } finally {
      this.replaying = false;
    }
    return layer;
  }

  /** Forget every history (tests). */
  clear(): void {
    this.histories.clear();
    this.busy = false;
    this.restoring = null;
    this.replaying = false;
  }
}

let instance: SceneHistoryService | null = null;
let stop: (() => void) | null = null;

export function getSceneHistory(): SceneHistoryService {
  instance ??= new SceneHistoryService();
  return instance;
}

/** Start the history's listeners (services init). */
export function initializeSceneHistory(): SceneHistoryService {
  const service = getSceneHistory();
  stop ??= service.start();
  return service;
}

/**
 * Key presses still waiting for their menu echo, oldest first: each press
 * cancels exactly one menu event of the same action that follows within
 * {@link ECHO_MS} (a quick ⌘Z ⌘Z is two presses and two echoes).
 */
const pendingEchoes: Array<{ action: 'undo' | 'redo'; at: number }> = [];
const ECHO_MS = 250;

/**
 * ⌘Z / ⇧⌘Z and Edit › Undo / Redo. In a text field the field's own undo
 * runs (the menu items are custom, so the native one no longer reaches it);
 * elsewhere the scene history. A menu event right after the key press that
 * caused it is the same command and is ignored.
 */
export function runEditCommand(action: 'undo' | 'redo', from: 'key' | 'menu'): void {
  const now = Date.now();
  while (pendingEchoes.length > 0 && now - pendingEchoes[0].at >= ECHO_MS) pendingEchoes.shift();
  if (from === 'menu') {
    const echo = pendingEchoes.findIndex((p) => p.action === action);
    if (echo >= 0) {
      pendingEchoes.splice(echo, 1);
      return;
    }
  } else {
    pendingEchoes.push({ action, at: now });
  }
  if (typeof document !== 'undefined' && isTextEditingElement(document.activeElement)) {
    if (from === 'menu') document.execCommand(action);
    return;
  }
  const history = getSceneHistory();
  const restoring = history.restoringName();
  if (restoring !== null) {
    getEventBus().emit('ui.notification', {
      type: 'info',
      message: `Restoring ${restoring}…`,
      durationMs: 1500,
      logSource: false,
    });
    return;
  }
  void (action === 'undo' ? history.undo() : history.redo()).then((done) => {
    if (!done) {
      getEventBus().emit('ui.notification', {
        type: 'info',
        message: action === 'undo' ? 'Nothing to undo' : 'Nothing to redo',
        durationMs: 1500,
        logSource: false,
      });
    }
  });
}

/** A user's show / hide of a layer (layer list, keys): one undoable step. */
export function setLayerVisibleByUser(layerId: string, visible: boolean): void {
  getSceneHistory().record(`visible:${layerId}`, 'Visibility', () =>
    getLayerService().toggleVisibility(layerId, visible),
  );
}

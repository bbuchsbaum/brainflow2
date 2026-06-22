/**
 * Pure helpers for `DisplayModeSelector` (Phase 7 of the integrated workspace
 * refactor). Lives in its own file so the React component file can satisfy the
 * `react-refresh/only-export-components` invariant and so the click-resolution
 * logic can be unit-tested without rendering.
 */

import { DISPLAY_MODES, type DisplayMode } from "@/types/displayModes";
import {
  WORKSPACE_METADATA,
  type Workspace,
  type WorkspaceType,
} from "@/types/workspace";

/**
 * Reverse map from `WorkspaceType` to the display mode it satisfies.
 *
 * Multiple workspace types may resolve to the same display mode (e.g. both
 * `orthogonal-locked` and `orthogonal-flexible` belong to `'orthogonal'`).
 * Workspaces with no display-mode pill (`set-studio`, `bids-explorer`,
 * `analysis-workbench`) are intentionally absent — they are reached through
 * the command palette / preset selector, not the mode pills.
 */
export const WORKSPACE_TYPE_TO_DISPLAY_MODE: Readonly<
  Partial<Record<WorkspaceType, DisplayMode>>
> = {
  "orthogonal-locked": "orthogonal",
  "orthogonal-flexible": "orthogonal",
  mosaic: "mosaic",
  comparison: "compare",
  integrated: "integrated",
};

/** Returns the display mode that the given workspace type belongs to, or `null`. */
export function resolveActiveDisplayMode(
  workspaceType: WorkspaceType | null | undefined,
): DisplayMode | null {
  if (!workspaceType) return null;
  return WORKSPACE_TYPE_TO_DISPLAY_MODE[workspaceType] ?? null;
}

/**
 * The display modes shown as selector pills, in render order. Surface stays
 * in the list so the UI matches the mockup, but its `defaultWorkspaceType`
 * is `null` — `DisplayModeSelector` renders it as disabled until a Surface
 * workspace type is added.
 */
export const DISPLAY_MODE_PILL_ORDER: readonly DisplayMode[] = [
  "orthogonal",
  "surface",
  "integrated",
  "mosaic",
  "compare",
];

/** Returns the metadata entries in pill render order. */
export function getDisplayModePillMetadata() {
  return DISPLAY_MODE_PILL_ORDER.map((id) => DISPLAY_MODES[id]);
}

/**
 * True when the workspace type is a "view" the mode pills govern (orthogonal /
 * mosaic / comparison / integrated). Tool destinations (set-studio,
 * bids-explorer, analysis-workbench) are NOT views — the pill has nothing to
 * switch when one of them is active, so it should be hidden.
 */
export function isViewWorkspaceType(
  workspaceType: WorkspaceType | null | undefined,
): boolean {
  return resolveActiveDisplayMode(workspaceType) !== null;
}

/**
 * The tab label to display for a workspace.
 *
 * View workspaces are labelled by their *live* display mode (e.g. "Orthogonal",
 * "Mosaic", "Compare") so the tab can never contradict the top-bar mode pill —
 * both derive from `workspace.type`, and the label updates the moment the pill
 * mutates the mode. Tool workspaces keep their descriptive name. Deriving the
 * label from `type` also sidesteps stale persisted titles and preset-label
 * overrides (`applyWorkspacePreset` stores e.g. "Read"/"Analyze").
 */
export function workspaceTabLabel(workspace: Pick<Workspace, "type">): string {
  const mode = resolveActiveDisplayMode(workspace.type);
  if (mode) {
    return DISPLAY_MODES[mode].label;
  }
  return WORKSPACE_METADATA[workspace.type]?.name ?? workspace.type;
}

type LabelWorkspace = Pick<Workspace, "id" | "type" | "timestamp">;

/**
 * Tab labels for a whole set of workspaces, keyed by workspace id.
 *
 * Same as {@link workspaceTabLabel} per workspace, but disambiguates view tabs
 * that resolve to the *same* display mode by appending an ordinal: two
 * orthogonal views become "Orthogonal" and "Orthogonal 2" (oldest first, ties
 * broken by id) so distinct destinations stay distinguishable. Tool workspaces
 * are singletons and never numbered.
 */
export function workspaceTabLabels(
  workspaces: Iterable<LabelWorkspace>,
): Map<string, string> {
  const list = [...workspaces];
  const byMode = new Map<DisplayMode, LabelWorkspace[]>();
  for (const w of list) {
    const mode = resolveActiveDisplayMode(w.type);
    if (!mode) continue;
    const group = byMode.get(mode);
    if (group) group.push(w);
    else byMode.set(mode, [w]);
  }
  for (const group of byMode.values()) {
    group.sort(
      (a, b) =>
        a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  const labels = new Map<string, string>();
  for (const w of list) {
    const base = workspaceTabLabel(w);
    const mode = resolveActiveDisplayMode(w.type);
    if (!mode) {
      labels.set(w.id, base);
      continue;
    }
    const group = byMode.get(mode);
    if (!group || group.length <= 1) {
      labels.set(w.id, base);
      continue;
    }
    const index = group.findIndex((x) => x.id === w.id);
    labels.set(w.id, index <= 0 ? base : `${base} ${index + 1}`);
  }
  return labels;
}

/**
 * Compute the GoldenLayout tab-title changes needed to reconcile rendered tabs
 * with the live workspace modes. Pure so the reconcile logic (update only on a
 * real diff, never for unknown tabs) is unit-testable without GoldenLayout.
 */
export function planTabTitleUpdates(
  items: ReadonlyArray<{
    workspaceId: string | null | undefined;
    title: string;
  }>,
  workspaces: Iterable<LabelWorkspace>,
): Array<{ workspaceId: string; title: string }> {
  const labels = workspaceTabLabels(workspaces);
  const updates: Array<{ workspaceId: string; title: string }> = [];
  for (const item of items) {
    if (!item.workspaceId) continue;
    const desired = labels.get(item.workspaceId);
    if (desired !== undefined && desired !== item.title) {
      updates.push({ workspaceId: item.workspaceId, title: desired });
    }
  }
  return updates;
}

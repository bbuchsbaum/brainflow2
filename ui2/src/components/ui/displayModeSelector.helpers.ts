/**
 * Pure helpers for `DisplayModeSelector` (Phase 7 of the integrated workspace
 * refactor). Lives in its own file so the React component file can satisfy the
 * `react-refresh/only-export-components` invariant and so the click-resolution
 * logic can be unit-tested without rendering.
 */

import { DISPLAY_MODES, type DisplayMode } from "@/types/displayModes";
import type {
  CoreWorkspaceType,
  Workspace,
  WorkspaceType,
} from "@/types/workspace";
import { getWorkspaceMetadata } from "@/services/workspaceTypes";

/**
 * Reverse map from `WorkspaceType` to the display mode it satisfies.
 *
 * Multiple workspace types may resolve to the same display mode (e.g. both
 * `orthogonal-locked` and `orthogonal-flexible` belong to `'orthogonal'`).
 * Tool workspaces (Set studio, BIDS and module tools) have no display-mode
 * pill and are intentionally absent — they are reached through the Workspace
 * menu and the command palette, not the mode pills.
 */
export const WORKSPACE_TYPE_TO_DISPLAY_MODE: Readonly<
  Partial<Record<CoreWorkspaceType, DisplayMode>>
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
  if (!workspaceType || !Object.hasOwn(WORKSPACE_TYPE_TO_DISPLAY_MODE, workspaceType)) {
    return null;
  }
  return WORKSPACE_TYPE_TO_DISPLAY_MODE[workspaceType as CoreWorkspaceType] ?? null;
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
 * mosaic / comparison / integrated). Tool destinations (Set studio, BIDS and
 * module tools) are NOT views — the pill has nothing to switch when one of
 * them is active, so it should be hidden.
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
 * overrides (`applyWorkspacePreset` stores the preset label as the title).
 */
export function workspaceTabLabel(workspace: Pick<Workspace, "type">): string {
  const mode = resolveActiveDisplayMode(workspace.type);
  if (mode) {
    return DISPLAY_MODES[mode].label;
  }
  return getWorkspaceMetadata(workspace.type)?.name ?? workspace.type;
}

type LabelWorkspace = Pick<Workspace, "id" | "type" | "timestamp" | "tabLabel">;

/** True when `label` is `base` or `base N` (N ≥ 2), a label the mode can show. */
function isLabelOfMode(label: string, base: string): boolean {
  if (label === base) return true;
  if (!label.startsWith(`${base} `)) return false;
  const ordinal = label.slice(base.length + 1);
  return /^[1-9]\d*$/.test(ordinal) && Number(ordinal) >= 2;
}

/**
 * Tab labels for a whole set of workspaces, keyed by workspace id.
 *
 * Same as {@link workspaceTabLabel} per workspace, but disambiguates view tabs
 * that resolve to the *same* display mode with an ordinal ("Orthogonal",
 * "Orthogonal 2"). Labels are stable: a tab keeps the label it last showed
 * (`tabLabel`) while it stays in that mode, and only a tab that is new to a
 * mode takes the lowest free label. So one tab's switch never renames another
 * (QA 2026-10-30 F27: switching the front tab to Orthogonal renamed a
 * different tab "Orthogonal 2"). Without remembered labels, the oldest tab of
 * a mode gets the bare name. Tool workspaces are singletons and never
 * numbered.
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

  const labels = new Map<string, string>();
  for (const w of list) {
    if (!resolveActiveDisplayMode(w.type)) labels.set(w.id, workspaceTabLabel(w));
  }
  for (const [mode, group] of byMode) {
    group.sort(
      (a, b) =>
        a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const base = DISPLAY_MODES[mode].label;
    const taken = new Set<string>();
    // Tabs already showing a label of this mode keep it.
    for (const w of group) {
      const kept = w.tabLabel;
      if (kept && isLabelOfMode(kept, base) && !taken.has(kept)) {
        taken.add(kept);
        labels.set(w.id, kept);
      }
    }
    // The rest take the lowest free label.
    for (const w of group) {
      if (labels.has(w.id)) continue;
      let label = base;
      for (let n = 2; taken.has(label); n += 1) label = `${base} ${n}`;
      taken.add(label);
      labels.set(w.id, label);
    }
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

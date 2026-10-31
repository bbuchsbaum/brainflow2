/**
 * Which persisted workspaces come back on relaunch
 * (docs/plans/qa-design-decisions-2026-10-30.md §1).
 *
 * Since 2026-10-30 every tab is one the user created — New view, "Open in new
 * tab", or a tool — because layout changes apply to the current tab in place
 * and never mint tabs. So relaunch restores them all, each with its own
 * layout (`type` + `layoutConfig`):
 *
 * - Every view workspace is kept, duplicates of a layout included.
 * - Tool workspaces (Set studio, BIDS and module tools) are singletons: one
 *   per tool is kept, the active one or else the most recent.
 * - Workspaces of an unknown type (written by another build) are dropped.
 * - Tabs of a module that is off are parked, not dropped
 *   (`partitionByModuleAvailability`); they come back when it is switched on.
 * - The active workspace is kept active; a stale active id falls back to the
 *   most recently created workspace.
 *
 * Nothing else is created on launch: the layout root adds one default view
 * only when nothing was saved.
 *
 * Payloads written before this model (persist v2) may still carry the empty
 * duplicate tabs the old pills and menus auto-created ("Integrated",
 * "Integrated 2", …); `pruneLegacyViewSprawl` removes those once, in the
 * v2 → v3 migration.
 *
 * Surface view tabs are GoldenLayout-only (the layout tree is not persisted).
 * They come back as placeholders with a Reload button (surfaceTabRestoreStore,
 * qa-features-2026-10-31 §9); nothing is loaded at launch.
 */

import type { Workspace, WorkspaceType } from '@/types/workspace';
import { resolveActiveDisplayMode } from '@/components/ui/displayModeSelector.helpers';
import { isKnownWorkspaceType } from '@/services/workspaceTypes';

type RestorableWorkspace = Pick<Workspace, 'id' | 'type' | 'timestamp' | 'presetId'>;

interface RestoredWorkspaces<W> {
  workspaces: Map<string, W>;
  activeWorkspaceId: string | null;
}

/** The active id if kept, else the most recently created kept workspace. */
export function resolveActive<W extends RestorableWorkspace>(
  kept: Map<string, W>,
  activeWorkspaceId: string | null,
): string | null {
  if (activeWorkspaceId && kept.has(activeWorkspaceId)) return activeWorkspaceId;
  let latest: W | undefined;
  for (const w of kept.values()) {
    if (!latest || w.timestamp > latest.timestamp) latest = w;
  }
  return latest?.id ?? null;
}

export function restoreWorkspaces<W extends RestorableWorkspace>(
  workspaces: ReadonlyMap<string, W>,
  activeWorkspaceId: string | null,
): RestoredWorkspaces<W> {
  const active = activeWorkspaceId && workspaces.has(activeWorkspaceId) ? activeWorkspaceId : null;

  // The single tab kept per tool type.
  const keepByTool = new Map<string, W>();
  for (const w of workspaces.values()) {
    if (!isKnownWorkspaceType(w.type) || resolveActiveDisplayMode(w.type)) continue;
    const current = keepByTool.get(w.type);
    if (current?.id === active) continue;
    if (!current || w.id === active || w.timestamp > current.timestamp) keepByTool.set(w.type, w);
  }

  const kept = new Map<string, W>();
  for (const [id, w] of workspaces) {
    if (!isKnownWorkspaceType(w.type)) continue;
    if (resolveActiveDisplayMode(w.type) || keepByTool.get(w.type)?.id === id) kept.set(id, w);
  }
  return { workspaces: kept, activeWorkspaceId: resolveActive(kept, active) };
}

/**
 * One-time cleanup for pre-2026-10-30 payloads: keep ONE plain view per
 * display mode (the active one when it is in that mode, otherwise the most
 * recent). Tools and views launched from a named preset are kept.
 */
export function pruneLegacyViewSprawl<W extends RestorableWorkspace>(
  workspaces: ReadonlyMap<string, W>,
  activeWorkspaceId: string | null,
): RestoredWorkspaces<W> {
  const active = activeWorkspaceId && workspaces.has(activeWorkspaceId) ? activeWorkspaceId : null;

  const keepByMode = new Map<string, W>();
  for (const w of workspaces.values()) {
    const mode = resolveActiveDisplayMode(w.type);
    if (!mode || w.presetId) continue;
    const current = keepByMode.get(mode);
    if (current?.id === active) continue;
    if (!current || w.id === active || w.timestamp > current.timestamp) {
      keepByMode.set(mode, w);
    }
  }

  const kept = new Map<string, W>();
  for (const [id, w] of workspaces) {
    const mode = resolveActiveDisplayMode(w.type);
    if (!mode || w.presetId || keepByMode.get(mode)?.id === id) {
      kept.set(id, w);
    }
  }
  return { workspaces: kept, activeWorkspaceId: resolveActive(kept, active) };
}

/**
 * Split restored tabs by whether their type can be shown now. Tabs of a module
 * that is off (or unsupported by this host) move to `parked`; parked tabs
 * whose module is available again move back. A parked tool whose type already
 * has an open tab is dropped (tools are singletons).
 */
export function partitionByModuleAvailability<W extends RestorableWorkspace>(
  workspaces: ReadonlyMap<string, W>,
  parked: ReadonlyMap<string, W>,
  isAvailable: (type: WorkspaceType) => boolean,
): { workspaces: Map<string, W>; parked: Map<string, W> } {
  const shown = new Map<string, W>();
  const hidden = new Map<string, W>();
  for (const [id, w] of workspaces) (isAvailable(w.type) ? shown : hidden).set(id, w);
  const openTypes = new Set([...shown.values()].map((w) => w.type));
  for (const [id, w] of parked) {
    if (shown.has(id) || hidden.has(id)) continue;
    if (!isAvailable(w.type)) hidden.set(id, w);
    else if (!openTypes.has(w.type)) {
      shown.set(id, w);
      openTypes.add(w.type);
    }
  }
  return { workspaces: shown, parked: hidden };
}

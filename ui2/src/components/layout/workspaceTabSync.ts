/**
 * Keeps the centre stack's front tab and `workspaceStore.activeWorkspaceId`
 * in agreement.
 *
 * GoldenLayout's `Stack.addChild` always makes the added tab active, so
 * rehydrating N persisted workspaces fires N `activeContentItemChanged`
 * events. If those events drive the store, the store's active workspace ends
 * up on whichever tab happened to be added last — or, worse, on a different
 * tab from the one GoldenLayout shows. A mode pill then reconfigures the
 * store's (hidden) workspace while the stage keeps showing another tab
 * (QA re-run 2026-10-29 §2: "Orthogonal pill highlighted, stage still
 * Integrated 3, the front tab Integrated 4 disappeared").
 *
 * The rule: a programmatic tab add never moves the store. After the add, the
 * store's active workspace is brought (back) to the front when it has a tab.
 * Only user-driven tab changes (clicks, closes) flow from GoldenLayout to the
 * store.
 */

import type { ComponentItem, ContentItem, Stack } from 'golden-layout';

type TabStack = Pick<Stack, 'contentItems' | 'setActiveComponentItem'> & {
  getActiveComponentItem?: () => ComponentItem | undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The workspace id a centre-stack tab hosts, or `null` for other tabs. */
export function tabWorkspaceId(item: ContentItem | null | undefined): string | null {
  if (!item || item.type !== 'component') return null;
  const state = (item as ComponentItem).container?.initialState;
  return isRecord(state) && typeof state.workspaceId === 'string' ? state.workspaceId : null;
}

/** The tab hosting `workspaceId`, if it is in the stack. */
export function findWorkspaceTab(
  stack: Pick<Stack, 'contentItems'>,
  workspaceId: string | null | undefined,
): ComponentItem | null {
  if (!workspaceId) return null;
  const match = stack.contentItems.find((item) => tabWorkspaceId(item) === workspaceId);
  return match && match.type === 'component' ? (match as ComponentItem) : null;
}

/**
 * Bring `workspaceId`'s tab to the front. Returns false when it has no tab.
 * A no-op (no event) when it is already in front.
 */
export function focusWorkspaceTab(
  stack: TabStack,
  workspaceId: string | null | undefined,
): boolean {
  const target = findWorkspaceTab(stack, workspaceId);
  if (!target) return false;
  if (stack.getActiveComponentItem?.() === target) return true;
  stack.setActiveComponentItem(target, true);
  return true;
}

/**
 * Re-entrancy counter for programmatic tab changes. While `active`, the
 * `activeContentItemChanged` handler must not write the store.
 */
export class ProgrammaticTabChange {
  private depth = 0;

  get active(): boolean {
    return this.depth > 0;
  }

  run<T>(fn: () => T): T {
    this.depth += 1;
    try {
      return fn();
    } finally {
      this.depth -= 1;
    }
  }
}

/**
 * Add a workspace tab without letting GoldenLayout's implicit activation move
 * the store, then put the store's active workspace in front (the new tab when
 * it is the active one; the existing active tab otherwise).
 */
export function addWorkspaceTabKeepingActive(
  stack: TabStack,
  guard: ProgrammaticTabChange,
  add: () => void,
  activeWorkspaceId: string | null,
): void {
  guard.run(() => {
    add();
    focusWorkspaceTab(stack, activeWorkspaceId);
  });
}

/**
 * Whether a GoldenLayout tab change should activate `tabWorkspace` in the
 * store: only for user-driven changes to a different workspace.
 */
export function shouldSyncStoreFromTab(
  tabWorkspace: string | null,
  storeActiveWorkspaceId: string | null,
  guard: ProgrammaticTabChange,
): tabWorkspace is string {
  return Boolean(tabWorkspace) && !guard.active && tabWorkspace !== storeActiveWorkspaceId;
}

/**
 * Tab removals the app makes itself: a store-driven close (`closeWorkspace`
 * → removeWorkspaceTab), a layout reload (Reset layout / saved layouts, which
 * destroy and re-add every tab) and GoldenLayout teardown. Shared by the
 * layout root and layoutService.
 */
export const programmaticTabRemoval = new ProgrammaticTabChange();

/**
 * Tab adds and focus changes the app makes itself, shared by the layout root
 * (deferred adds) and layoutService (re-adding every tab after Reset layout or
 * a saved layout). While active, `activeContentItemChanged` must not move the
 * store: each re-added tab comes to the front, and the store would end on the
 * last one instead of the tab that was active.
 */
export const programmaticTabChange = new ProgrammaticTabChange();

/** Workspace tabs whose container is being destroyed right now. */
const tabsBeingDestroyed = new Set<string>();

/**
 * A workspace tab's container was destroyed. The tab is always forgotten (so
 * a later add is not skipped as "already added"); when the user closed it
 * with the tab's ×, its workspace is closed in the store too, so a tool can
 * be reopened, the last close brings back a default view, and a closed tab
 * does not return on relaunch.
 */
export function handleWorkspaceTabDestroyed(
  workspaceId: string,
  guard: ProgrammaticTabChange,
  forget: (workspaceId: string) => void,
  closeWorkspace: (workspaceId: string) => void,
): 'closed' | 'forgotten' {
  forget(workspaceId);
  if (guard.active) return 'forgotten';
  tabsBeingDestroyed.add(workspaceId);
  try {
    closeWorkspace(workspaceId);
  } finally {
    tabsBeingDestroyed.delete(workspaceId);
  }
  return 'closed';
}

/**
 * The store closed `workspaceId`: remove its tab. Skipped while GoldenLayout
 * is destroying that tab (the user closed it, or the stack around it, and
 * its destroy handler is closing the workspace): removing it again from
 * inside that destroy walk corrupted the stack's child list, so some tabs'
 * workspaces stayed open after the stack went (QA 2026-10-30 F1). Any other
 * close (⌘W, File › Close Tab) removes the tab, also one re-added by a
 * layout reload.
 */
export function removeClosedWorkspaceTab(
  stack: Pick<Stack, 'contentItems'> | null,
  workspaceId: string,
): boolean {
  if (!stack || tabsBeingDestroyed.has(workspaceId)) return false;
  const item = findWorkspaceTab(stack, workspaceId);
  if (!item) return false;
  programmaticTabRemoval.run(() => item.remove());
  return true;
}

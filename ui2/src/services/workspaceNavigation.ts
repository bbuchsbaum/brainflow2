/**
 * Navigation between views and tools (docs/plans/qa-design-decisions-2026-10-30.md §1).
 *
 * - A layout (Orthogonal / Integrated / Mosaic / Compare) always applies to the
 *   CURRENT view tab, in place. Pills, ⌘1–⌘4 and View › Layout never jump to or
 *   create another tab. With no tab open at all (cold edge) the first view is
 *   created in that layout. A tool tab or the surface tab has no slice layout,
 *   so a layout request there does nothing (the pills are disabled).
 * - Tabs are views the user created: New view (⌘T), "Open in new tab", or a tool.
 * - Tools (Set studio, BIDS, Analysis) open once; opening one again focuses it.
 *
 * Orthogonal has two variants. ⌘1 / the Orthogonal pill keep the current
 * variant when the tab is already orthogonal, return to the variant the tab
 * last used when it is not (workspace.orthogonalVariant), and otherwise open
 * the locked grid (the mode's default); View › Layout › "Orthogonal panels" switches the
 * tab to separate, rearrangeable panels. The locked grid's own lock button
 * links or unlinks its slices.
 *
 * The native menu and the in-app shortcuts both route here so they cannot drift.
 */

import { useCenterTabStore } from '@/stores/centerTabStore';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { DISPLAY_MODES, type DisplayMode } from '@/types/displayModes';
import type { WorkspaceType } from '@/types/workspace';
import {
  isViewWorkspaceType,
  resolveActiveDisplayMode,
} from '@/components/ui/displayModeSelector.helpers';

/** ⌘1–⌘4, in pill order. */
export const LAYOUT_SHORTCUT_MODES: readonly DisplayMode[] = [
  'orthogonal',
  'integrated',
  'mosaic',
  'compare',
];

export interface ToolDestination {
  type: WorkspaceType;
  label: string;
  /** Shortcut digit with ⌘/Ctrl, when the tool has one. */
  shortcutKey?: string;
}

/** The tools, in menu order. ⌘5 / ⌘6 open the first two. */
export const TOOL_DESTINATIONS: readonly ToolDestination[] = [
  { type: 'set-studio', label: 'Set studio', shortcutKey: '5' },
  { type: 'bids-explorer', label: 'BIDS', shortcutKey: '6' },
  { type: 'analysis-workbench', label: 'Analysis' },
];

/** The layout a fresh view opens in when there is no view to copy. */
export const DEFAULT_VIEW_TYPE: WorkspaceType = 'orthogonal-flexible';

export function isToolWorkspaceType(type: WorkspaceType | null | undefined): boolean {
  return TOOL_DESTINATIONS.some((tool) => tool.type === type);
}

function isModeAvailable(mode: DisplayMode): boolean {
  const meta = DISPLAY_MODES[mode];
  if (!meta?.defaultWorkspaceType) return false;
  if (meta.featureFlag === 'integratedWorkspaceV1') {
    return useFeatureFlagStore.getState().integratedWorkspaceV1;
  }
  return true;
}

/**
 * True when the tab in front has a slice layout a layout request can change:
 * a view workspace tab, not a tool and not the surface tab.
 */
export function currentTabTakesLayout(): boolean {
  if (useCenterTabStore.getState().frontComponentType === 'surfaceView') return false;
  const { activeWorkspaceId, workspaces } = useWorkspaceStore.getState();
  const active = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : undefined;
  return Boolean(active && isViewWorkspaceType(active.type));
}

export type LayoutRequestResult = 'applied' | 'unchanged' | 'created' | 'pending' | 'unavailable';

/**
 * Tabs being created while the workspace map is still empty (cold start, or
 * after the last tab closed). The default view and a startup `--workspace`
 * request share this, so launch never makes two tabs.
 */
let firstTabCreates = 0;
let pendingFirstView: Promise<string> | null = null;

function trackFirstTab(create: () => Promise<string>): Promise<string> {
  const first = useWorkspaceStore.getState().workspaces.size === 0;
  if (!first) return create();
  firstTabCreates += 1;
  return create().finally(() => {
    firstTabCreates -= 1;
  });
}

function createFirstView(type: WorkspaceType): Promise<string> {
  if (!pendingFirstView) {
    pendingFirstView = trackFirstTab(() => useWorkspaceStore.getState().createWorkspace(type)).finally(
      () => {
        pendingFirstView = null;
      },
    );
  }
  return pendingFirstView;
}

/**
 * The one default view when no tab exists (cold start with nothing saved, or
 * the user closed the last tab). `null` when a tab exists or one is already
 * being created.
 */
export function ensureDefaultView(): Promise<string> | null {
  if (useWorkspaceStore.getState().workspaces.size > 0) return null;
  if (pendingFirstView) return pendingFirstView;
  if (firstTabCreates > 0) return null;
  return createFirstView(DEFAULT_VIEW_TYPE);
}

/**
 * Apply a layout to the current tab. `target` is a display mode (pill, ⌘1–⌘4)
 * or an exact view type (View › Layout › Orthogonal panels, startup flag).
 */
export function setCurrentTabLayout(target: DisplayMode | WorkspaceType): LayoutRequestResult {
  const exactType: WorkspaceType | null =
    target in DISPLAY_MODES ? null : (target as WorkspaceType);
  const mode = exactType ? resolveActiveDisplayMode(exactType) : (target as DisplayMode);
  if (!mode || !isModeAvailable(mode)) return 'unavailable';

  const store = useWorkspaceStore.getState();
  const active = store.activeWorkspaceId
    ? store.workspaces.get(store.activeWorkspaceId)
    : undefined;

  if (!active) {
    // The first tab is on its way (default view): apply to it once it lands.
    if (pendingFirstView) {
      void pendingFirstView.then(() => setCurrentTabLayout(target));
      return 'pending';
    }
    // Cold edge: no tab at all, so there is nothing to change in place.
    void createFirstView(exactType ?? DISPLAY_MODES[mode].defaultWorkspaceType!);
    return 'created';
  }
  if (!currentTabTakesLayout()) return 'unavailable';

  if (exactType) {
    if (active.type === exactType) return 'unchanged';
    store.setActiveWorkspaceType(exactType);
    return 'applied';
  }
  if (resolveActiveDisplayMode(active.type) === mode) return 'unchanged';
  store.setActiveWorkspaceMode(mode);
  return 'applied';
}

/**
 * New view (⌘T): a new tab in the current view's layout, or in the default
 * layout when a tool (or nothing) is in front.
 */
export function openNewView(): Promise<string> {
  const { activeWorkspaceId, workspaces, createWorkspace } = useWorkspaceStore.getState();
  const active = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : undefined;
  const type = active && isViewWorkspaceType(active.type) ? active.type : DEFAULT_VIEW_TYPE;
  return trackFirstTab(() => createWorkspace(type));
}

/** Open a tool, or focus its tab when it is already open. */
export function openTool(type: WorkspaceType): Promise<string> {
  // createWorkspace refocuses singleton (tool) workspaces instead of adding one.
  return trackFirstTab(() => useWorkspaceStore.getState().createWorkspace(type));
}

/**
 * A request naming a workspace type (native menu, `--workspace` startup flag):
 * a tool opens or refocuses; a view type applies to the current tab.
 */
export function goToWorkspaceType(type: WorkspaceType): void {
  if (isToolWorkspaceType(type)) {
    void openTool(type);
  } else {
    setCurrentTabLayout(type);
  }
}

/**
 * True when a native menu owns the navigation accelerators (desktop shell).
 * The in-app shortcuts then stay off so one key press cannot fire twice
 * (New view is not idempotent).
 */
export function nativeMenuOwnsNavigationShortcuts(): boolean {
  try {
    return typeof window !== 'undefined' && Boolean((window as { __TAURI__?: unknown }).__TAURI__);
  } catch {
    return false;
  }
}

/**
 * True while a modal dialog (command palette, settings, …) is open. Native
 * accelerators reach the UI even then; navigation must not change the tabs
 * behind a dialog.
 */
export function isModalDialogOpen(doc: Document | undefined = globalThis.document): boolean {
  return Boolean(doc?.querySelector('[aria-modal="true"]'));
}

/**
 * Navigation between views and tools (docs/plans/qa-design-decisions-2026-10-30.md §1).
 *
 * - A layout (Orthogonal / Integrated / Mosaic / Compare) always applies to the
 *   CURRENT view tab, in place. Pills, ⌘1–⌘4 and View › Layout never jump to or
 *   create another tab. With no tab open at all (cold edge) the first view is
 *   created in that layout. A tool tab or the surface tab has no slice layout,
 *   so a layout request there does nothing (the pills are disabled).
 * - Tabs are views the user created: New view (⌘T), "Open in new tab", or a tool.
 * - Tools open once; opening one again focuses it. The tools are Set studio,
 *   BIDS and the tool tabs of enabled modules (`modules/registry.ts`).
 * - Startup tabs: relaunch restores the user's tabs, or, with Settings › Top
 *   bar › Startup tabs set to a fixed list, opens that list once.
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

import { isSurfaceTabComponent, useCenterTabStore } from '@/stores/centerTabStore';
import { useFeatureFlagStore } from '@/stores/featureFlagStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { DISPLAY_MODES, type DisplayMode } from '@/types/displayModes';
import type { WorkspaceType } from '@/types/workspace';
import {
  isViewWorkspaceType,
  resolveActiveDisplayMode,
} from '@/components/ui/displayModeSelector.helpers';
import { moduleRegistry, type ToolDescriptor } from '@/modules/registry';
import { usableStartupTabs } from '@/services/workspaceTypes';

/** ⌘1–⌘4, in pill order. */
export const LAYOUT_SHORTCUT_MODES: readonly DisplayMode[] = [
  'orthogonal',
  'integrated',
  'mosaic',
  'compare',
];

/** A tool in the Tools list (core, or the tool tab of an enabled module). */
export type ToolDestination = ToolDescriptor;

/** The tools, in menu order (core first). ⌘5 / ⌘6 open the first two. */
export function toolDestinations(): readonly ToolDestination[] {
  return moduleRegistry.getTools();
}

/** The layout a fresh view opens in when there is no view to copy. */
export const DEFAULT_VIEW_TYPE: WorkspaceType = 'orthogonal-flexible';

/** A tool type (core or module, whether or not its module is on). */
export function isToolWorkspaceType(type: WorkspaceType | null | undefined): boolean {
  return Boolean(moduleRegistry.getToolDescriptor(type));
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
  if (isSurfaceTabComponent(useCenterTabStore.getState().frontComponentType)) return false;
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

function createFirstView(type: WorkspaceType, defaultView = false): Promise<string> {
  if (!pendingFirstView) {
    pendingFirstView = trackFirstTab(() => {
      const { createWorkspace } = useWorkspaceStore.getState();
      return defaultView
        ? createWorkspace(type, undefined, { defaultView: true })
        : createWorkspace(type);
    }).finally(
      () => {
        pendingFirstView = null;
      },
    );
  }
  return pendingFirstView;
}

/** A tab Settings › Top bar can open at startup: a view layout or a tool. */
export interface StartupTabCandidate {
  type: WorkspaceType;
  label: string;
}

/**
 * Startup-tab choices in display order: one view per layout (Orthogonal opens
 * as panels, like a new view; Integrated only while its flag is on), then the
 * available tools.
 */
export function startupTabCandidates(): StartupTabCandidate[] {
  const views = LAYOUT_SHORTCUT_MODES.filter(isModeAvailable).map((mode) => ({
    type: mode === 'orthogonal' ? DEFAULT_VIEW_TYPE : DISPLAY_MODES[mode].defaultWorkspaceType!,
    label: `${DISPLAY_MODES[mode].label} view`,
  }));
  const tools = toolDestinations().map((tool) => ({ type: tool.type, label: tool.label }));
  return [...views, ...tools];
}

/** Whether this session's launch already decided its tabs. */
let startupTabsHandled = false;

/** Test helper: the next `ensureDefaultView({ atLaunch: true })` is a fresh launch. */
export function resetStartupTabsForTests(): void {
  startupTabsHandled = false;
}

function createStartupTabs(types: readonly WorkspaceType[]): Promise<string> {
  pendingFirstView = trackFirstTab(async () => {
    let firstId: string | null = null;
    for (const type of types) {
      const id = await useWorkspaceStore.getState().createWorkspace(type);
      firstId ??= id;
    }
    // The first tab of the list is in front.
    if (firstId) useWorkspaceStore.getState().activateWorkspace(firstId);
    return firstId!;
  }).finally(() => {
    pendingFirstView = null;
  });
  return pendingFirstView;
}

/**
 * The tabs to open when none exist. At launch (`atLaunch`, the layout root's
 * first check) that is the fixed startup list when Settings › Top bar asks for
 * one; otherwise — cold start with nothing saved, or the user closed the last
 * tab — one default view. `null` when a tab exists or one is being created.
 */
export function ensureDefaultView(options: { atLaunch?: boolean } = {}): Promise<string> | null {
  const launch = Boolean(options.atLaunch) && !startupTabsHandled;
  if (options.atLaunch) startupTabsHandled = true;
  if (useWorkspaceStore.getState().workspaces.size > 0) return null;
  if (pendingFirstView) return pendingFirstView;
  if (firstTabCreates > 0) return null;
  const startup = launch ? usableStartupTabs() : null;
  // A fixed startup list is the user's choice; the default view is the app's
  // own (`defaultView`, QA 2026-10-31 N4).
  if (startup) return createStartupTabs(startup);
  return createFirstView(DEFAULT_VIEW_TYPE, true);
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

/**
 * Open a tool, or focus its tab when it is already open. Resolves null when
 * the tool is not available (its module is switched off or unsupported here).
 */
export function openTool(type: WorkspaceType): Promise<string | null> {
  if (!moduleRegistry.isToolAvailable(type)) {
    console.warn(`[workspaceNavigation] Tool "${type}" is not available`);
    return Promise.resolve(null);
  }
  // createWorkspace refocuses singleton (tool) workspaces instead of adding one.
  return trackFirstTab(() => useWorkspaceStore.getState().createWorkspace(type)).catch(
    (error: unknown) => {
      // Switched off while the tab was being created: nothing opened.
      if (!moduleRegistry.isToolAvailable(type)) return null;
      throw error;
    },
  );
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

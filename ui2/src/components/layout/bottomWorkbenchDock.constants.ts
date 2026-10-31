/**
 * Constants and types shared by BottomWorkbenchDock and its consumers
 * (persistence layer, integrated workspace composition).
 */

export type DockSizes = readonly [number, number, number];

export const DEFAULT_DOCK_SIZES: DockSizes = [50, 30, 20] as const;

/** Width (px) the Log pane shrinks to when collapsed — header-only affordance. */
export const DOCK_COLLAPSED_LOG_WIDTH = 24;

/**
 * Bottom-dock tabs. The dock is a single tabbed container (Design.md §11.1 /
 * §20: "Bottom dock uses `Activity | Plot | Log`"), one panel full-width at a
 * time. Phase 3 (P3.5) adds "Clusters" beside Plot: the cluster table is an
 * analysis readout like the plot, never a centre-stack or side-column panel.
 * Enabled modules may add tabs after these (`modules/registry.ts` getDockTabs).
 */
export type CoreDockTabId = 'activity' | 'plot' | 'clusters' | 'log';

/** A core tab id, or the id of a module's dock tab (`<module>.<name>`). */
export type DockTabId = CoreDockTabId | (string & {});

export const DOCK_TABS: ReadonlyArray<{ id: CoreDockTabId; label: string }> = [
  { id: 'activity', label: 'Activity' },
  { id: 'plot', label: 'Plot' },
  { id: 'clusters', label: 'Clusters' },
  { id: 'log', label: 'Log' },
] as const;

/** Default active tab — Plot is first-class (Design.md §1.5) and the user's focus. */
export const DEFAULT_DOCK_TAB: CoreDockTabId = 'plot';

/** Tab-bar height (px): the bf flat-tab strip (28px, `H_TAB`) plus its 1px
 *  bottom hairline. Also the dock's total height when minimized (collapsed to
 *  just the tab bar). Was 34 (Design.md §11.2) before the bf Tabs migration. */
export const DOCK_TAB_BAR_HEIGHT = 29;

/** Bottom-dock height tokens (px), Design.md §2.2. */
export const DOCK_HEIGHT_PREFERRED = 220;
export const DOCK_HEIGHT_MIN = 160;
export const DOCK_HEIGHT_MAX = 340;

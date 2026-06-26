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
 * time. Order and labels follow the spec exactly.
 */
export type DockTabId = 'activity' | 'plot' | 'log';

export const DOCK_TABS: ReadonlyArray<{ id: DockTabId; label: string }> = [
  { id: 'activity', label: 'Activity' },
  { id: 'plot', label: 'Plot' },
  { id: 'log', label: 'Log' },
] as const;

/** Default active tab — Plot is first-class (Design.md §1.5) and the user's focus. */
export const DEFAULT_DOCK_TAB: DockTabId = 'plot';

/** Tab-bar height (px) — Design.md §11.2 (`grid-template-rows: 34px 1fr`).
 *  Also the dock's total height when minimized (collapsed to just the tab bar). */
export const DOCK_TAB_BAR_HEIGHT = 34;

/** Bottom-dock height tokens (px), Design.md §2.2. */
export const DOCK_HEIGHT_PREFERRED = 220;
export const DOCK_HEIGHT_MIN = 160;
export const DOCK_HEIGHT_MAX = 340;

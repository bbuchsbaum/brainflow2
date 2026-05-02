/**
 * Constants and types shared by BottomWorkbenchDock and its consumers
 * (persistence layer, integrated workspace composition).
 */

export type DockSizes = readonly [number, number, number];

export const DEFAULT_DOCK_SIZES: DockSizes = [50, 30, 20] as const;

/** Width (px) the Log pane shrinks to when collapsed — header-only affordance. */
export const DOCK_COLLAPSED_LOG_WIDTH = 24;

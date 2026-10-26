/**
 * Joined segmented group (V5 navigation kind 2), the same classes as the
 * plot-mode chips in `PlotHost`: one bordered group with 1px internal
 * dividers. Active = raised neutral fill + 2px inset neutral bottom edge;
 * inactive = muted text; hover = the neutral accent fill. Focus is a separate
 * 2px ring with a 1px offset, lifted above its neighbours. Items are 24px
 * tall (WCAG 2.5.8 target size).
 */
export const SEGMENTED_GROUP = 'inline-flex items-stretch rounded-sm border border-bf-border';
export const SEGMENTED_ITEM =
  'relative min-h-6 px-2 text-bf-xs transition-colors border-r border-bf-border-subtle last:border-r-0 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background';
export const SEGMENTED_ITEM_ACTIVE =
  'bg-bf-bg-active font-medium text-foreground shadow-[inset_0_-2px_0_var(--bf-text-muted)]';
export const SEGMENTED_ITEM_INACTIVE =
  'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground';

export function segmentedItemClass(active: boolean): string {
  return `${SEGMENTED_ITEM} ${active ? SEGMENTED_ITEM_ACTIVE : SEGMENTED_ITEM_INACTIVE}`;
}

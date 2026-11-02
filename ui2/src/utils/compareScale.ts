/**
 * The size every Compare pane fits its frame to (QA 2026-10-31 N23): the
 * smallest width and the smallest height among the workspace's panes, this
 * one included. Fitting the same frame to the same size gives every pane one
 * mm-per-pixel scale, even when a pane gives up width to its colorbar
 * column.
 */
export function sharedComparisonFitSize(
  own: readonly [number, number],
  panes: ReadonlyArray<{ width: number; height: number } | undefined>,
): [number, number] {
  let [width, height] = own;
  for (const pane of panes) {
    if (!pane || !(pane.width > 0) || !(pane.height > 0)) continue;
    width = Math.min(width, pane.width);
    height = Math.min(height, pane.height);
  }
  return [width, height];
}

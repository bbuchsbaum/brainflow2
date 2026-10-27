/**
 * Who changed a layer's visibility (native R3-1). The Series view's run
 * visibility (runVisibility.ts) may only yield to the USER: the explicit
 * toggles (Visible switch, layer list, toggle keys, LayerService.toggleVisibility)
 * report here; the view's own changes run inside `asView` and are not
 * reported; anything else (a load completing, a GPU promotion) is neither.
 */
const userChosen = new Set<string>();
let viewDepth = 0;

/** An explicit user toggle of a layer's visibility. */
export function noteUserVisibility(layerId: string): void {
  if (viewDepth === 0) userChosen.add(layerId);
}

/** True when the user toggled the layer (the view leaves it alone). */
export function isUserVisibility(layerId: string): boolean {
  return userChosen.has(layerId);
}

/** Run a visibility change made by the view itself (not reported as the user's). */
export function asView<T>(fn: () => T): T {
  viewDepth += 1;
  try {
    return fn();
  } finally {
    viewDepth -= 1;
  }
}

/** Test hook. */
export function resetVisibilityIntent(): void {
  userChosen.clear();
  viewDepth = 0;
}

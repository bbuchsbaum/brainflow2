/**
 * Keep `el` visible by scrolling ONLY its nearest scrollable ancestor
 * (overflow-y auto/scroll, or `overlay`), by the minimum amount ("nearest").
 *
 * `Element.scrollIntoView` walks every scrollable ancestor, including ones
 * with `overflow: hidden` (they are still programmatically scrollable). In a
 * GoldenLayout panel that shifts the layout root itself (the Studio header
 * moved 3px). This helper never touches anything above the first container.
 *
 * Returns the container it scrolled (or would have scrolled), or null.
 */
export function findScrollContainer(el: Element): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node;
    node = node.parentElement;
  }
  return null;
}

export function scrollIntoContainer(el: Element): HTMLElement | null {
  const container = findScrollContainer(el);
  if (!container) return null;
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  // The visible band of the container (its client box, inside the borders).
  const top = c.top + container.clientTop;
  const bottom = top + container.clientHeight;
  let delta = 0;
  if (r.top < top) delta = r.top - top;
  else if (r.bottom > bottom) delta = Math.min(r.bottom - bottom, r.top - top);
  if (delta !== 0) container.scrollTop += delta;
  return container;
}

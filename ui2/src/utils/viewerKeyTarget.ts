/**
 * Whether a navigation key (Up/Down, PageUp/PageDown) pressed with focus on
 * `target` belongs to the slice viewer.
 *
 * Yes when nothing in particular has focus (body) or focus is in a view.
 * No inside widgets that move or scroll with those keys (tree, list, grid,
 * log, table) or inside any scrollable panel: the file tree, Scene stack, Log,
 * plots and tables keep their own arrow navigation and scrolling.
 */

const NAVIGATING_WIDGETS =
  '[role="tree"], [role="treegrid"], [role="listbox"], [role="grid"], [role="log"], [role="table"], [role="menu"], [role="tablist"], [role="radiogroup"], [role="slider"], [role="spinbutton"], table';

/** Slice views mark their root with data-view-id (SliceViewCanvas). */
const VIEWER = '[data-view-id], [data-focus-return="viewport"]';

function isScrollable(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const { overflowY } = view.getComputedStyle(el);
  return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
}

export function isViewerKeyTarget(target: Element | null | undefined): boolean {
  if (!target) return true;
  const doc = target.ownerDocument;
  if (target === doc.body || target === doc.documentElement) return true;
  if (target.closest(NAVIGATING_WIDGETS)) return false;
  if (target.closest(VIEWER)) return true;
  for (let el: Element | null = target; el && el !== doc.body; el = el.parentElement) {
    if (isScrollable(el)) return false;
  }
  // Focus on other chrome (a toolbar button, a panel header): not the viewer.
  return false;
}

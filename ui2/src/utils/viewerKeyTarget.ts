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

// The element last pressed. Clicking text that takes no focus (a Log line, a
// table cell) leaves focus on <body>, which alone reads as "the viewer"
// (QA 2026-10-30 F23: ↓↑↑ after clicking a Log line moved the crosshair).
let lastPressed: Element | null = null;
if (typeof document !== 'undefined') {
  const remember = (event: Event) => {
    lastPressed = event.target instanceof Element ? event.target : null;
  };
  document.addEventListener('pointerdown', remember, true);
  document.addEventListener('mousedown', remember, true);
}

/** Widgets whose rows a press selects and whose arrows then move or scroll them. */
const PRESS_OWNED =
  '[role="tree"], [role="treegrid"], [role="listbox"], [role="grid"], [role="log"], [role="table"], table';

/**
 * Controls that use the arrows only while focused from the keyboard. A press
 * on them (WebKit does not focus a pressed button; SegmentedControl ignores
 * arrows after a pointer press) leaves the arrows to the viewer: after
 * clicking the Ortho/Mosaic pill or a tab, ↑/PageDown still step the slice.
 */
const PRESS_RELEASED =
  'button, a, input, select, textarea, label, [role="radio"], [role="tab"], [role="radiogroup"], [role="tablist"], [role="menu"], [role="menuitem"], [role="slider"], [role="spinbutton"]';

/** A press here keeps the navigation keys out of the viewer. */
function pressOwnsKeys(target: Element): boolean {
  if (target.closest(PRESS_OWNED)) return true;
  if (target.closest(VIEWER) || target.closest(PRESS_RELEASED)) return false;
  for (let el: Element | null = target; el && el !== target.ownerDocument.body; el = el.parentElement) {
    if (isScrollable(el)) return true;
  }
  return false;
}

/**
 * The element navigation keys are aimed at.
 * - Focus on a segmented control that came from pressing it: <body> (the
 *   viewer), matching SegmentedControl, which ignores arrows after a
 *   pointer press.
 * - Other focus: the focused element.
 * - Focus on <body>: the element last pressed when that is a Log line, a
 *   list or tree row, a table or other text in a scrolling panel; else <body>.
 */
export function navigationKeyTarget(doc: Document = document): Element | null {
  const active = doc.activeElement;
  const pressed = lastPressed?.isConnected ? lastPressed : null;
  if (active && active !== doc.body && active !== doc.documentElement) {
    const group = active.closest('[role="radiogroup"]');
    if (group && pressed && group.contains(pressed)) return doc.body;
    return active;
  }
  return pressed && pressOwnsKeys(pressed) ? pressed : active;
}

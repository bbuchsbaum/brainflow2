import type React from 'react';

/**
 * Tab / Shift+Tab out of a react-arborist tree.
 *
 * react-arborist's container handles Tab itself (`preventDefault` +
 * `focusNextElement(container)`), but its focusable list can miss the
 * container or pick a control inside the tree, so focus never moves: a
 * keyboard trap (p2c v0 BLOCKER, BIDS "ds-motor" and Analysis "anat").
 *
 * Attach {@link handleTreeTabCapture} as `onKeyDownCapture` on the element
 * that wraps `<Tree>`. For a Tab that starts inside the `[role="tree"]`
 * container it stops the event before arborist sees it and moves focus to
 * the next (or previous) tabbable element OUTSIDE the tree, in document
 * order. The tree remains a single tab stop: arrows move between rows.
 */

const TABBABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  "input:not([disabled]):not([type='hidden'])",
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'summary',
  "[contenteditable='']",
  "[contenteditable='true']",
  '[tabindex]',
].join(',');

function isRendered(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if ((n as HTMLElement).hidden) return false;
    if (n.hasAttribute('inert')) return false;
    const cs = window.getComputedStyle(n);
    if (cs.display === 'none') return false;
    if (n === el && cs.visibility === 'hidden') return false;
  }
  return true;
}

function tabbablesOutside(container: Element, root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) =>
      el.tabIndex >= 0 &&
      el !== container &&
      !container.contains(el) &&
      !el.closest("[aria-hidden='true']") &&
      isRendered(el),
  );
}

/**
 * The element focus should move to when tabbing out of `container`
 * (`null` when nothing tabbable lies in that direction).
 */
export function findTabExit(
  container: Element,
  backwards: boolean,
  root: ParentNode = document,
): HTMLElement | null {
  const candidates = tabbablesOutside(container, root);
  if (backwards) {
    for (let i = candidates.length - 1; i >= 0; i -= 1) {
      const pos = container.compareDocumentPosition(candidates[i]);
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return candidates[i];
    }
    return null;
  }
  for (const el of candidates) {
    const pos = container.compareDocumentPosition(el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return el;
  }
  return null;
}

export function handleTreeTabCapture(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as Element | null;
  const tree = target?.closest?.("[role='tree']");
  if (!tree || !event.currentTarget.contains(tree)) return;
  // Keep arborist's own Tab handler (which can trap focus) from running.
  event.stopPropagation();
  const exit = findTabExit(tree, event.shiftKey);
  if (exit) {
    event.preventDefault();
    exit.focus();
  }
  // No exit: leave the default alone so the browser can move focus to its
  // own chrome rather than trapping it here.
}

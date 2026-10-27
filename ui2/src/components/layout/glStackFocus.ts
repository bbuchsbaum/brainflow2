/**
 * Focused-stack tracker for GoldenLayout.
 *
 * HYBRID rule 3 (V5 amendment) allows the amber tab edge only on the active
 * tab of the *focused* GoldenLayout stack. GoldenLayout 2.6 sets `lm_focused`
 * only when a tab header is clicked or a component is focused
 * programmatically; clicks inside panel content do not move it. This tracker
 * keeps exactly one `.lm_stack` marked with {@link FOCUSED_STACK_CLASS}: the
 * stack that last received a pointerdown or focusin, falling back to a default
 * (the centre workspace stack) when the marked stack leaves the DOM.
 */

import { KBD_NAV_ATTR } from '@/components/panels/files/useKeyboardNavWithin';

export const FOCUSED_STACK_CLASS = 'bf-stack-focused';

/** Mark `stackEl` as the only focused stack inside `root`. */
export function markFocusedStack(root: HTMLElement, stackEl: Element | null): void {
  if (!stackEl) return;
  if (stackEl.classList.contains(FOCUSED_STACK_CLASS)) return;
  root
    .querySelectorAll(`.${FOCUSED_STACK_CLASS}`)
    .forEach((el) => el.classList.remove(FOCUSED_STACK_CLASS));
  stackEl.classList.add(FOCUSED_STACK_CLASS);
}

/** Ensure some stack is marked; if none (or a detached one) is, mark the default. */
export function ensureFocusedStack(root: HTMLElement, getDefaultStack: () => Element | null): void {
  if (root.querySelector(`.lm_stack.${FOCUSED_STACK_CLASS}`)) return;
  markFocusedStack(root, getDefaultStack());
}

/**
 * Track pointer and keyboard focus within `root`. Returns a cleanup function.
 * Events whose target is not inside a stack (splitters, the root itself) leave
 * the current focus unchanged.
 */
export function installStackFocusTracker(
  root: HTMLElement,
  getDefaultStack: () => Element | null,
): () => void {
  const handle = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const stack = target.closest('.lm_stack');
    if (stack && root.contains(stack)) {
      markFocusedStack(root, stack);
    }
  };
  root.addEventListener('pointerdown', handle, true);
  root.addEventListener('focusin', handle, true);
  ensureFocusedStack(root, getDefaultStack);
  return () => {
    root.removeEventListener('pointerdown', handle, true);
    root.removeEventListener('focusin', handle, true);
  };
}

/**
 * After a file load, move the focused-stack mark to the centre (viewer)
 * stack, where the loaded data appears.
 *
 * - DOM focus parked on a file-tree row by a pointer click (react-arborist
 *   focuses the row it selects) is released, so arrow keys stop going to the
 *   tree the user has finished with.
 * - A user keyboard-navigating the tree (`data-kbd-nav="true"`, see
 *   useKeyboardNavWithin) keeps focus and the mark, so they can step on to the
 *   next file.
 * - Focus in any other control inside the layout (an input, a button) is left
 *   alone, and so is the mark, which already follows that control.
 */
export function focusCentreStackAfterLoad(
  root: HTMLElement,
  getCentreStack: () => Element | null,
): void {
  const doc = root.ownerDocument;
  const active = doc.activeElement;
  if (active instanceof HTMLElement && active !== doc.body && root.contains(active)) {
    if (active.closest(`[${KBD_NAV_ATTR}="true"]`)) return;
    if (!active.closest('[role="tree"]')) return;
    active.blur();
  }
  const centre = getCentreStack();
  if (centre) markFocusedStack(root, centre);
}

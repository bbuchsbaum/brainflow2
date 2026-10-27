import { useCallback, useEffect, useRef } from 'react';

/** Attribute set on the container while the user keyboard-navigates inside it. */
export const KBD_NAV_ATTR = 'data-kbd-nav';

/**
 * Marks a container with `data-kbd-nav="true"` only while the user is
 * navigating it with the keyboard, so its focus ring can be gated on real
 * keyboard use rather than on `:focus-visible` alone.
 *
 * Why: react-arborist keeps DOM focus on a treeitem after programmatic or
 * pointer selection, and any earlier keydown elsewhere in the window flips the
 * browser's focus-visible modality, so a parked tree row stays ringed while the
 * user works elsewhere.
 *
 * Set: a keydown whose target is inside the container, or focus arriving in
 *      the container right after a Tab keydown (keyboard entry).
 * Clear: a pointerdown anywhere in the document, or focus leaving the container.
 *
 * Returns a callback ref; compose it with any other ref on the same node.
 */
export function useKeyboardNavWithin(): (node: HTMLElement | null) => void {
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!node) return;

    const doc = node.ownerDocument;
    let tabPending = false;

    const set = () => {
      if (node.getAttribute(KBD_NAV_ATTR) !== 'true') node.setAttribute(KBD_NAV_ATTR, 'true');
    };
    const clear = () => {
      if (node.hasAttribute(KBD_NAV_ATTR)) node.removeAttribute(KBD_NAV_ATTR);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Ignore bare modifier presses; they are not navigation.
      if (
        event.key === 'Shift' ||
        event.key === 'Control' ||
        event.key === 'Alt' ||
        event.key === 'Meta'
      ) {
        return;
      }
      set();
    };
    const onDocKeyDown = (event: KeyboardEvent) => {
      tabPending = event.key === 'Tab';
    };
    const onDocPointerDown = () => {
      tabPending = false;
      clear();
    };
    const onFocusIn = () => {
      if (tabPending) set();
      tabPending = false;
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (!next || !node.contains(next)) clear();
    };

    node.addEventListener('keydown', onKeyDown, true);
    node.addEventListener('focusin', onFocusIn);
    node.addEventListener('focusout', onFocusOut);
    doc.addEventListener('keydown', onDocKeyDown, true);
    doc.addEventListener('pointerdown', onDocPointerDown, true);

    cleanupRef.current = () => {
      node.removeEventListener('keydown', onKeyDown, true);
      node.removeEventListener('focusin', onFocusIn);
      node.removeEventListener('focusout', onFocusOut);
      doc.removeEventListener('keydown', onDocKeyDown, true);
      doc.removeEventListener('pointerdown', onDocPointerDown, true);
      clear();
    };
  }, []);

  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    },
    [],
  );

  return ref;
}

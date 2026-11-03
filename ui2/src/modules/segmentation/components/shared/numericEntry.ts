import type React from 'react';

/** Fields whose focusing click has not reached mouseup yet. */
const justFocused = new WeakSet<HTMLInputElement>();

/**
 * Handlers for a numeric field the rater retypes rather than edits: focusing it
 * (tab, click or triple-click) selects the whole value so typing replaces it,
 * and single letters never type into it (WebKit number inputs accept them,
 * and they are the B/E/C tool keys elsewhere). Arrow keys and digits pass.
 */
export const numericEntryHandlers: Pick<React.InputHTMLAttributes<HTMLInputElement>, 'onFocus' | 'onMouseUp' | 'onBlur' | 'onKeyDown'> = {
  onFocus: (event) => { event.currentTarget.select(); justFocused.add(event.currentTarget); },
  // The click that focused the field would otherwise drop the selection on
  // mouseup; a triple-click selects all as in any text field.
  onMouseUp: (event) => {
    if (justFocused.has(event.currentTarget) || event.detail >= 3) { event.preventDefault(); event.currentTarget.select(); }
    justFocused.delete(event.currentTarget);
  },
  onBlur: (event) => { justFocused.delete(event.currentTarget); },
  onKeyDown: (event) => {
    if (event.key.length === 1 && /\p{L}/u.test(event.key) && !event.metaKey && !event.ctrlKey) event.preventDefault();
  },
};

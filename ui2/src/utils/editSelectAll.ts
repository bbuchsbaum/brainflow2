/**
 * Edit › Select All (Cmd/Ctrl+A) for the desktop shell. The native menu item
 * is custom (src-tauri main.rs `edit_select_all`) rather than the predefined
 * one, which selects the whole window's chrome. This selects the contents of
 * the focused text field and does nothing anywhere else.
 */

const SELECTABLE_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'tel',
  'password',
  'email',
  'number',
  '',
]);

/** Select all in the focused field; false when no text field has focus. */
export function selectAllInFocusedField(doc: Document = document): boolean {
  const active = doc.activeElement;
  if (active instanceof HTMLTextAreaElement) {
    active.select();
    return true;
  }
  if (active instanceof HTMLInputElement) {
    if (!SELECTABLE_INPUT_TYPES.has(active.type)) return false;
    active.select();
    return true;
  }
  if (active instanceof HTMLElement && active.isContentEditable) {
    let root: HTMLElement = active;
    while (root.parentElement?.isContentEditable) root = root.parentElement;
    const range = doc.createRange();
    range.selectNodeContents(root);
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }
  return false;
}

/** The text-editing control with focus, whose own undo ⌘Z belongs to (not a slider or select). */
export function isTextEditingElement(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) return !el.readOnly && SELECTABLE_INPUT_TYPES.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable === true;
}

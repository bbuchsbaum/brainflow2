/**
 * Keep the webview's own context menu (Look Up / Translate / Inspect Element)
 * off the app chrome (QA run 5, N25). Rows, panels and views that have an app
 * menu open it from their React `onContextMenu` and prevent the default; a
 * right-click anywhere else that is not text the user can act on gets no menu
 * rather than WebKit's.
 *
 * The native menu stays where it is useful: in editable fields (cut / copy /
 * paste, spelling) and over a text selection (copy). In development builds
 * Option/Alt + right-click still reaches it, for Inspect Element.
 */

const EDITABLE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/** Whether the right-click at `target` should keep the webview's native menu. */
export function allowsNativeContextMenu(
  target: EventTarget | null,
  options: { altKey?: boolean; dev?: boolean; selection?: Selection | null } = {},
): boolean {
  if (options.dev && options.altKey) return true;
  const node = target instanceof Node ? target : null;
  if (!node) return false;
  const element = node instanceof Element ? node : node.parentElement;
  if (element?.closest(EDITABLE)) return true;
  const selection = options.selection;
  if (selection && !selection.isCollapsed && selection.toString().trim() !== '') {
    // Over the selected text: the clicked node lies inside a selected range's
    // common ancestor, not merely around the selection. A right-click targets
    // an element, so a selection within one text node counts its element.
    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      const common = range.commonAncestorContainer;
      const scope = common.nodeType === Node.TEXT_NODE ? common.parentNode : common;
      if (scope?.contains(node) && range.intersectsNode(node)) return true;
    }
  }
  return false;
}

export function installNativeContextMenuGuard(doc: Document = document): () => void {
  const marker = doc as Document & { __bfContextMenuGuard?: () => void };
  if (marker.__bfContextMenuGuard) return marker.__bfContextMenuGuard;
  const dev = Boolean(import.meta.env?.DEV);
  // Bubble phase on the document: React's root handlers (app menus) have run.
  const onContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const selection = doc.defaultView?.getSelection?.() ?? null;
    if (allowsNativeContextMenu(event.target, { altKey: event.altKey, dev, selection })) return;
    event.preventDefault();
  };
  doc.addEventListener('contextmenu', onContextMenu);
  const uninstall = () => {
    doc.removeEventListener('contextmenu', onContextMenu);
    delete marker.__bfContextMenuGuard;
  };
  marker.__bfContextMenuGuard = uninstall;
  return uninstall;
}

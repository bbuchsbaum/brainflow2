import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allowsNativeContextMenu, installNativeContextMenuGuard } from '../nativeContextMenuGuard';

function rightClick(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('nativeContextMenuGuard (N25)', () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installNativeContextMenuGuard(document);
    document.body.innerHTML = `
      <div id="row">LH Putamen</div>
      <input id="field" value="text" />
      <textarea id="area">notes</textarea>
      <div id="editable" contenteditable="true">rich</div>
      <p id="para">Selectable log line</p>`;
  });
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    uninstall();
    document.body.innerHTML = '';
  });

  it('suppresses the webview menu on app chrome', () => {
    expect(rightClick(document.getElementById('row')!).defaultPrevented).toBe(true);
  });

  it('keeps it in text fields', () => {
    for (const id of ['field', 'area', 'editable']) {
      expect(rightClick(document.getElementById(id)!).defaultPrevented).toBe(false);
    }
  });

  it('keeps it over a text selection', () => {
    const para = document.getElementById('para')!;
    const range = document.createRange();
    range.selectNodeContents(para);
    window.getSelection()!.addRange(range);
    expect(rightClick(para).defaultPrevented).toBe(false);
    expect(rightClick(document.getElementById('row')!).defaultPrevented).toBe(true);
  });

  it('keeps it on the element of a selection within one text node, not on its ancestors', () => {
    const para = document.getElementById('para')!;
    const range = document.createRange();
    range.setStart(para.firstChild!, 0);
    range.setEnd(para.firstChild!, 10);
    window.getSelection()!.addRange(range);
    // A right-click targets the element holding the selected text.
    expect(rightClick(para).defaultPrevented).toBe(false);
    // The panel around it is an ancestor of the selection, not inside it.
    expect(rightClick(document.body).defaultPrevented).toBe(true);
  });

  it('allows Option + right-click in development only', () => {
    const row = document.getElementById('row')!;
    expect(allowsNativeContextMenu(row, { altKey: true, dev: true })).toBe(true);
    expect(allowsNativeContextMenu(row, { altKey: true, dev: false })).toBe(false);
  });

  it('installs once and uninstalls cleanly', () => {
    expect(installNativeContextMenuGuard(document)).toBe(uninstall);
    uninstall();
    expect(rightClick(document.getElementById('row')!).defaultPrevented).toBe(false);
    uninstall = installNativeContextMenuGuard(document);
  });
});

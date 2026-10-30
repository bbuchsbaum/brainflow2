import { afterEach, describe, expect, it } from 'vitest';
import { selectAllInFocusedField } from '../editSelectAll';

describe('selectAllInFocusedField (Edit › Select All)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  it('selects the focused text input', () => {
    document.body.innerHTML = '<input id="i" value="hello" />';
    const input = document.getElementById('i') as HTMLInputElement;
    input.focus();
    expect(selectAllInFocusedField()).toBe(true);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  });

  it('selects the focused textarea', () => {
    document.body.innerHTML = '<textarea id="t">abc</textarea>';
    const area = document.getElementById('t') as HTMLTextAreaElement;
    area.focus();
    expect(selectAllInFocusedField()).toBe(true);
    expect(area.selectionEnd).toBe(3);
  });

  it('selects nothing (and touches no selection) outside a text field', () => {
    document.body.innerHTML = '<p>panel label</p><button id="b">b</button>';
    document.getElementById('b')!.focus();
    expect(selectAllInFocusedField()).toBe(false);
    expect(window.getSelection()?.toString() ?? '').toBe('');
    (document.activeElement as HTMLElement).blur();
    expect(selectAllInFocusedField()).toBe(false);
  });

  it('ignores non-text inputs (checkbox, range)', () => {
    document.body.innerHTML = '<input id="c" type="checkbox" />';
    document.getElementById('c')!.focus();
    expect(selectAllInFocusedField()).toBe(false);
  });
});

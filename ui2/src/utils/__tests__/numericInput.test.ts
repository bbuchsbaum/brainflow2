import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asciiCopyHandler,
  installNumericInputGuard,
  parseNumericList,
  parseNumericText,
} from '../numericInput';
import { asciiMinus, formatRange, formatLayerValue } from '../valueFormat';

describe('parseNumericText', () => {
  it('accepts every minus-like dash as a minus', () => {
    for (const dash of ['−', '–', '‒', '﹣', '－', '-']) {
      expect(parseNumericText(`${dash}37.5`)).toBe(-37.5);
    }
  });
  it('is strict: no digits or signs are dropped', () => {
    expect(parseNumericText(' 2.5 ')).toBe(2.5);
    expect(parseNumericText('1e-3')).toBe(0.001);
    expect(parseNumericText('37.5 mm')).toBeNull();
    expect(parseNumericText('1-2')).toBeNull();
    expect(parseNumericText('')).toBeNull();
    expect(parseNumericText('−')).toBeNull();
  });
  it('splits a coordinate triple', () => {
    expect(parseNumericList('(−37.5, −18.5, 17.5)')).toEqual([-37.5, -18.5, 17.5]);
    expect(parseNumericList('x −37.5')).toBeNull();
  });
});

describe('asciiMinus / formatRange', () => {
  it('normalises all minus-like dashes', () => {
    expect(asciiMinus('−a–b‒c﹣d－e')).toBe('-a-b-c-d-e');
  });
  it('formats a range with "to"', () => {
    expect(formatRange(-6, 6)).toBe('−6 to 6');
    expect(formatRange(-4.58, 6.15)).toBe('−4.58 to 6.15');
    expect(formatRange(-2, -1, (v) => formatLayerValue(v * 10))).toBe('−20 to −10');
  });
});

describe('installNumericInputGuard', () => {
  let uninstall: () => void;
  let input: HTMLInputElement;
  beforeEach(() => {
    uninstall = installNumericInputGuard(document);
    input = document.createElement('input');
    input.type = 'number';
    document.body.appendChild(input);
  });
  afterEach(() => {
    uninstall();
    input.remove();
  });

  const paste = (text: string) => {
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
    input.dispatchEvent(ev);
    return ev;
  };

  it('pastes "−37.5" as -37.5 and fires input', () => {
    const onInput = vi.fn();
    input.addEventListener('input', onInput);
    const ev = paste('−37.5');
    expect(ev.defaultPrevented).toBe(true);
    expect(input.value).toBe('-37.5');
    expect(onInput).toHaveBeenCalled();
  });

  it('leaves a plain ASCII number to the browser', () => {
    const ev = paste('-3.1');
    expect(ev.defaultPrevented).toBe(false);
  });

  it('refuses a non-number visibly instead of stripping it to another number', () => {
    input.value = '4';
    const ev = paste('37.5 mm');
    expect(ev.defaultPrevented).toBe(true);
    expect(input.value).toBe('4');
    expect(input.getAttribute('data-numeric-invalid')).toBe('true');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.validity.customError).toBe(true);
    // The next edit clears the invalid mark.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.hasAttribute('data-numeric-invalid')).toBe(false);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('does not take over aria-invalid owned by the field', () => {
    input.setAttribute('aria-invalid', 'true');
    paste('abc');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('ignores non-numeric fields and fields that handle their own paste', () => {
    const text = document.createElement('input');
    document.body.appendChild(text);
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: { getData: () => '−1' } });
    text.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    text.remove();
    input.dataset.numericPaste = 'self';
    expect(paste('−1').defaultPrevented).toBe(false);
  });
});

describe('asciiCopyHandler', () => {
  afterEach(() => vi.restoreAllMocks());
  it('puts ASCII minus on the clipboard', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '(−37.5, −18.5, 17.5)' } as Selection);
    const setData = vi.fn();
    const preventDefault = vi.fn();
    asciiCopyHandler({ clipboardData: { setData } as unknown as DataTransfer, preventDefault });
    expect(setData).toHaveBeenCalledWith('text/plain', '(-37.5, -18.5, 17.5)');
    expect(preventDefault).toHaveBeenCalled();
  });
  it('leaves a selection without minus signs alone', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '17.5' } as Selection);
    const setData = vi.fn();
    const preventDefault = vi.fn();
    asciiCopyHandler({ clipboardData: { setData } as unknown as DataTransfer, preventDefault });
    expect(setData).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

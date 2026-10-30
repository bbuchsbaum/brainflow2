import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getKeyboardShortcutService } from '../KeyboardShortcutService';

/** QA 2026-10-29 §4.2–4.3: '?', Space ownership and modal/field suppression. */
describe('KeyboardShortcutService (QA 2026-10-29)', () => {
  const service = getKeyboardShortcutService();

  beforeEach(() => {
    service.destroy();
    service.init();
  });

  afterEach(() => {
    service.destroy();
    document.body.innerHTML = '';
  });

  const press = (target: EventTarget, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  it("matches '?' with or without Shift (the character implies it)", () => {
    const handler = vi.fn();
    service.register({ id: 't.help', key: '?', category: 'T', description: 'help', handler });
    press(window, { key: '?', shiftKey: true });
    press(window, { key: '?', shiftKey: false });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('still requires Shift to be absent for letters and named keys', () => {
    const letter = vi.fn();
    const arrow = vi.fn();
    service.register({ id: 't.g', key: 'g', category: 'T', description: 'g', handler: letter });
    service.register({ id: 't.up', key: 'ArrowUp', category: 'T', description: 'up', handler: arrow });
    press(window, { key: 'G', shiftKey: true });
    press(window, { key: 'ArrowUp', shiftKey: true });
    expect(letter).not.toHaveBeenCalled();
    expect(arrow).not.toHaveBeenCalled();
  });

  it('suppresses shortcuts while typing in a field, except allowInInputs ones', () => {
    const plain = vi.fn();
    const palette = vi.fn();
    service.register({ id: 't.space', key: ' ', category: 'T', description: 'play', handler: plain });
    service.register({
      id: 't.k',
      key: 'k',
      modifiers: { meta: true },
      allowInInputs: true,
      category: 'T',
      description: 'palette',
      handler: palette,
    });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(press(input, { key: ' ', code: 'Space' }).defaultPrevented).toBe(false);
    press(input, { key: 'k', metaKey: true });
    expect(plain).not.toHaveBeenCalled();
    expect(palette).toHaveBeenCalledTimes(1);
  });

  it('suppresses non-field shortcuts inside an open modal dialog', () => {
    const plain = vi.fn();
    service.register({ id: 't.up', key: 'ArrowUp', category: 'T', description: 'up', handler: plain });
    document.body.innerHTML =
      '<div role="dialog" aria-modal="true"><div tabindex="-1" id="inside"></div></div>';
    press(document.getElementById('inside')!, { key: 'ArrowUp' });
    expect(plain).not.toHaveBeenCalled();
  });

  it('plays/pauses with Space on a control focused by a pointer click (not :focus-visible)', () => {
    const play = vi.fn();
    service.register({ id: 't.space', key: ' ', category: 'T', description: 'play', handler: play });
    document.body.innerHTML = '<div role="option" tabindex="0" id="row">layer</div>';
    const row = document.getElementById('row')!;
    row.focus();
    const matches = vi.spyOn(row, 'matches').mockImplementation((selector: string) =>
      selector === ':focus-visible' ? false : Element.prototype.matches.call(row, selector),
    );
    expect(press(row, { key: ' ', code: 'Space' }).defaultPrevented).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);

    // Reached from the keyboard, the control keeps Space for itself.
    matches.mockImplementation((selector: string) =>
      selector === ':focus-visible' ? true : Element.prototype.matches.call(row, selector),
    );
    expect(press(row, { key: ' ', code: 'Space' }).defaultPrevented).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
  });
});

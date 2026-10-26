import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { getKeyboardShortcutService } from '../KeyboardShortcutService';
import { Switch } from '@/components/ui/bf';

/**
 * The global Space shortcut (time play/pause) must not steal Space from
 * controls whose own activation key is Space (APG button / switch /
 * checkbox / radio / option / tab). preventDefault on keydown cancels the
 * button's click, so a bf Switch would stop toggling with Space.
 */
describe('KeyboardShortcutService: Space belongs to the focused control', () => {
  const service = getKeyboardShortcutService();
  const playPause = vi.fn();

  beforeEach(() => {
    service.destroy();
    service.init();
    playPause.mockReset();
    service.register({
      id: 'time.playPause',
      key: ' ',
      category: 'Test',
      description: 'Play/pause',
      handler: playPause,
    });
  });

  afterEach(() => service.destroy());

  function SwitchHarness() {
    const [on, setOn] = useState(false);
    return (
      <Switch checked={on} onCheckedChange={setOn}>
        Remember password
      </Switch>
    );
  }

  it('Space on a bf Switch is not consumed by play/pause', () => {
    render(<SwitchHarness />);
    const sw = screen.getByRole('switch', { name: 'Remember password' });
    sw.focus();
    const notPrevented = fireEvent.keyDown(sw, { key: ' ', code: 'Space' });
    expect(notPrevented).toBe(true); // the button's native click can still fire
    expect(playPause).not.toHaveBeenCalled();
    // The browser turns an un-prevented Space on a button into a click.
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it.each([
    ['button', <button type="button">b</button>],
    [
      'role=switch',
      <div role="switch" aria-checked="false" tabIndex={0}>
        s
      </div>,
    ],
    [
      'role=checkbox',
      <div role="checkbox" aria-checked="false" tabIndex={0}>
        c
      </div>,
    ],
    [
      'role=radio',
      <div role="radio" aria-checked="false" tabIndex={0}>
        r
      </div>,
    ],
    [
      'role=option',
      <div role="option" aria-selected="false" tabIndex={0}>
        o
      </div>,
    ],
    [
      'role=tab',
      <div role="tab" aria-selected="false" tabIndex={0}>
        t
      </div>,
    ],
    [
      'select',
      <select>
        <option>a</option>
      </select>,
    ],
    [
      'contenteditable',
      <div contentEditable suppressContentEditableWarning>
        e
      </div>,
    ],
    [
      'inside a button',
      <button type="button">
        <span data-testid="inner">i</span>
      </button>,
    ],
  ])('ignores Space when the target is (inside) %s', (_name, el) => {
    const { container } = render(<div>{el}</div>);
    const target =
      container.querySelector('[data-testid="inner"]') ??
      (container.firstElementChild!.firstElementChild as HTMLElement);
    fireEvent.keyDown(target, { key: ' ', code: 'Space' });
    expect(playPause).not.toHaveBeenCalled();
  });

  it('still plays/pauses from a non-interactive target (viewport/body)', () => {
    const { container } = render(<div tabIndex={-1} data-testid="viewport" />);
    const viewport = container.firstElementChild as HTMLElement;
    const notPrevented = fireEvent.keyDown(viewport, { key: ' ', code: 'Space' });
    expect(playPause).toHaveBeenCalledTimes(1);
    expect(notPrevented).toBe(false);
  });
});

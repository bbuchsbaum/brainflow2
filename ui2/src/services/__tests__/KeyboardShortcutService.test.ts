import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getKeyboardShortcutService } from '../KeyboardShortcutService';

describe('KeyboardShortcutService', () => {
  const service = getKeyboardShortcutService();

  beforeEach(() => {
    service.destroy();
    service.init();
  });

  afterEach(() => {
    service.destroy();
  });

  it('dispatches matching shortcuts when event is unhandled', () => {
    const handler = vi.fn();
    const unregister = service.register({
      id: 'test.next',
      key: 'ArrowRight',
      category: 'Test',
      description: 'Test shortcut',
      handler,
    });

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('does not dispatch when key event was already handled', () => {
    const handler = vi.fn();
    const unregister = service.register({
      id: 'test.handled',
      key: 'ArrowRight',
      category: 'Test',
      description: 'Handled event should not dispatch',
      handler,
    });

    const target = document.createElement('div');
    target.tabIndex = 0;
    target.addEventListener('keydown', (event) => {
      event.preventDefault();
    });
    document.body.appendChild(target);

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);

    expect(handler).not.toHaveBeenCalled();

    unregister();
    target.remove();
  });
});

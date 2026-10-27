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

  it('fires allowInInputs shortcuts from a text field, unless the field owns its shortcuts', () => {
    const palette = vi.fn();
    const plain = vi.fn();
    const off1 = service.register({ id: 't.palette', key: 'k', modifiers: { meta: true }, allowInInputs: true, category: 'T', description: 'p', handler: palette });
    const off2 = service.register({ id: 't.plain', key: 'g', category: 'T', description: 'g', handler: plain });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true }));
    expect(palette).toHaveBeenCalledTimes(1);
    expect(plain).not.toHaveBeenCalled();
    const owner = document.createElement('div');
    owner.setAttribute('data-own-shortcuts', '');
    const editor = document.createElement('textarea');
    owner.appendChild(editor);
    document.body.appendChild(owner);
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    expect(palette).toHaveBeenCalledTimes(1);
    off1();
    off2();
    input.remove();
    owner.remove();
  });
});


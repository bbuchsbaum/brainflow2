import { describe, expect, it, vi } from 'vitest';
import {
  findShortcutConflicts,
  getKeyboardShortcutService,
  shortcutChord,
  type ShortcutRegistration,
} from '../KeyboardShortcutService';
import { platformShortcuts, shortcutLabel } from '@/components/dialogs/shortcutLabels';

const reg = (id: string, key: string, extra: Partial<ShortcutRegistration> = {}): ShortcutRegistration => ({
  id,
  key,
  category: 'T',
  description: id,
  handler: () => {},
  ...extra,
});

describe('shortcut conflicts (QA 2026-10-30 F41)', () => {
  it('flags two unconditional bindings of one chord in one scope', () => {
    const conflicts = findShortcutConflicts([reg('a', '0'), reg('b', '0'), reg('c', 'o')]);
    expect(conflicts.map(([x, y]) => [x.id, y.id])).toEqual([['a', 'b']]);
  });

  it('modifiers, priority and a `when` scope make bindings distinct', () => {
    expect(
      findShortcutConflicts([
        reg('a', 'c'),
        reg('b', 'c', { modifiers: { meta: true, shift: true } }),
        reg('c', 'C'.toLowerCase(), { when: () => true }),
        reg('d', 'c', { priority: 10 }),
        reg('e', 'k', { modifiers: { meta: true } }),
        reg('f', 'k', { modifiers: { ctrl: true } }),
      ]),
    ).toEqual([]);
    expect(shortcutChord(reg('x', 'K', { modifiers: { shift: true, meta: true } }))).toBe('shift+meta+k');
  });

  it('the service warns when a registration shadows another', () => {
    const service = getKeyboardShortcutService();
    service.unregisterAll();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    service.register(reg('layers.showAll', '0'));
    service.register(reg('nav.goToOrigin', 'o'));
    expect(warn).not.toHaveBeenCalled();
    expect(service.getConflicts()).toEqual([]);
    service.register(reg('other.zero', '0'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"0" is bound twice'));
    expect(service.getConflicts()).toHaveLength(1);
    warn.mockRestore();
    service.unregisterAll();
  });
});

describe('Keyboard shortcuts dialog labels (F41)', () => {
  const meta = reg('palette.meta', 'k', { modifiers: { meta: true }, description: 'Open command palette' });
  const ctrl = reg('palette.ctrl', 'k', { modifiers: { ctrl: true }, description: 'Open command palette' });
  const solo = reg('copy', 'c', { modifiers: { meta: true, shift: true }, description: 'Copy view' });

  it('lists a Cmd/Ctrl pair once, with the platform modifier', () => {
    expect(platformShortcuts([meta, ctrl, solo], true).map((r) => r.id)).toEqual(['palette.meta', 'copy']);
    expect(platformShortcuts([meta, ctrl, solo], false).map((r) => r.id)).toEqual(['palette.ctrl', 'copy']);
  });

  it('writes chords the platform way', () => {
    expect(shortcutLabel(meta, true)).toBe('⌘K');
    expect(shortcutLabel(solo, true)).toBe('⇧⌘C');
    expect(shortcutLabel(ctrl, false)).toBe('Ctrl+K');
    expect(shortcutLabel(reg('zero', '0'), true)).toBe('0');
    // "O" next to "0" in a mono font: the letter is named (QA 2026-10-31).
    expect(shortcutLabel(reg('origin', 'o'), true)).toBe('O (letter)');
    expect(shortcutLabel(reg('header', 'i', { modifiers: { meta: true } }), true)).toBe('⌘I');
  });
});

describe('shared shortcut ids (review: F and L died when one view unmounted)', () => {
  const press = (key: string) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  it('unmounting one of two registrants of an id keeps the shortcut working', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useShortcut } = await import('@/hooks/useShortcut');
    const service = getKeyboardShortcutService();
    service.destroy();
    service.init();
    const axial = vi.fn();
    const deck = vi.fn();
    const mount = (handler: () => void) =>
      renderHook(() => useShortcut({ id: 'view.fit', key: 'f', category: 'View', description: 'Fit', handler }));
    const a = mount(axial);
    const b = mount(deck);
    // The Studio Deck's view unmounts (a lens switch): F still fits.
    b.unmount();
    press('f');
    expect(axial).toHaveBeenCalledTimes(1);
    expect(deck).not.toHaveBeenCalled();
    a.unmount();
    press('f');
    expect(axial).toHaveBeenCalledTimes(1);
    service.destroy();
  });

  it('the conflict guard still sees one binding per shared id', () => {
    const service = getKeyboardShortcutService();
    service.unregisterAll();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const offA = service.register(reg('toggle-orientation-labels', 'l'));
    const offB = service.register(reg('toggle-orientation-labels', 'l'));
    expect(service.getConflicts()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    service.register(reg('other.l', 'l'));
    expect(service.getConflicts()).toHaveLength(1);
    offA();
    offB();
    expect(service.getAll().T?.map((r) => r.id)).toEqual(['other.l']);
    warn.mockRestore();
    service.unregisterAll();
  });
});

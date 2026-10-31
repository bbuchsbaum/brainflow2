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
  });
});

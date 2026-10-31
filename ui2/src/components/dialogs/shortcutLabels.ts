/** Keyboard shortcuts dialog: platform chord labels and Cmd/Ctrl twins. */
import type { ShortcutRegistration } from '@/services/KeyboardShortcutService';
import { formatShortcut, isMacPlatform } from './commandPaletteMatch';

/** Letter keys that look like a digit in the dialog's mono font. */
const LETTER_LIKE_DIGIT: ReadonlySet<string> = new Set(['o', 'i', 'l']);

/**
 * The chord as the platform writes it: "⇧⌘C" on macOS, "Ctrl+Shift+C"
 * elsewhere (formatShortcut).
 */
export function shortcutLabel(reg: ShortcutRegistration, mac: boolean = isMacPlatform()): string {
  const parts: string[] = [];
  const mods = reg.modifiers ?? {};
  if (mods.ctrl) parts.push('Ctrl');
  if (mods.meta) parts.push('Cmd');
  if (mods.alt) parts.push('Alt');
  if (mods.shift) parts.push('Shift');

  let key = reg.key;
  if (key === ' ') key = 'Space';
  else if (key === 'ArrowLeft') key = '←';
  else if (key === 'ArrowRight') key = '→';
  else if (key === 'ArrowUp') key = '↑';
  else if (key === 'ArrowDown') key = '↓';
  // A bare letter a mono font draws like a digit is named (QA 2026-10-31:
  // "O" for the origin read as "0", Show all layers). With a modifier
  // ("⌘I") there is no digit to confuse it with.
  else if (parts.length === 0 && LETTER_LIKE_DIGIT.has(key.toLowerCase())) key = `${key.toUpperCase()} (letter)`;
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);

  return formatShortcut(parts.join('+'), mac);
}

/**
 * The registrations to list: a command bound to both Cmd and Ctrl (one for
 * each platform) is listed once, with this platform's modifier (QA
 * 2026-10-30 F41: the Mac dialog listed both "Cmd+K" and "Ctrl+K").
 */
export function platformShortcuts(
  regs: readonly ShortcutRegistration[],
  mac: boolean = isMacPlatform(),
): ShortcutRegistration[] {
  const twinKey = (r: ShortcutRegistration) => {
    const m = r.modifiers ?? {};
    return `${r.key.toLowerCase()}|${!!m.shift}|${!!m.alt}|${r.description}`;
  };
  const both = new Map<string, { meta: boolean; ctrl: boolean }>();
  for (const r of regs) {
    const m = r.modifiers ?? {};
    if (!!m.meta === !!m.ctrl) continue;
    const entry = both.get(twinKey(r)) ?? { meta: false, ctrl: false };
    if (m.meta) entry.meta = true;
    else entry.ctrl = true;
    both.set(twinKey(r), entry);
  }
  return regs.filter((r) => {
    const m = r.modifiers ?? {};
    if (!!m.meta === !!m.ctrl) return true;
    const entry = both.get(twinKey(r));
    if (!entry?.meta || !entry.ctrl) return true;
    return mac ? !!m.meta : !!m.ctrl;
  });
}

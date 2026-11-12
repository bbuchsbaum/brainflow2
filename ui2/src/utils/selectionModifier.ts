/**
 * The additive-selection modifier, one rule for every Set studio surface
 * (montage tiles, the relationship scatter): Shift, or the platform's command
 * key — ⌘ on a Mac, Ctrl elsewhere. On a Mac Ctrl-click is the context-menu
 * press, so it never selects there.
 */

interface ModifierState {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** True on macOS (and iPadOS/iOS), read at call time. */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Shift, or ⌘ on a Mac / Ctrl elsewhere: the gesture adds to the selection. */
export function isAdditive(event: ModifierState): boolean {
  return event.shiftKey || (isMacPlatform() ? event.metaKey : event.ctrlKey);
}

/** The command key's name in hint text: "⌘" on a Mac, "Ctrl" elsewhere. */
export function additiveKeyLabel(): string {
  return isMacPlatform() ? '⌘' : 'Ctrl';
}

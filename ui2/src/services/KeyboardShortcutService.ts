/**
 * KeyboardShortcutService
 * Centralized keyboard shortcut management with priority-based dispatch,
 * conditional activation, and a single global keydown listener.
 */

export interface ShortcutModifiers {
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  alt?: boolean;
}

export interface ShortcutRegistration {
  id: string;
  key: string;
  modifiers?: ShortcutModifiers;
  handler: () => void;
  priority?: number;
  when?: () => boolean;
  /**
   * Also fire while a text field has focus (e.g. Cmd+K for the command
   * palette). A field that uses the same chord itself opts out with
   * `data-own-shortcuts`.
   */
  allowInInputs?: boolean;
  category: string;
  description: string;
}

type UnregisterFn = () => void;

function normalizeKey(key: string): string {
  // Normalize single letter keys to lowercase for case-insensitive matching
  if (key.length === 1 && /[a-zA-Z]/.test(key)) {
    return key.toLowerCase();
  }
  return key;
}

function isInputTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return false;
}

/**
 * Controls whose own activation key is Space (APG button, switch, checkbox,
 * radio, option and tab patterns). A global Space shortcut (time play/pause)
 * must not steal it: preventDefault on keydown cancels the button's click.
 */
const SPACE_OWNERS =
  'button, summary, select, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"], [role="treeitem"], [contenteditable=""], [contenteditable="true"]';

function isSpaceOwnerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(SPACE_OWNERS) === null) return false;
  // A control focused by a pointer click (a layer row, a mode segment) is not
  // where the user is typing: Space is still play/pause there. Only a control
  // reached from the keyboard (:focus-visible) keeps Space as its own key.
  return !isPointerFocused(target);
}

function isPointerFocused(target: Element): boolean {
  if (target.ownerDocument.activeElement !== target) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return false;
  try {
    return !target.matches(':focus-visible');
  } catch {
    return false; // no :focus-visible support: keep the control's Space
  }
}

/** Inside an open modal dialog only shortcuts that also work in fields fire. */
function isInModalDialog(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[aria-modal="true"]') !== null;
}

/**
 * Printable punctuation ('?', '+', '!'): the character already encodes Shift
 * (Shift+/ is '?' on US layouts, a plain key elsewhere), so Shift is not
 * matched unless the registration asks for it explicitly.
 */
function isShiftImplied(key: string): boolean {
  return key.length === 1 && /[^\p{L}\p{N}\s]/u.test(key);
}

function isSpaceKey(event: KeyboardEvent): boolean {
  return event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';
}

function modifiersMatch(
  event: KeyboardEvent,
  modifiers: ShortcutModifiers | undefined,
  key: string,
): boolean {
  const mods = modifiers ?? {};
  const ctrlOk = mods.ctrl ? event.ctrlKey : !event.ctrlKey;
  const metaOk = mods.meta ? event.metaKey : !event.metaKey;
  const altOk = mods.alt ? event.altKey : !event.altKey;
  // Shift: if explicitly required, must be pressed; if not specified, must NOT
  // be pressed — except for punctuation, whose character implies it.
  const shiftOk =
    mods.shift === undefined && isShiftImplied(key)
      ? true
      : mods.shift
        ? event.shiftKey
        : !event.shiftKey;
  return ctrlOk && metaOk && altOk && shiftOk;
}

class KeyboardShortcutService {
  private registrations: Map<string, ShortcutRegistration> = new Map();
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    window.addEventListener('keydown', this.handleKeyDown);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    this.initialized = false;
    this.registrations.clear();
  }

  register(reg: ShortcutRegistration): UnregisterFn {
    if (this.registrations.has(reg.id)) {
      console.warn(`[KeyboardShortcutService] Overwriting shortcut id="${reg.id}"`);
    }
    const full: ShortcutRegistration = { priority: 0, ...reg };
    this.registrations.set(reg.id, full);
    return () => this.unregister(reg.id);
  }

  unregister(id: string): void {
    this.registrations.delete(id);
  }

  unregisterAll(): void {
    this.registrations.clear();
  }

  getAll(): Record<string, ShortcutRegistration[]> {
    const grouped: Record<string, ShortcutRegistration[]> = {};
    for (const reg of this.registrations.values()) {
      if (!grouped[reg.category]) {
        grouped[reg.category] = [];
      }
      grouped[reg.category].push(reg);
    }
    return grouped;
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const inInput = isInputTarget(event.target);
    if (
      inInput &&
      event.target instanceof HTMLElement &&
      event.target.closest('[data-own-shortcuts]')
    ) {
      return;
    }
    if (isSpaceKey(event) && isSpaceOwnerTarget(event.target)) return;
    const fieldsOnly = inInput || isInModalDialog(event.target);

    const eventKey = normalizeKey(event.key);
    let best: ShortcutRegistration | null = null;

    for (const reg of this.registrations.values()) {
      const regKey = normalizeKey(reg.key);
      if (regKey !== eventKey) continue;
      if (!modifiersMatch(event, reg.modifiers, regKey)) continue;
      if (reg.when && !reg.when()) continue;
      if (fieldsOnly && !reg.allowInInputs) continue;

      const priority = reg.priority ?? 0;
      if (!best || priority > (best.priority ?? 0)) {
        best = reg;
      }
    }

    if (best) {
      event.preventDefault();
      best.handler();
    }
  };
}

let globalKeyboardShortcutService: KeyboardShortcutService | null = null;

export function getKeyboardShortcutService(): KeyboardShortcutService {
  if (!globalKeyboardShortcutService) {
    globalKeyboardShortcutService = new KeyboardShortcutService();
  }
  return globalKeyboardShortcutService;
}

export function setKeyboardShortcutService(service: KeyboardShortcutService): void {
  globalKeyboardShortcutService = service;
}

export type { KeyboardShortcutService };

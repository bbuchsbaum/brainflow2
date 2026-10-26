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
  return target.closest(SPACE_OWNERS) !== null;
}

function isSpaceKey(event: KeyboardEvent): boolean {
  return event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space';
}

function modifiersMatch(event: KeyboardEvent, modifiers?: ShortcutModifiers): boolean {
  const mods = modifiers ?? {};
  const ctrlOk = mods.ctrl ? event.ctrlKey : !event.ctrlKey;
  const metaOk = mods.meta ? event.metaKey : !event.metaKey;
  const altOk = mods.alt ? event.altKey : !event.altKey;
  // Shift: if explicitly required, must be pressed; if not specified, must NOT be pressed
  // Exception: if key is uppercase letter (shift implied), allow shift even when not specified
  const shiftOk = mods.shift ? event.shiftKey : !event.shiftKey;
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
    if (isInputTarget(event.target)) return;
    if (isSpaceKey(event) && isSpaceOwnerTarget(event.target)) return;

    const eventKey = normalizeKey(event.key);
    let best: ShortcutRegistration | null = null;

    for (const reg of this.registrations.values()) {
      const regKey = normalizeKey(reg.key);
      if (regKey !== eventKey) continue;
      if (!modifiersMatch(event, reg.modifiers)) continue;
      if (reg.when && !reg.when()) continue;

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

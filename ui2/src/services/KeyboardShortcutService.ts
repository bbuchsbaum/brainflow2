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

/** The chord a registration answers: key plus exact modifiers ("meta+shift+c"). */
export function shortcutChord(reg: Pick<ShortcutRegistration, 'key' | 'modifiers'>): string {
  const m = reg.modifiers ?? {};
  const mods = (['ctrl', 'alt', 'shift', 'meta'] as const).filter((k) => m[k]);
  return [...mods, normalizeKey(reg.key)].join('+');
}

/**
 * Registrations that answer the same chord in the same scope: neither is
 * conditional (`when`) and they share a priority, so one silently shadows the
 * other (QA 2026-10-30 F41). Conditional ones are scoped by their predicate.
 */
export function findShortcutConflicts(
  regs: Iterable<ShortcutRegistration>,
): Array<[ShortcutRegistration, ShortcutRegistration]> {
  const seen = new Map<string, ShortcutRegistration>();
  const conflicts: Array<[ShortcutRegistration, ShortcutRegistration]> = [];
  for (const reg of regs) {
    if (reg.when) continue;
    const scope = `${shortcutChord(reg)}@${reg.priority ?? 0}`;
    const other = seen.get(scope);
    if (other) conflicts.push([other, reg]);
    else seen.set(scope, reg);
  }
  return conflicts;
}

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

export function isPointerFocused(target: Element): boolean {
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
  /** The registration in effect per id (the latest still registered). */
  private registrations: Map<string, ShortcutRegistration> = new Map();
  /**
   * Every live registration per id, oldest first. Views register shared ids
   * (`view.fit`, `toggle-orientation-labels`) once per mounted view; one
   * view unmounting must not remove the shortcut the others still hold.
   */
  private holders: Map<string, ShortcutRegistration[]> = new Map();
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
    this.holders.clear();
  }

  register(reg: ShortcutRegistration): UnregisterFn {
    const current = this.registrations.get(reg.id);
    if (current && shortcutChord(current) !== shortcutChord(reg)) {
      console.warn(`[KeyboardShortcutService] Overwriting shortcut id="${reg.id}" with another key`);
    }
    const full: ShortcutRegistration = { priority: 0, ...reg };
    this.holders.set(reg.id, [...(this.holders.get(reg.id) ?? []), full]);
    this.registrations.set(reg.id, full);
    for (const [a, b] of findShortcutConflicts(this.registrations.values())) {
      if (a.id === reg.id || b.id === reg.id) {
        console.warn(
          `[KeyboardShortcutService] "${shortcutChord(reg)}" is bound twice: "${a.description}" (${a.id}) and "${b.description}" (${b.id})`,
        );
      }
    }
    // Removes this registration only; another holder of the id takes over.
    return () => this.release(reg.id, full);
  }

  private release(id: string, reg: ShortcutRegistration): void {
    const rest = (this.holders.get(id) ?? []).filter((r) => r !== reg);
    if (rest.length > 0) {
      this.holders.set(id, rest);
      if (this.registrations.get(id) === reg) this.registrations.set(id, rest[rest.length - 1]);
    } else {
      this.holders.delete(id);
      if (this.registrations.get(id) === reg) this.registrations.delete(id);
    }
  }

  /** Remove every registration of `id`, whoever made it (tests, teardown). */
  unregister(id: string): void {
    this.registrations.delete(id);
    this.holders.delete(id);
  }

  unregisterAll(): void {
    this.registrations.clear();
    this.holders.clear();
  }

  /** Unconditional registrations that share a chord (see findShortcutConflicts). */
  getConflicts(): Array<[ShortcutRegistration, ShortcutRegistration]> {
    return findShortcutConflicts(this.registrations.values());
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

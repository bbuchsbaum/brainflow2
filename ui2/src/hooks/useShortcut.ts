/**
 * useShortcut Hook
 * React wrapper around KeyboardShortcutService that handles registration
 * and cleanup via useEffect lifecycle.
 */

import { useEffect, useRef } from 'react';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';
import type { ShortcutRegistration } from '@/services/KeyboardShortcutService';

export function useShortcut(reg: ShortcutRegistration): void {
  // Keep a stable ref to the handler so we don't re-register on every render
  const handlerRef = useRef(reg.handler);
  handlerRef.current = reg.handler;

  // Keep a stable ref to the when predicate
  const whenRef = useRef(reg.when);
  whenRef.current = reg.when;

  const { id, key, modifiers, priority, category, description } = reg;

  useEffect(() => {
    const service = getKeyboardShortcutService();
    const unregister = service.register({
      id,
      key,
      modifiers,
      handler: () => handlerRef.current(),
      when: whenRef.current ? () => whenRef.current!() : undefined,
      priority,
      category,
      description,
    });
    return unregister;
  // Re-register when structural properties change, but not when handler/when change
  // (those are kept current via refs)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key, JSON.stringify(modifiers), priority, category, description]);
}

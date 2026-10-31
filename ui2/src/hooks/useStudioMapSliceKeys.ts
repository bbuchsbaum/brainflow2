import { useEffect, useRef, type RefObject } from 'react';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';

interface StudioMap {
  engaged: () => boolean;
  step: (slices: number) => void;
}

const maps = new Set<StudioMap>();
let unregister: Array<() => void> = [];

const KEYS = [
  ['up', 'ArrowUp', undefined, 1, 'Next slice of the Studio map under the pointer'],
  ['down', 'ArrowDown', undefined, -1, 'Previous slice of the Studio map under the pointer'],
  ['up10', 'ArrowUp', { shift: true }, 10, 'Jump 10 slices forward in the Studio map'],
  ['down10', 'ArrowDown', { shift: true }, -10, 'Jump 10 slices back in the Studio map'],
  ['pageUp', 'PageUp', undefined, 10, 'Jump 10 slices forward in the Studio map'],
  ['pageDown', 'PageDown', undefined, -10, 'Jump 10 slices back in the Studio map'],
] as const;

const engagedMap = () => [...maps].find((map) => map.engaged()) ?? null;

function registerKeys() {
  const service = getKeyboardShortcutService();
  unregister = KEYS.map(([name, key, modifiers, slices, description]) =>
    service.register({
      id: `studio.map.${name}`,
      key,
      modifiers,
      category: 'Studio',
      description,
      // Above the workspace slice keys (10–15).
      priority: 20,
      when: () => engagedMap() !== null,
      handler: () => engagedMap()?.step(slices),
    }),
  );
}

/**
 * While the pointer is over `ref`'s element, or focus is inside it, the slice
 * keys (↑/↓, ⇧↑/⇧↓, PageUp/PageDown) step that Studio map's own slice instead
 * of the workspace's active view (QA N9). One set of shortcuts serves every
 * mounted map. Text fields and controls that handle the arrows themselves
 * keep them (the shortcut service skips fields and handled events).
 */
export function useStudioMapSliceKeys(
  ref: RefObject<HTMLElement | null>,
  step: (slices: number) => void,
  enabled = true,
): void {
  const hovered = useRef(false);
  const latest = useRef(step);
  latest.current = step;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const enter = () => {
      hovered.current = true;
    };
    const leave = () => {
      hovered.current = false;
    };
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('mouseenter', enter);
    element.addEventListener('mouseleave', leave);
    return () => {
      hovered.current = false;
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('mouseenter', enter);
      element.removeEventListener('mouseleave', leave);
    };
  }, [ref]);

  useEffect(() => {
    if (!enabled) return;
    const map: StudioMap = {
      engaged: () => {
        const element = ref.current;
        // A map in a tab left behind (⌘1 with the pointer resting on it) gets
        // no pointerleave: it only counts while it is on screen (review L3).
        if (!element || !element.isConnected || element.getClientRects().length === 0) {
          hovered.current = false;
          return false;
        }
        const focused = document.activeElement;
        return (
          hovered.current || (!!focused && focused !== document.body && element.contains(focused))
        );
      },
      step: (slices) => latest.current(slices),
    };
    if (maps.size === 0) registerKeys();
    maps.add(map);
    return () => {
      hovered.current = false;
      maps.delete(map);
      if (maps.size === 0) {
        unregister.forEach((fn) => fn());
        unregister = [];
      }
    };
  }, [enabled, ref]);
}

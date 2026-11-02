import { useEffect } from 'react';
import { openSelectedRun } from '@/services/bids/openRunInViewer';
import { undoLastExclusion } from '@/services/bids/undoLastExclusion';
import { getKeyboardShortcutService, type ShortcutRegistration } from '@/services/KeyboardShortcutService';
import { isModalDialogOpen } from '@/services/workspaceNavigation';
import { useBidsStore } from '@/stores/bidsStore';
import type { BidsMoveDirection } from '@/stores/bidsModel';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { isTextEditingElement } from '@/utils/editSelectAll';

/**
 * Above the viewer's shortcuts on the same keys (1 and 2 layers.toggle,
 * C nav.goToCenter, L orientation labels, Space time.playPause), and only while
 * the BIDS tab is in front: a hidden tab may stay mounted.
 */
export const BIDS_SHORTCUT_PRIORITY = 40;
const CATEGORY = 'BIDS browser';

const INTERACTIVE =
  'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="listbox"]';

/**
 * Edit › Undo and ⌘Z mean the same thing here. True when an exclusion took the
 * undo; otherwise the caller's scene undo goes ahead.
 */
export function undoBidsExclusion(): boolean {
  if (!bidsInFront() || !hasUndo()) return false;
  void undoLastExclusion();
  return true;
}

function bidsInFront(): boolean {
  return (
    useWorkspaceStore.getState().getActiveWorkspace()?.type === 'bids-explorer' &&
    !isModalDialogOpen()
  );
}

const hasUndo = () =>
  useBidsStore.getState().undoStack.length > 0 && !isTextEditingElement(document.activeElement);

export function useBidsShortcuts(): void {
  useEffect(() => {
    const service = getKeyboardShortcutService();
    const bids = () => useBidsStore.getState();
    const move = (key: string, direction: BidsMoveDirection): ShortcutRegistration => ({
      id: `bids.move.${direction}`,
      key,
      priority: BIDS_SHORTCUT_PRIORITY,
      category: CATEGORY,
      description: `Move ${direction}`,
      when: bidsInFront,
      handler: () => bids().moveSelection(direction),
    });
    const registrations: ShortcutRegistration[] = [
      move('j', 'down'),
      move('k', 'up'),
      move('h', 'left'),
      move('l', 'right'),
      {
        id: 'bids.view.coverage',
        key: '1',
        priority: BIDS_SHORTCUT_PRIORITY,
        category: CATEGORY,
        description: 'Coverage view',
        when: bidsInFront,
        handler: () => bids().setActiveView('coverage'),
      },
      {
        id: 'bids.openInViewer',
        key: 'Enter',
        priority: BIDS_SHORTCUT_PRIORITY,
        category: CATEGORY,
        description: 'Open in viewer',
        // A focused control keeps its own Enter.
        when: () => bidsInFront() && document.activeElement?.closest(INTERACTIVE) == null,
        handler: openSelectedRun,
      },
      {
        id: 'bids.quickLook',
        key: ' ',
        priority: BIDS_SHORTCUT_PRIORITY,
        category: CATEGORY,
        description: 'Quick look',
        when: bidsInFront,
        handler: () => bids().requestAction('quick-look'),
      },
      {
        id: 'bids.compare',
        key: 'c',
        priority: BIDS_SHORTCUT_PRIORITY,
        category: CATEGORY,
        description: 'Compare with modal',
        when: bidsInFront,
        handler: () => bids().requestAction('compare'),
      },
      {
        id: 'bids.exclude',
        key: 'x',
        priority: BIDS_SHORTCUT_PRIORITY,
        category: CATEGORY,
        description: 'Exclude',
        when: bidsInFront,
        handler: () => bids().requestAction('exclude'),
      },
      ...(['meta', 'ctrl'] as const).map(
        (modifier): ShortcutRegistration => ({
          id: `bids.undo.${modifier}`,
          key: 'z',
          modifiers: { [modifier]: true },
          priority: BIDS_SHORTCUT_PRIORITY,
          category: CATEGORY,
          description: 'Undo the last exclusion',
          // As edit.undo, which takes over when the stack is empty.
          allowInInputs: true,
          when: () => bidsInFront() && hasUndo(),
          handler: () => void undoLastExclusion(),
        }),
      ),
    ];
    const stops = registrations.map((registration) => service.register(registration));
    return () => stops.forEach((stop) => stop());
  }, []);
}

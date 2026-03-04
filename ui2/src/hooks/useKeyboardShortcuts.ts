/**
 * useKeyboardShortcuts Hook
 * Global keyboard shortcuts for the application.
 * Uses KeyboardShortcutService for centralized registration.
 */

import { useEffect } from 'react';
import { useTimeNavigation } from './useTimeNavigation';
import { getTimeNavigationService } from '@/services/TimeNavigationService';
import { getEventBus } from '@/events/EventBus';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';

const CATEGORY = 'Time Navigation';

export function useKeyboardShortcuts() {
  const timeNav = useTimeNavigation();
  const service = getKeyboardShortcutService();

  useEffect(() => {
    const has4D = () => timeNav.has4DVolume();

    const unregisterFns = [
      service.register({
        id: 'time.prev',
        key: 'ArrowLeft',
        category: CATEGORY,
        description: 'Previous timepoint',
        when: has4D,
        handler: () => {
          getTimeNavigationService().previousTimepoint();
        },
      }),
      service.register({
        id: 'time.next',
        key: 'ArrowRight',
        category: CATEGORY,
        description: 'Next timepoint',
        when: has4D,
        handler: () => {
          getTimeNavigationService().nextTimepoint();
        },
      }),
      service.register({
        id: 'time.prev10',
        key: 'ArrowLeft',
        modifiers: { shift: true },
        category: CATEGORY,
        description: 'Jump 10 timepoints backward',
        when: has4D,
        handler: () => {
          getTimeNavigationService().jumpTimepoints(-10);
        },
      }),
      service.register({
        id: 'time.next10',
        key: 'ArrowRight',
        modifiers: { shift: true },
        category: CATEGORY,
        description: 'Jump 10 timepoints forward',
        when: has4D,
        handler: () => {
          getTimeNavigationService().jumpTimepoints(10);
        },
      }),
      service.register({
        id: 'time.playPause',
        key: ' ',
        category: CATEGORY,
        description: 'Play/pause time animation',
        handler: () => {
          getEventBus().emit('playback.toggle');
        },
      }),
      service.register({
        id: 'time.toggleMode',
        key: 't',
        category: CATEGORY,
        description: 'Toggle time/slice navigation mode',
        handler: () => {
          const timeNavSvc = getTimeNavigationService();
          timeNavSvc.toggleMode();
          const mode = timeNavSvc.getMode();
          getEventBus().emit('ui.showNotification', {
            message: `Scroll wheel: ${mode === 'time' ? 'Time navigation' : 'Slice navigation'}`,
            duration: 1000,
          });
        },
      }),
    ];

    return () => {
      unregisterFns.forEach(fn => fn());
    };
  // Re-register when timeNav identity changes (i.e. when has4DVolume predicate changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeNav]);
}

// Legacy export kept for any consumers that import it
export { useKeyboardShortcuts };

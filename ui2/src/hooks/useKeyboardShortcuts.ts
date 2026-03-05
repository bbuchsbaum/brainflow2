/**
 * useKeyboardShortcuts Hook
 * Global keyboard shortcuts for the application.
 * Uses KeyboardShortcutService for centralized registration.
 */

import { useEffect } from 'react';
import { useTimeNavigation } from './useTimeNavigation';
import { getTimeNavigationService } from '@/services/TimeNavigationService';
import { getSliceNavigationService } from '@/services/SliceNavigationService';
import { getEventBus } from '@/events/EventBus';
import { getKeyboardShortcutService } from '@/services/KeyboardShortcutService';
import { useActiveRenderContextStore } from '@/stores/activeRenderContextStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { useLayoutStateStore } from '@/stores/layoutStateStore';
import type { ViewType } from '@/types/coordinates';

const CATEGORY = 'Time Navigation';
const SLICE_SHORTCUT_CATEGORY = 'Slice Navigation';

const SLICE_VIEWS: ReadonlySet<ViewType> = new Set(['axial', 'sagittal', 'coronal']);

function resolveActiveSliceView(): ViewType {
  const activeRenderable = useActiveRenderContextStore.getState().activeId;
  if (activeRenderable && SLICE_VIEWS.has(activeRenderable as ViewType)) {
    return activeRenderable as ViewType;
  }

  const mouseActive = useMouseCoordinateStore.getState().activeView;
  if (mouseActive) {
    return mouseActive;
  }

  return useLayoutStateStore.getState().layoutState.activeView;
}

function nudgeSlice(stepMultiplier: number): void {
  const viewId = resolveActiveSliceView();
  const sliceService = getSliceNavigationService();
  const { min, max, step, current } = sliceService.getSliceRange(viewId);
  const next = Math.max(min, Math.min(max, current + step * stepMultiplier));
  if (!Object.is(next, current)) {
    sliceService.updateSlicePosition(viewId, next);
  }
}

export function useKeyboardShortcuts() {
  const timeNav = useTimeNavigation();
  const service = getKeyboardShortcutService();

  useEffect(() => {
    const has4D = () => timeNav.has4DVolume();
    const isTimeMode = () =>
      has4D() && getTimeNavigationService().getMode() === 'time';

    const unregisterFns = [
      service.register({
        id: 'time.prev',
        key: 'ArrowLeft',
        category: CATEGORY,
        description: 'Previous timepoint',
        priority: 20,
        when: isTimeMode,
        handler: () => {
          getTimeNavigationService().previousTimepoint();
        },
      }),
      service.register({
        id: 'time.next',
        key: 'ArrowRight',
        category: CATEGORY,
        description: 'Next timepoint',
        priority: 20,
        when: isTimeMode,
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
        priority: 30,
        when: isTimeMode,
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
        priority: 30,
        when: isTimeMode,
        handler: () => {
          getTimeNavigationService().jumpTimepoints(10);
        },
      }),
      service.register({
        id: 'slice.prev',
        key: 'ArrowLeft',
        category: SLICE_SHORTCUT_CATEGORY,
        description: 'Previous slice in active view',
        priority: 10,
        when: () => !isTimeMode(),
        handler: () => {
          nudgeSlice(-1);
        },
      }),
      service.register({
        id: 'slice.next',
        key: 'ArrowRight',
        category: SLICE_SHORTCUT_CATEGORY,
        description: 'Next slice in active view',
        priority: 10,
        when: () => !isTimeMode(),
        handler: () => {
          nudgeSlice(1);
        },
      }),
      service.register({
        id: 'slice.prev10',
        key: 'ArrowLeft',
        modifiers: { shift: true },
        category: SLICE_SHORTCUT_CATEGORY,
        description: 'Jump 10 slices backward in active view',
        priority: 15,
        when: () => !isTimeMode(),
        handler: () => {
          nudgeSlice(-10);
        },
      }),
      service.register({
        id: 'slice.next10',
        key: 'ArrowRight',
        modifiers: { shift: true },
        category: SLICE_SHORTCUT_CATEGORY,
        description: 'Jump 10 slices forward in active view',
        priority: 15,
        when: () => !isTimeMode(),
        handler: () => {
          nudgeSlice(10);
        },
      }),
      service.register({
        id: 'time.playPause',
        key: ' ',
        category: CATEGORY,
        description: 'Play/pause time animation',
        handler: () => {
          getEventBus().emit('playback.toggle', {});
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
          getEventBus().emit('ui.notification', {
            type: 'info',
            message: `Scroll wheel: ${mode === 'time' ? 'Time navigation' : 'Slice navigation'}`,
            durationMs: 1000,
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

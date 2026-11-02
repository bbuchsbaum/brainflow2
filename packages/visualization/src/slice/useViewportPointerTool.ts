import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ViewportPointerController, type ViewportPointerSample, type ViewportTool } from './pointerTools.js';
import type { SliceViewerWorldCoord } from './types.js';

export function useViewportPointerTool(
  tool: ViewportTool | null | undefined,
  mapPoint: (x: number, y: number) => SliceViewerWorldCoord | null,
  defaultDown: (event: MouseEvent<HTMLDivElement>) => void,
) {
  const controller = useRef(new ViewportPointerController());
  const capture = useRef<{ element: HTMLDivElement; pointerId: number } | null>(null);
  const release = () => {
    const held = capture.current;
    capture.current = null;
    if (held?.element.hasPointerCapture?.(held.pointerId)) held.element.releasePointerCapture(held.pointerId);
  };
  useLayoutEffect(() => {
    controller.current.select(tool ?? null);
    release();
  }, [tool]);
  useEffect(() => {
    const current = controller.current;
    return () => { current.cancel('disposed'); release(); };
  }, []);

  const samples = (event: ReactPointerEvent<HTMLDivElement>): ViewportPointerSample[] => {
    const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const events = coalesced.length > 0 ? coalesced : [event.nativeEvent];
    return events.map((e) => ({
      world: mapPoint(e.clientX, e.clientY), pressure: e.pressure, timeStamp: e.timeStamp,
      pointerId: e.pointerId, pointerType: e.pointerType, button: e.button, buttons: e.buttons,
      shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
    }));
  };

  return {
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if (event.defaultPrevented) return;
      if (controller.current.down(samples(event))) {
        event.preventDefault();
        event.stopPropagation();
        if (controller.current.owns(event.pointerId)) {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          capture.current = { element: event.currentTarget, pointerId: event.pointerId };
        }
      } else if (event.pointerType !== 'mouse') {
        // Mouse compatibility events retain existing drag/navigation handlers;
        // pen/touch still have a working default crosshair when no tool takes them.
        defaultDown(event);
        event.preventDefault();
      }
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      if (controller.current.move(samples(event))) { event.preventDefault(); event.stopPropagation(); }
    },
    onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
      if (!controller.current.owns(event.pointerId)) return;
      try {
        controller.current.up(samples(event));
        event.preventDefault();
        event.stopPropagation();
      } finally { release(); }
    },
    onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
      if (controller.current.owns(event.pointerId)) { controller.current.cancel('cancelled'); release(); }
    },
    onLostPointerCapture(event: ReactPointerEvent<HTMLDivElement>) {
      if (controller.current.owns(event.pointerId)) { controller.current.cancel('capture-lost'); release(); }
    },
  };
}

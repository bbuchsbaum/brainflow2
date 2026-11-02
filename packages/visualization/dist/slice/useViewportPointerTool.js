import { useEffect, useLayoutEffect, useRef } from 'react';
import { ViewportPointerController } from './pointerTools.js';
export function useViewportPointerTool(tool, mapPoint, defaultDown) {
    const controller = useRef(new ViewportPointerController());
    const capture = useRef(null);
    const release = () => {
        const held = capture.current;
        capture.current = null;
        if (held?.element.hasPointerCapture?.(held.pointerId))
            held.element.releasePointerCapture(held.pointerId);
    };
    useLayoutEffect(() => {
        controller.current.select(tool ?? null);
        release();
    }, [tool]);
    useEffect(() => {
        const current = controller.current;
        return () => { current.cancel('disposed'); release(); };
    }, []);
    const samples = (event) => {
        const coalesced = event.nativeEvent.getCoalescedEvents?.() ?? [];
        const events = coalesced.length > 0 ? coalesced : [event.nativeEvent];
        return events.map((e) => ({
            world: mapPoint(e.clientX, e.clientY), pressure: e.pressure, timeStamp: e.timeStamp,
            pointerId: e.pointerId, pointerType: e.pointerType, button: e.button, buttons: e.buttons,
            shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
        }));
    };
    return {
        onPointerDown(event) {
            if (event.defaultPrevented)
                return;
            if (controller.current.down(samples(event))) {
                event.preventDefault();
                event.stopPropagation();
                if (controller.current.owns(event.pointerId)) {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    capture.current = { element: event.currentTarget, pointerId: event.pointerId };
                }
            }
            else if (event.pointerType !== 'mouse') {
                // Mouse compatibility events retain existing drag/navigation handlers;
                // pen/touch still have a working default crosshair when no tool takes them.
                defaultDown(event);
                event.preventDefault();
            }
        },
        onPointerMove(event) {
            if (controller.current.move(samples(event))) {
                event.preventDefault();
                event.stopPropagation();
            }
        },
        onPointerUp(event) {
            if (!controller.current.owns(event.pointerId))
                return;
            try {
                controller.current.up(samples(event));
                event.preventDefault();
                event.stopPropagation();
            }
            finally {
                release();
            }
        },
        onPointerCancel(event) {
            if (controller.current.owns(event.pointerId)) {
                controller.current.cancel('cancelled');
                release();
            }
        },
        onLostPointerCapture(event) {
            if (controller.current.owns(event.pointerId)) {
                controller.current.cancel('capture-lost');
                release();
            }
        },
    };
}
//# sourceMappingURL=useViewportPointerTool.js.map
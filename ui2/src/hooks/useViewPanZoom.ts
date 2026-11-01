/**
 * Pointer zoom and pan of a slice view (QA features 2026-10-31 §1).
 *
 * - ⌥-scroll and a pinch (ctrl-wheel in Chromium, gesture events in WebKit)
 *   zoom about the pointer. Plain and ⌘-scroll keep stepping slices
 *   (SliceViewCanvas's wheel handler; it calls {@link wheelZoomFactor}).
 * - Space-drag and a middle-button drag pan. A press that pans never moves
 *   the crosshair. Space over a view waits for its release: tapped, it is
 *   still Play/pause; held for a drag, it pans.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ViewType } from '@/types/coordinates';
import { getEventBus } from '@/events/EventBus';
import {
  panView,
  registerZoomPane,
  syncZoomedViewSize,
  zoomView,
} from '@/services/ViewZoomService';
import { isPointerFocused } from '@/services/KeyboardShortcutService';
import {
  beginRenderInteraction,
  endRenderInteraction,
  pulseRenderInteraction,
} from '@/utils/renderPixelRatio';

/** Zoom factor of one wheel event, or null when the wheel steps slices. */
export function wheelZoomFactor(
  event: Pick<WheelEvent, 'altKey' | 'ctrlKey' | 'deltaY' | 'deltaMode'>,
): number | null {
  if (!event.altKey && !event.ctrlKey) return null;
  const pixels =
    event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * 400
        : event.deltaY;
  // A pinch reports small deltas (ctrl-wheel): more zoom per pixel.
  const rate = event.ctrlKey && !event.altKey ? 0.01 : 0.002;
  // One event never zooms by more than a quarter: a mouse notch held with
  // ctrl (100 px) would otherwise jump ×0.37 (review L6).
  return Math.min(MAX_WHEEL_FACTOR, Math.max(1 / MAX_WHEEL_FACTOR, Math.exp(-pixels * rate)));
}

const MAX_WHEEL_FACTOR = 1.25;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

const isSpace = (event: KeyboardEvent) => event.key === ' ' || event.code === 'Space';

interface Options {
  viewType: ViewType;
  /** The canvas area (wheel, drag and gesture events). */
  areaRef: RefObject<HTMLElement | null>;
  canvas: () => HTMLCanvasElement | null;
  /** The canvas size; a zoomed plane is kept covering it. */
  size: [number, number];
}

/** Returns whether a pan is ready (Space held) or running, for the cursor. */
export function useViewPanZoom({ viewType, areaRef, canvas, size }: Options): {
  panReady: boolean;
  panning: boolean;
} {
  const [panReady, setPanReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const canvasOf = useRef(canvas);
  canvasOf.current = canvas;

  // For F, the context menu and ⌘K (gestures pass their own canvas).
  useEffect(() => registerZoomPane(viewType, () => canvasOf.current()), [viewType]);

  const [width, height] = size;
  useEffect(() => {
    if (width > 0 && height > 0) syncZoomedViewSize(viewType, [width, height]);
  }, [viewType, width, height]);

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    let hovered = false;
    let spaceHeld = false;
    let spacePanned = false;
    let drag: { x: number; y: number } | null = null;
    let pending = { dx: 0, dy: 0 };
    let frame: number | null = null;

    const flushPan = () => {
      frame = null;
      const { dx, dy } = pending;
      pending = { dx: 0, dy: 0 };
      if (dx !== 0 || dy !== 0) panView(viewType, dx, dy, canvasOf.current());
    };
    const onMove = (event: MouseEvent) => {
      if (!drag) return;
      pending.dx += event.clientX - drag.x;
      pending.dy += event.clientY - drag.y;
      drag = { x: event.clientX, y: event.clientY };
      if (spaceHeld) spacePanned = true;
      if (frame === null) frame = requestAnimationFrame(flushPan);
    };
    const endDrag = () => {
      if (!drag) return;
      drag = null;
      if (frame !== null) cancelAnimationFrame(frame);
      flushPan();
      setPanning(false);
      endRenderInteraction(`pan:${viewType}`);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', endDrag);
    };
    // Capture: runs before the viewer's click-to-crosshair, which skips a
    // press whose default was prevented.
    const onDown = (event: MouseEvent) => {
      const middle = event.button === 1;
      if (!middle && !(event.button === 0 && spaceHeld)) return;
      event.preventDefault();
      drag = { x: event.clientX, y: event.clientY };
      setPanning(true);
      // 1× while panning (utils/renderPixelRatio).
      beginRenderInteraction(`pan:${viewType}`);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', endDrag);
    };
    // Also on move: a pane remounted under a still pointer gets no enter.
    const onEnter = () => {
      hovered = true;
    };
    const onLeave = () => {
      hovered = false;
    };
    // Space belongs to the view only while focus is on nothing in particular
    // or on the view itself (never a focused button, field or dialog).
    // A control focused by a click (a layer row) is not where the user is
    // typing either: KeyboardShortcutService's rule (review M3b).
    const spaceIsOurs = (target: EventTarget | null) =>
      target === document.body ||
      target === document.documentElement ||
      (target instanceof Node && (area.closest('[data-view-id]') ?? area).contains(target)) ||
      (target instanceof Element && target.closest('[aria-modal="true"]') === null && isPointerFocused(target));
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSpace(event) || !hovered || isTypingTarget(event.target) || !spaceIsOurs(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Held over the view: the release decides (pan or Play/pause).
      event.preventDefault();
      if (event.repeat || spaceHeld) return;
      spaceHeld = true;
      spacePanned = false;
      setPanReady(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isSpace(event) || !spaceHeld) return;
      spaceHeld = false;
      setPanReady(false);
      if (!spacePanned) getEventBus().emit('playback.toggle', {});
    };
    // The window lost the keyboard with Space down (⌘-Tab, a dialog): its
    // release never arrives here. Forget it; never toggle Play (review M3a).
    const onFocusLost = () => {
      spaceHeld = false;
      spacePanned = false;
      setPanReady(false);
      endDrag();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onFocusLost();
    };
    // WebKit pinch: gesture events with a cumulative scale.
    let lastScale = 1;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      if (!(gesture.scale && gesture.scale > 0)) return;
      const factor = gesture.scale / lastScale;
      lastScale = gesture.scale;
      const client =
        typeof gesture.clientX === 'number' && typeof gesture.clientY === 'number'
          ? { x: gesture.clientX, y: gesture.clientY }
          : undefined;
      pulseRenderInteraction(`zoom:${viewType}`);
      zoomView(viewType, factor, client, canvasOf.current());
    };

    area.addEventListener('mousedown', onDown, true);
    area.addEventListener('mouseenter', onEnter);
    area.addEventListener('mousemove', onEnter);
    window.addEventListener('blur', onFocusLost);
    document.addEventListener('visibilitychange', onVisibility);
    area.addEventListener('mouseleave', onLeave);
    area.addEventListener('gesturestart', onGestureStart);
    area.addEventListener('gesturechange', onGestureChange);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return () => {
      endDrag();
      area.removeEventListener('mousedown', onDown, true);
      area.removeEventListener('mouseenter', onEnter);
      area.removeEventListener('mousemove', onEnter);
      window.removeEventListener('blur', onFocusLost);
      document.removeEventListener('visibilitychange', onVisibility);
      area.removeEventListener('mouseleave', onLeave);
      area.removeEventListener('gesturestart', onGestureStart);
      area.removeEventListener('gesturechange', onGestureChange);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
    };
  }, [areaRef, viewType]);

  return { panReady, panning };
}

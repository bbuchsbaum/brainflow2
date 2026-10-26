import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { anatomicalLabels } from '@/utils/anatomicalLabels';
import type { CrosshairRect } from '@/utils/crosshairUtils';
import type { ViewPlane } from '@/types/coordinates';

export const ORIENTATION_LABEL_OFFSET = 6; // px from the canvas edge

const PILL_CLASS =
  'absolute font-mono text-bf-text-secondary text-bf-xs leading-none select-none pointer-events-none';
const LABEL_SHADOW: CSSProperties = {
  textShadow: '0 0 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.4)',
};

/**
 * Element refs for the four letters plus a draw-time getter of their client
 * rectangles, which the crosshair stroke is clipped around.
 */
export function useOrientationLabelKnockouts(enabledKey: string) {
  // Slots 0–3: the letters (only while `enabledKey` is set). Further slots
  // (e.g. the viewport header) always count.
  const refs = useRef<Array<HTMLElement | null>>([]);
  // A knocked-out element that changes size after the last crosshair draw
  // (the header re-flowing once the web font loads, or changing density)
  // must redraw the crosshair: the getter's identity follows `revision`.
  const [revision, setRevision] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observed = useRef(new Set<Element>());
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    // Any size change (including the first report) re-runs the draw; the
    // crosshair layer is cheap to redraw.
    const observer = new ResizeObserver(() => setRevision((r) => r + 1));
    observerRef.current = observer;
    const set = observed.current;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(() => setRevision((r) => r + 1));
    }
    return () => {
      observer.disconnect();
      observerRef.current = null;
      set.clear();
    };
  }, []);
  useEffect(() => {
    const observer = observerRef.current;
    if (!observer) return;
    for (const el of refs.current) {
      if (el && !observed.current.has(el)) {
        observer.observe(el);
        observed.current.add(el);
      }
    }
  });
  const getKnockouts = useCallback((): CrosshairRect[] => {
    const rects: CrosshairRect[] = [];
    for (const [i, el] of refs.current.entries()) {
      if (i < 4 && !enabledKey) continue;
      if (!el || !el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        rects.push({ x: r.left, y: r.top, width: r.width, height: r.height });
      }
    }
    return rects;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, revision]);
  return { refs, getKnockouts };
}

/** Key that changes when the drawn letters change ("" when none are drawn). */
export function orientationLabelKey(
  viewPlane: ViewPlane | null | undefined,
  show: boolean,
): string {
  if (!show || !viewPlane) return '';
  return JSON.stringify(anatomicalLabels(viewPlane) ?? null);
}

interface OrientationLabelsProps {
  viewPlane: ViewPlane;
  refs: React.MutableRefObject<Array<HTMLElement | null>>;
  /** Extra distance of the bottom letter from the container bottom (e.g. a rail strip). */
  bottomInset?: number;
  /** Extra distance of the top letter from the top (a header row it must clear). */
  topInset?: number;
}

/** Anatomical letters at the four edge midpoints, derived from the signed view basis. */
export function OrientationLabels({
  viewPlane,
  refs,
  bottomInset = 0,
  topInset = 0,
}: OrientationLabelsProps) {
  // Stable ref callbacks: new ones each render make React detach the letters
  // (null) and re-attach them in tree order, AFTER the canvas (an earlier
  // sibling) has drawn in its layout effect, so the crosshair was never
  // knocked out around them (v4 fidelity: "P" read as "R").
  const setters = useMemo(
    () =>
      [0, 1, 2, 3].map((i) => (el: HTMLSpanElement | null) => {
        refs.current[i] = el;
      }),
    [refs],
  );
  const labels = anatomicalLabels(viewPlane);
  if (!labels) return null;
  const set = (i: number) => setters[i];
  return (
    <>
      <span
        className={`${PILL_CLASS} left-1/2 -translate-x-1/2`}
        ref={set(0)}
        style={{ top: topInset + ORIENTATION_LABEL_OFFSET, ...LABEL_SHADOW }}
      >
        {labels.top}
      </span>
      <span
        className={`${PILL_CLASS} left-1/2 -translate-x-1/2`}
        ref={set(1)}
        style={{ bottom: bottomInset + ORIENTATION_LABEL_OFFSET, ...LABEL_SHADOW }}
      >
        {labels.bottom}
      </span>
      <span
        className={`${PILL_CLASS} top-1/2 -translate-y-1/2`}
        ref={set(2)}
        style={{ left: ORIENTATION_LABEL_OFFSET, ...LABEL_SHADOW }}
      >
        {labels.left}
      </span>
      <span
        className={`${PILL_CLASS} top-1/2 -translate-y-1/2`}
        ref={set(3)}
        style={{ right: ORIENTATION_LABEL_OFFSET, ...LABEL_SHADOW }}
      >
        {labels.right}
      </span>
    </>
  );
}

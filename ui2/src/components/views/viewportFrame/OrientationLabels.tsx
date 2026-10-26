import { useCallback, useRef, type CSSProperties } from 'react';
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
  }, [enabledKey]);
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
}

/** Anatomical letters at the four edge midpoints, derived from the signed view basis. */
export function OrientationLabels({ viewPlane, refs, bottomInset = 0 }: OrientationLabelsProps) {
  const labels = anatomicalLabels(viewPlane);
  if (!labels) return null;
  const set = (i: number) => (el: HTMLSpanElement | null) => {
    refs.current[i] = el;
  };
  return (
    <>
      <span
        className={`${PILL_CLASS} left-1/2 -translate-x-1/2`}
        ref={set(0)}
        style={{ top: ORIENTATION_LABEL_OFFSET, ...LABEL_SHADOW }}
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

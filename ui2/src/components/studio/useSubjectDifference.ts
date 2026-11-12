import { useEffect, useMemo, useState } from 'react';
import type { PopulationSliceDisplay } from '@/services/studio/PopulationSliceService';
import { differenceRgba, subjectDifference } from './summaryPaneModel';

/**
 * The focused subject's difference from the group statistic, computed here
 * from the two planes a result already carries (no request is made), on the
 * shared symmetric value scale, and a bitmap drawn through the population
 * colour mapping. The bitmap is null until drawn, and where bitmaps cannot be made.
 */
export function useSubjectDifference(result: PopulationSliceDisplay | null, enabled: boolean) {
  const computed = useMemo(() => {
    if (!enabled || !result) return null;
    const values = subjectDifference(result.data.focused, result.data.summary);
    // Drawn on the shared value scale (the "Value scale ±" field), so it is
    // compared with the subject's own map at one scale and adjusted the same way.
    return { values, limit: result.effectLimit };
  }, [enabled, result]);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  useEffect(() => {
    if (!computed || !result || typeof createImageBitmap === 'undefined') {
      setImage(null);
      return;
    }
    const [width, height] = result.data.plane.dim_px;
    let alive = true;
    let made: Promise<ImageBitmap>;
    try {
      const rgba = differenceRgba(computed.values, computed.limit, result.underlay);
      made = Promise.resolve(
        createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), width, height)),
      );
    } catch {
      // No bitmap where images cannot be made (the values and limit stand).
      setImage(null);
      return;
    }
    made.then(
      (bitmap) => {
        if (!alive) {
          // Never shown: nothing can still be drawing it.
          bitmap?.close?.();
          return;
        }
        setImage(bitmap ?? null);
      },
      () => {
        if (alive) setImage(null);
      },
    );
    return () => {
      alive = false;
      // A bitmap that was shown is left to the garbage collector: a draw
      // still pending may use it (ui2/CLAUDE.md, ImageBitmap lifecycle).
    };
  }, [computed, result]);
  return { values: computed?.values ?? null, limit: computed?.limit ?? null, image };
}

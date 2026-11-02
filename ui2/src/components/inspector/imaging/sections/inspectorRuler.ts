import { isThresholdActive } from "@/components/views/viewportFrame/frameFormat";

export interface InspectorRuler {
  min: number;
  max: number;
  /** Data range as fractions of the ruler. */
  dataSpan: [number, number] | null;
  /** Intensity window as fractions of the ruler (the strip's gradient span). */
  windowSpan: [number, number] | null;
  /** Threshold-hidden interval as fractions of the ruler (clipped), or null. */
  hiddenSpan: [number, number] | null;
}

/**
 * One value→x mapping for the Inspector's Intensity track, Threshold track and
 * colormap strip: [min(data, window), max(data, window)]. Values beyond the
 * window draw in the end colours, so the strip shows its gradient over the
 * window and the clamped end colours outside it.
 */
export function inspectorRuler(
  data: readonly [number, number],
  window: readonly [number, number],
  threshold: readonly [number, number] | null | undefined,
  /** Domain frozen for an ongoing interaction; the ruler never shrinks inside it. */
  frozen?: readonly [number, number] | null,
  /**
   * Further windows the ruler must always contain (the layer's default window
   * and the window at first selection), so the domain is stable between
   * interactions and the original window ends stay reachable.
   */
  anchors?: ReadonlyArray<readonly [number, number] | null | undefined>,
): InspectorRuler {
  const finite = [
    data[0],
    data[1],
    window[0],
    window[1],
    ...(frozen ? [frozen[0], frozen[1]] : []),
    ...(anchors ?? []).flatMap((a) => (a ? [a[0], a[1]] : [])),
  ].filter(Number.isFinite);
  const min = finite.length ? Math.min(...finite) : 0;
  const max = finite.length ? Math.max(...finite) : 1;
  const span = max - min;
  const frac = (v: number) => (span > 0 ? Math.max(0, Math.min(1, (v - min) / span)) : 0);
  const pair = (a: number, b: number): [number, number] | null =>
    Number.isFinite(a) && Number.isFinite(b) ? [frac(Math.min(a, b)), frac(Math.max(a, b))] : null;
  const hidden = isThresholdActive(threshold) ? pair(threshold![0], threshold![1]) : null;
  return {
    min,
    max,
    dataSpan: span > 0 ? pair(data[0], data[1]) : null,
    windowSpan: span > 0 ? pair(window[0], window[1]) : null,
    hiddenSpan: hidden && hidden[1] > hidden[0] ? hidden : null,
  };
}

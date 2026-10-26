import { useEffect, useLayoutEffect, useState } from 'react';
import { formatName, type FormatNameOptions } from '@/utils/formatName';

let measureCtx: CanvasRenderingContext2D | null | undefined;

function textWidth(text: string, font: string): number | null {
  if (measureCtx === undefined) {
    try {
      measureCtx =
        typeof document !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        !/jsdom/i.test(navigator.userAgent)
          ? document.createElement('canvas').getContext('2d')
          : null;
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return null;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/**
 * The longest `formatName` rendering of `name` that fits the measured width
 * of the returned element (middle ellipsis, extension kept whole). The
 * element's own width must not depend on its text (give it `flex: 1` /
 * `min-width: 0`), so fitting never feeds back into layout. Without layout
 * (jsdom, zero width) the full name is returned and CSS clipping applies.
 */
export function useFittedName<T extends HTMLElement>(
  name: string,
  options: { isDir?: boolean; enabled?: boolean; keep?: FormatNameOptions['keep'] } = {},
): { ref: (el: T | null) => void; text: string } {
  const { isDir = false, enabled = true, keep } = options;
  // Callback ref held in state, so an element that mounts after the first
  // render (a panel that starts empty) is still observed.
  const [el, ref] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  const [font, setFont] = useState('');
  // Canvas text metrics use the fallback face until the web font loads: fit
  // again then, or the fitted name overflows and CSS clips it a second time.
  const [fontsReady, setFontsReady] = useState(
    () => typeof document === 'undefined' || document.fonts?.status === 'loaded',
  );
  useEffect(() => {
    if (fontsReady || typeof document === 'undefined' || !document.fonts?.ready) return;
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) setFontsReady(true);
    });
    return () => {
      alive = false;
    };
  }, [fontsReady]);

  useLayoutEffect(() => {
    if (!el || !enabled || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const w = el.clientWidth;
      setWidth((prev) => (prev === w ? prev : w));
      const f = getComputedStyle(el).font;
      setFont((prev) => (prev === f ? prev : f));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, enabled]);

  let text = name;
  if (enabled && width > 0 && font) {
    // Canvas metrics and laid-out text differ by a pixel or two (rounding,
    // the ellipsis glyph): keep that margin, or CSS clips the fitted name
    // a second time ("atlas-synt…ds…").
    const room = width - 2;
    const full = textWidth(name, font);
    if (full !== null && full > room) {
      // Start from the average-glyph estimate, then step down until it fits.
      let budget = Math.max(1, Math.floor((room / full) * Array.from(name).length));
      text = formatName(name, budget, { isDir, keep });
      while (budget > 1 && (textWidth(text, font) ?? 0) > room) {
        budget -= 1;
        text = formatName(name, budget, { isDir, keep });
      }
    }
  }
  return { ref, text };
}

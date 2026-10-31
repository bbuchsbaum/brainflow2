/**
 * The backing-store ratio for a slice canvas: min(devicePixelRatio, 2),
 * following the window to another display. It does not drop during an
 * interaction (only the render does), so the canvas is never resized
 * mid-drag. See utils/renderPixelRatio.ts.
 */
import { useEffect, useState } from 'react';
import { deviceRenderRatio, subscribeRenderRatio } from '@/utils/renderPixelRatio';

export function useCanvasPixelRatio(): number {
  const [ratio, setRatio] = useState(deviceRenderRatio);
  useEffect(
    () =>
      subscribeRenderRatio(() => {
        const next = deviceRenderRatio();
        setRatio((current) => (current === next ? current : next));
      }),
    [],
  );
  return ratio;
}

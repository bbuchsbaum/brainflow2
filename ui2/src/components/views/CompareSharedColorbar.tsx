/**
 * One colorbar column for linked Compare panels showing the same overlay
 * (P3.9, v2 visual critic): the display is shared, so its colorbar is drawn
 * once, beside the panels, top-aligned. Unlinked (or different layers), each
 * panel draws its own colorbar top-right.
 */
import { useEffect, useRef, useState } from 'react';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useLayerValueAtWorld } from '@/hooks/useLayerValueAtWorld';
import { ViewportColorbar, useLayerColorbar } from './viewportFrame';
import { COLORBAR_MIN_WIDTH } from './viewportFrame/ViewportColorbar';

const COLUMN_PX = 112;
/** See MosaicColorbar: a short virtual image puts the bar at the column's top. */
const VIRTUAL_IMAGE_PX = 268;

export function CompareSharedColorbar({
  workspaceId,
  layerId,
}: {
  workspaceId: string;
  layerId: string;
}) {
  const colorbar = useLayerColorbar(layerId, workspaceId);
  const crosshair = useViewStateStore(
    (s) => s.getWorkspaceViewState(workspaceId).crosshair.world_mm,
  );
  const reading = useLayerValueAtWorld(colorbar?.layerId ?? null, crosshair);
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setHeight(el.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="relative shrink-0 self-stretch bg-bf-bg-canvas"
      style={{ width: COLUMN_PX }}
      data-testid="compare-shared-colorbar"
    >
      {colorbar && height > 0 ? (
        <ViewportColorbar
          layer={colorbar}
          width={COLORBAR_MIN_WIDTH + 48}
          height={height}
          imageRect={{
            left: -COLORBAR_MIN_WIDTH,
            top: 0,
            right: -12,
            bottom: Math.min(height, VIRTUAL_IMAGE_PX),
          }}
          value={reading?.value ?? null}
        />
      ) : null}
    </div>
  );
}

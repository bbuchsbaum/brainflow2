/**
 * Mosaic frame parts (UI redesign phase 3, item 7, visual Proposal A):
 * - a per-tile position label ("z 50.5") in the viewport header's mono
 *   style, bottom-left on the canvas scrim, with no box; the tile holding the
 *   crosshair wears the crosshair colour (the status-bar crosshair rule);
 * - one shared colorbar for the grid, outside the tiles.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useLayerStore } from '@/stores/layerStore';
import { useViewStateStore } from '@/stores/viewStateStore';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { useActiveLayer } from '@/utils/activeLayer';
import { formatWorldMm } from '@/utils/valueFormat';
import { formatRegionLabel } from '@/services/atlasRegionLookup';
import { ViewportColorbar, chooseColorbarLayerId, useLayerColorbar } from './viewportFrame';
import { COLORBAR_MIN_WIDTH } from './viewportFrame/ViewportColorbar';
import { useLayerValueAtWorld } from '@/hooks/useLayerValueAtWorld';
import { MOSAIC_COLORBAR_COLUMN_PX } from '@/services/mosaic/sliceGeometry';

const AXIS_LETTER = { sagittal: 'x', coronal: 'y', axial: 'z' } as const;

export function MosaicTileLabel({
  axis,
  position,
  atCrosshair,
}: {
  axis: 'axial' | 'sagittal' | 'coronal';
  position: number | null;
  atCrosshair: boolean;
}) {
  const crosshairColor = useCrosshairSettingsStore((s) => s.settings.activeColor);
  if (position === null || !Number.isFinite(position)) return null;
  return (
    <span
      className="pointer-events-none absolute bottom-1 left-1 z-10 select-none rounded-bf-xs bg-[color-mix(in_srgb,var(--bf-bg-canvas)_80%,transparent)] px-1 font-mono text-bf-2xs tabular-nums leading-tight text-bf-text-secondary"
      // Crosshair tile: the crosshair's own colour (user-selectable), as data.
      style={atCrosshair ? { color: crosshairColor } : undefined}
      data-testid="mosaic-tile-label"
      data-at-crosshair={atCrosshair ? 'true' : undefined}
      title={atCrosshair ? 'Slice holding the crosshair' : undefined}
    >
      {AXIS_LETTER[axis]} {formatWorldMm(position)}
    </span>
  );
}

/**
 * Width of the shared colorbar column (px). The colorbar box is content-sized
 * (caption, bar, ticks, footer); the column only reserves room for it.
 */
const COLORBAR_COLUMN_PX = MOSAIC_COLORBAR_COLUMN_PX;
/**
 * The colorbar is laid out "beside an image" whose right edge is the
 * column's left edge and whose height gives a full-length bar; it then sits
 * at the column's top (centred on that short virtual image).
 */
const VIRTUAL_IMAGE_PX = 268;

export function MosaicColorbar({ workspaceId }: { workspaceId: string }) {
  const layers = useLayerStore((s) => s.layers);
  const viewLayers = useViewStateStore((s) => s.getWorkspaceViewState(workspaceId).layers);
  const activeLayerId = useActiveLayer(viewLayers)?.id ?? null;
  const layerId = React.useMemo(
    () => chooseColorbarLayerId(layers, viewLayers, activeLayerId),
    [layers, viewLayers, activeLayerId],
  );
  const colorbar = useLayerColorbar(layerId, workspaceId);
  // The crosshair value as the bar's caret, like a slice view's colorbar.
  const crosshairWorld = useViewStateStore(
    (s) => s.getWorkspaceViewState(workspaceId).crosshair.world_mm,
  );
  const reading = useLayerValueAtWorld(colorbar?.layerId ?? null, crosshairWorld);
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
  }, [colorbar !== null]);
  if (!colorbar) return <MosaicLegend workspaceId={workspaceId} />;
  return (
    <div
      ref={ref}
      className="relative shrink-0 self-stretch bg-bf-bg-canvas"
      style={{ width: COLORBAR_COLUMN_PX }}
      data-testid="mosaic-colorbar"
    >
      {/* Top-aligned with the grid, left edge 12 px from the tiles. */}
      {height > 0 && (
        <ViewportColorbar
          layer={colorbar}
          // Layout room only (the box is content-sized; the column clips nothing).
          width={COLORBAR_MIN_WIDTH + 48}
          height={height}
          imageRect={{ left: -COLORBAR_MIN_WIDTH, top: 0, right: -12, bottom: Math.min(height, VIRTUAL_IMAGE_PX) }}
          value={reading?.value ?? null}
        />
      )}
    </div>
  );
}

/**
 * When the top visible layer is a label map, the grid gets its regions
 * (swatch + name) instead of a colorbar, in the same column.
 */
function MosaicLegend({ workspaceId }: { workspaceId: string }) {
  const viewLayers = useViewStateStore((s) => s.getWorkspaceViewState(workspaceId).layers);
  const top = [...viewLayers].reverse().find((l) => l.visible && l.opacity > 0);
  const legend = useLayerStore((s) =>
    top ? s.layers.find((l) => l.id === top.id && l.type === 'label')?.atlasPaletteLegend : undefined,
  );
  if (!top || !legend || legend.length === 0) return null;
  return (
    <div
      className="flex shrink-0 flex-col justify-center gap-1 self-stretch overflow-y-auto bg-bf-bg-canvas px-2 text-bf-2xs text-bf-text-secondary"
      style={{ width: COLORBAR_COLUMN_PX }}
      data-testid="mosaic-legend"
      aria-label="Regions"
    >
      {legend.map((entry) => (
        <span key={entry.label_id} className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-bf-xs [forced-color-adjust:none]"
            style={{ background: `rgb(${entry.color[0]}, ${entry.color[1]}, ${entry.color[2]})` }}
          />
          <span className="truncate">{formatRegionLabel(entry)}</span>
        </span>
      ))}
    </div>
  );
}


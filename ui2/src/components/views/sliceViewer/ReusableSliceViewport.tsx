import { useCallback } from 'react';
import {
  ReusableSliceViewport as SharedReusableSliceViewport,
  drawSliceBorder,
  projectWorldToCanvas,
  type ReusableSliceViewportProps as SharedReusableSliceViewportProps,
  type SliceViewerCustomRender,
} from '@brainflow/visualization/slice';
import {
  adaptCrosshairStyleToViewport,
  clientRectsToCanvas,
  CROSSHAIR_CENTER_GAP_PX,
  drawCrosshair,
  type CrosshairRect,
  type CrosshairStyle,
} from '@/utils/crosshairUtils';
import { useCrosshairSettingsStore } from '@/stores/crosshairSettingsStore';
import { canvasPixelRatio } from '@/utils/renderPixelRatio';

export interface ReusableSliceViewportProps
  extends Omit<SharedReusableSliceViewportProps, 'crosshairStyle'> {
  crosshairStyle?: CrosshairStyle | null;
  /**
   * Client-space rectangles (e.g. orientation letters) the crosshair stroke
   * is clipped around. Read at draw time.
   */
  getCrosshairKnockouts?: () => CrosshairRect[];
  /**
   * World-space extent of the image data (voxel-centre bounds). When given,
   * the crosshair stroke is clipped to that extent inside the bitmap (e.g. a
   * Compare panel whose bitmap is wider than the volume). Position unchanged.
   */
  crosshairWorldBounds?: CrosshairWorldBounds | null;
}

export interface CrosshairWorldBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

type Placement = Parameters<SliceViewerCustomRender>[1];

/** A placement in other units (backing px -> CSS px): image size unchanged. */
function scalePlacement(placement: Placement, k: number): Placement {
  return {
    ...placement,
    x: placement.x * k,
    y: placement.y * k,
    width: placement.width * k,
    height: placement.height * k,
  };
}

function scaleRects(rects: CrosshairRect[], k: number): CrosshairRect[] {
  return k === 1 ? rects : rects.map((r) => ({ x: r.x * k, y: r.y * k, width: r.width * k, height: r.height * k }));
}

/**
 * The part of `placement` covered by the data extent on the crosshair's slice:
 * the in-plane corners of `bounds` projected with the viewer's own projection
 * (the slice-normal component is the crosshair's, so both corners lie on the
 * displayed plane). Falls back to the placement when projection fails.
 */
export function clipPlacementToWorldBounds(
  placement: Placement,
  viewPlane: NonNullable<ReusableSliceViewportProps['viewPlane']>,
  crosshairWorld: readonly [number, number, number],
  bounds: CrosshairWorldBounds,
): Placement {
  const u = viewPlane.u_mm;
  const v = viewPlane.v_mm;
  const normal = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const n = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const inPlane = normal.map((c) => Math.abs(c / n) < 0.9);
  const corner = (pick: 'min' | 'max') =>
    [0, 1, 2].map((a) => (inPlane[a] ? bounds[pick][a] : crosshairWorld[a])) as [
      number,
      number,
      number,
    ];
  const a = projectWorldToCanvas(corner('min'), viewPlane, placement);
  const b = projectWorldToCanvas(corner('max'), viewPlane, placement);
  if (!a || !b) return placement;
  const x0 = Math.max(placement.x, Math.min(a.canvasX, b.canvasX));
  const x1 = Math.min(placement.x + placement.width, Math.max(a.canvasX, b.canvasX));
  const y0 = Math.max(placement.y, Math.min(a.canvasY, b.canvasY));
  const y1 = Math.min(placement.y + placement.height, Math.max(a.canvasY, b.canvasY));
  if (!(x1 > x0) || !(y1 > y0)) return placement;
  return { ...placement, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Brainflow's slice viewport: the shared viewer for placement, hit-testing
 * and click-to-world (all unchanged), with Brainflow's own crosshair stroke
 * (dark halo + pixel-snapped core, centre gap, compact weight in small views,
 * clipped around orientation letters). The shared viewer's plain crosshair
 * and border passes are disabled and redone here in the same order (border,
 * then crosshair) with the same projection and visibility test, so geometry
 * is identical: only stroke styling differs.
 */
export function ReusableSliceViewport({
  width,
  height,
  viewPlane,
  crosshair,
  crosshairStyle,
  showSliceBorder = false,
  sliceBorderWidth = 1,
  customRender,
  getCrosshairKnockouts,
  crosshairWorldBounds,
  ...rest
}: ReusableSliceViewportProps) {
  const centerGapEnabled = useCrosshairSettingsStore((state) => state.settings.centerGap !== false);

  const render = useCallback<SliceViewerCustomRender>(
    (ctx, backingPlacement) => {
      // Overlays are drawn in CSS units on a HiDPI backing store (the canvas
      // records its ratio): line widths, dashes, halo, gaps and pixel
      // snapping are the same in CSS px at every ratio. The image and the
      // click mapping keep the backing placement.
      const ratio = canvasPixelRatio(ctx.canvas);
      const placement = ratio === 1 ? backingPlacement : scalePlacement(backingPlacement, 1 / ratio);
      // At ratio 1 nothing changes (no transform, no save/restore).
      if (ratio !== 1) {
        ctx.save();
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      try {
        customRender?.(ctx, placement);
        if (showSliceBorder) drawSliceBorder(ctx, placement, sliceBorderWidth);
        if (!crosshair?.visible || !crosshairStyle || !viewPlane) return;
        const point = projectWorldToCanvas(crosshair.world_mm, viewPlane, placement);
        if (!point) return;
        const baseStyle: CrosshairStyle =
          crosshairStyle.centerGap === undefined
            ? { ...crosshairStyle, centerGap: centerGapEnabled ? CROSSHAIR_CENTER_GAP_PX : 0 }
            : crosshairStyle;
        const style = adaptCrosshairStyleToViewport(baseStyle, width, height);
        const clientRects = getCrosshairKnockouts?.() ?? [];
        const knockouts =
          clientRects.length > 0 && ctx.canvas
            ? scaleRects(clientRectsToCanvas(ctx.canvas, clientRects), 1 / ratio)
            : undefined;
        const bounds = crosshairWorldBounds
          ? clipPlacementToWorldBounds(placement, viewPlane, crosshair.world_mm, crosshairWorldBounds)
          : placement;
        drawCrosshair({
          ctx,
          canvasX: point.canvasX,
          canvasY: point.canvasY,
          bounds,
          style,
          knockouts,
        });
      } finally {
        if (ratio !== 1) ctx.restore();
      }
    },
    [
      customRender,
      showSliceBorder,
      sliceBorderWidth,
      crosshair,
      crosshairStyle,
      viewPlane,
      centerGapEnabled,
      width,
      height,
      getCrosshairKnockouts,
      crosshairWorldBounds,
    ],
  );

  return (
    <SharedReusableSliceViewport
      {...rest}
      width={width}
      height={height}
      viewPlane={viewPlane}
      crosshair={crosshair}
      crosshairStyle={null}
      showSliceBorder={false}
      customRender={render}
    />
  );
}

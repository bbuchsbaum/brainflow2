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

export interface ReusableSliceViewportProps
  extends Omit<SharedReusableSliceViewportProps, 'crosshairStyle'> {
  crosshairStyle?: CrosshairStyle | null;
  /**
   * Client-space rectangles (e.g. orientation letters) the crosshair stroke
   * is clipped around. Read at draw time.
   */
  getCrosshairKnockouts?: () => CrosshairRect[];
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
  ...rest
}: ReusableSliceViewportProps) {
  const centerGapEnabled = useCrosshairSettingsStore((state) => state.settings.centerGap !== false);

  const render = useCallback<SliceViewerCustomRender>(
    (ctx, placement) => {
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
          ? clientRectsToCanvas(ctx.canvas, clientRects)
          : undefined;
      drawCrosshair({
        ctx,
        canvasX: point.canvasX,
        canvasY: point.canvasY,
        bounds: placement,
        style,
        knockouts,
      });
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

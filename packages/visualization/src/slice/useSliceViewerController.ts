import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { drawSliceBorder, drawSliceViewerCrosshair } from './drawing.js';
import { clientPointToWorld, projectWorldToCanvas } from './geometry.js';
import type {
  SliceViewerCrosshair,
  SliceViewerCrosshairStyle,
  SliceViewerCustomRender,
  SliceViewerPlacement,
  SliceViewerPlane,
  SliceViewerWorldCoord,
} from './types.js';

export interface UseSliceViewerControllerArgs {
  viewPlane?: SliceViewerPlane | null;
  crosshair?: SliceViewerCrosshair | null;
  crosshairStyle?: SliceViewerCrosshairStyle | null;
  showSliceBorder?: boolean;
  sliceBorderWidth?: number;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  onPlacementChange?: (placement: SliceViewerPlacement) => void;
  onWorldClick?: (worldCoord: SliceViewerWorldCoord, event: MouseEvent<HTMLDivElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  customRender?: SliceViewerCustomRender;
}

export function useSliceViewerController({
  viewPlane,
  crosshair,
  crosshairStyle,
  showSliceBorder = false,
  sliceBorderWidth = 1,
  onCanvasReady,
  onPlacementChange,
  onWorldClick,
  onMouseDown,
  customRender,
}: UseSliceViewerControllerArgs) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const placementRef = useRef<SliceViewerPlacement | null>(null);
  const viewPlaneRef = useRef<SliceViewerPlane | null>(viewPlane ?? null);
  useEffect(() => {
    viewPlaneRef.current = viewPlane ?? null;
  }, [viewPlane]);

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    canvasRef.current = canvas;
    onCanvasReady?.(canvas);
  }, [onCanvasReady]);

  // Overlay inputs must invalidate drawing even when the bitmap is unchanged.
  // Capture this render's props directly; passive refs would lag a layout draw.
  const handleRender = useCallback<SliceViewerCustomRender>((ctx, placement) => {
    placementRef.current = placement;
    onPlacementChange?.(placement);
    customRender?.(ctx, placement);
    if (showSliceBorder) drawSliceBorder(ctx, placement, sliceBorderWidth);
    if (!crosshair?.visible || !crosshairStyle || !viewPlane) return;
    const point = projectWorldToCanvas(crosshair.world_mm, viewPlane, placement);
    if (!point) return;
    drawSliceViewerCrosshair({
      ctx, canvasX: point.canvasX, canvasY: point.canvasY,
      bounds: placement, style: crosshairStyle,
    });
  }, [crosshair, crosshairStyle, viewPlane, customRender, onPlacementChange, showSliceBorder, sliceBorderWidth]);

  const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    onMouseDown?.(event);
    if (event.defaultPrevented || event.button !== 0 || !onWorldClick) return;
    if (!canvasRef.current || !placementRef.current) return;

    const currentViewPlane = viewPlaneRef.current;
    if (!currentViewPlane) return;

    const worldCoord = clientPointToWorld(
      event.clientX,
      event.clientY,
      canvasRef.current,
      placementRef.current,
      currentViewPlane
    );
    if (!worldCoord) return;

    onWorldClick(worldCoord, event);
  }, [onMouseDown, onWorldClick]);

  return {
    handleCanvasReady,
    handleMouseDown,
    handleRender,
  };
}

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MouseEvent } from 'react';
import { CoordinateTransform } from '@/utils/coordinates';
import { drawCrosshair, type CrosshairStyle } from '@/utils/crosshairUtils';
import type { ViewPlane } from '@/types/coordinates';
import type { SliceRendererProps } from '../SliceRenderer';
import type { SliceViewportPlacement } from '../SliceViewport';

interface UseSliceViewportControllerArgs {
  viewPlane?: ViewPlane | null;
  crosshair?: {
    visible: boolean;
    world_mm: [number, number, number];
  } | null;
  crosshairStyle?: CrosshairStyle | null;
  showSliceBorder?: boolean;
  sliceBorderWidth?: number;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
  onPlacementChange?: (placement: SliceViewportPlacement) => void;
  onWorldClick?: (worldCoord: [number, number, number], event: MouseEvent<HTMLDivElement>) => void;
  onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  customRender?: SliceRendererProps['customRender'];
}

function drawSliceBorder(
  ctx: CanvasRenderingContext2D,
  placement: SliceViewportPlacement,
  thickness: number
) {
  const safeThickness = Math.max(1, thickness);
  const rootStyles =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement)
      : null;
  const borderToken = rootStyles?.getPropertyValue('--border').trim();
  const borderColor = borderToken
    ? `hsl(${borderToken} / 0.95)`
    : 'rgba(148, 163, 184, 0.95)';

  ctx.save();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = safeThickness;
  const inset = safeThickness / 2;
  ctx.strokeRect(
    placement.x + inset,
    placement.y + inset,
    Math.max(0, placement.width - safeThickness),
    Math.max(0, placement.height - safeThickness)
  );
  ctx.restore();
}

export function useSliceViewportController({
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
}: UseSliceViewportControllerArgs) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const placementRef = useRef<SliceViewportPlacement | null>(null);
  const viewPlaneRef = useRef<ViewPlane | null>(viewPlane ?? null);
  const crosshairRef = useRef(crosshair ?? null);
  const crosshairStyleRef = useRef(crosshairStyle ?? null);
  const showSliceBorderRef = useRef(showSliceBorder);
  const sliceBorderWidthRef = useRef(sliceBorderWidth);
  const customRenderRef = useRef(customRender);
  const onPlacementChangeRef = useRef(onPlacementChange);

  useEffect(() => {
    viewPlaneRef.current = viewPlane ?? null;
  }, [viewPlane]);

  useEffect(() => {
    crosshairRef.current = crosshair ?? null;
  }, [crosshair]);

  useEffect(() => {
    crosshairStyleRef.current = crosshairStyle ?? null;
  }, [crosshairStyle]);

  useEffect(() => {
    showSliceBorderRef.current = showSliceBorder;
  }, [showSliceBorder]);

  useEffect(() => {
    sliceBorderWidthRef.current = sliceBorderWidth;
  }, [sliceBorderWidth]);

  useEffect(() => {
    customRenderRef.current = customRender;
  }, [customRender]);

  useEffect(() => {
    onPlacementChangeRef.current = onPlacementChange;
  }, [onPlacementChange]);

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement) => {
    canvasRef.current = canvas;
    onCanvasReady?.(canvas);
  }, [onCanvasReady]);

  const handleRender = useMemo<SliceRendererProps['customRender']>(() => {
    return (ctx, placement) => {
      placementRef.current = placement;
      onPlacementChangeRef.current?.(placement);
      customRenderRef.current?.(ctx, placement);

      if (showSliceBorderRef.current) {
        drawSliceBorder(ctx, placement, sliceBorderWidthRef.current);
      }

      const currentCrosshair = crosshairRef.current;
      const currentStyle = crosshairStyleRef.current;
      const currentViewPlane = viewPlaneRef.current;
      if (!currentCrosshair?.visible || !currentStyle || !currentViewPlane) {
        return;
      }

      const screenCoord = CoordinateTransform.worldToScreen(
        currentCrosshair.world_mm,
        currentViewPlane
      );
      if (!screenCoord) return;

      const scaleX = placement.width / placement.imageWidth;
      const scaleY = placement.height / placement.imageHeight;
      const canvasX = placement.x + screenCoord[0] * scaleX;
      const canvasY = placement.y + screenCoord[1] * scaleY;

      drawCrosshair({
        ctx,
        canvasX,
        canvasY,
        bounds: placement,
        style: currentStyle,
      });
    };
  }, []);

  const handleMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    onMouseDown?.(event);
    if (event.defaultPrevented || event.button !== 0 || !onWorldClick) return;
    if (!canvasRef.current || !placementRef.current) return;

    const currentViewPlane = viewPlaneRef.current;
    if (!currentViewPlane) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    const placement = placementRef.current;

    if (
      canvasX < placement.x ||
      canvasX > placement.x + placement.width ||
      canvasY < placement.y ||
      canvasY > placement.y + placement.height
    ) {
      return;
    }

    const imageX = ((canvasX - placement.x) / placement.width) * placement.imageWidth;
    const imageY = ((canvasY - placement.y) / placement.height) * placement.imageHeight;
    const worldCoord = CoordinateTransform.screenToWorld(imageX, imageY, currentViewPlane);
    onWorldClick(worldCoord as [number, number, number], event);
  }, [onMouseDown, onWorldClick]);

  return {
    handleCanvasReady,
    handleMouseDown,
    handleRender,
  };
}

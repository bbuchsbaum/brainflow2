import type {
  SliceViewerCrosshairStyle,
  SliceViewerPlacement,
} from './types.js';

export function resolveSliceBorderColor(): string {
  const rootStyles =
    typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement)
      : null;
  const borderToken = rootStyles?.getPropertyValue('--border').trim();
  return borderToken ? `hsl(${borderToken} / 0.95)` : 'rgba(148, 163, 184, 0.95)';
}

export function drawSliceBorder(
  ctx: CanvasRenderingContext2D,
  placement: SliceViewerPlacement,
  thickness: number,
  color = resolveSliceBorderColor()
): void {
  const safeThickness = Math.max(1, thickness);
  ctx.save();
  ctx.strokeStyle = color;
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

export function drawSliceViewerCrosshair({
  ctx,
  canvasX,
  canvasY,
  bounds,
  style,
}: {
  ctx: CanvasRenderingContext2D;
  canvasX: number;
  canvasY: number;
  bounds: Pick<SliceViewerPlacement, 'x' | 'y' | 'width' | 'height'>;
  style: SliceViewerCrosshairStyle;
}): void {
  if (
    canvasX < bounds.x ||
    canvasX > bounds.x + bounds.width ||
    canvasY < bounds.y ||
    canvasY > bounds.y + bounds.height
  ) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash(style.lineDash ?? []);
  if (style.opacity !== undefined) {
    ctx.globalAlpha = style.opacity;
  }

  ctx.beginPath();
  ctx.moveTo(bounds.x, canvasY);
  ctx.lineTo(bounds.x + bounds.width, canvasY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(canvasX, bounds.y);
  ctx.lineTo(canvasX, bounds.y + bounds.height);
  ctx.stroke();
  ctx.restore();
}

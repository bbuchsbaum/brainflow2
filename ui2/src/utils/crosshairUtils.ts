/**
 * Crosshair rendering utilities
 * Provides reusable functions for drawing crosshairs on canvas elements
 */

export interface CrosshairStyle {
  color: string;
  lineWidth: number;
  lineDash?: number[];
  opacity?: number;
}

// Default styles - will be overridden by CrosshairContext settings
export const DEFAULT_CROSSHAIR_STYLES = {
  active: {
    color: '#00ff00',
    lineWidth: 1,
    lineDash: [5, 5],
    opacity: 1
  },
  mirror: {
    color: '#808080',
    lineWidth: 1,
    lineDash: [5, 5],
    opacity: 0.3
  }
} as const;

/**
 * Convert line style string to canvas dash array
 */
export function getLineDash(style: 'solid' | 'dashed' | 'dotted', lineWidth: number): number[] | undefined {
  switch (style) {
    case 'solid':
      return undefined;
    case 'dashed':
      return [5 * lineWidth, 5 * lineWidth];
    case 'dotted':
      return [lineWidth, lineWidth * 2];
  }
}

export interface CrosshairDrawOptions {
  ctx: CanvasRenderingContext2D;
  canvasX: number;
  canvasY: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  style: CrosshairStyle;
}

/**
 * Draw a crosshair on a canvas at the specified position
 * Respects the provided bounds to avoid drawing outside the image area
 */
export function drawCrosshair({
  ctx,
  canvasX,
  canvasY,
  bounds,
  style
}: CrosshairDrawOptions): void {
  // Check if crosshair is within bounds
  if (
    canvasX < bounds.x ||
    canvasX > bounds.x + bounds.width ||
    canvasY < bounds.y ||
    canvasY > bounds.y + bounds.height
  ) {
    return;
  }

  ctx.save();
  
  // Apply style
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  if (style.lineDash && Array.isArray(style.lineDash)) {
    ctx.setLineDash(style.lineDash);
  } else if (style.lineDash === undefined) {
    ctx.setLineDash([]); // Clear dash pattern for solid lines
  }
  if (style.opacity !== undefined) {
    ctx.globalAlpha = style.opacity;
  }
  
  // Draw horizontal line (only within bounds)
  ctx.beginPath();
  ctx.moveTo(bounds.x, canvasY);
  ctx.lineTo(bounds.x + bounds.width, canvasY);
  ctx.stroke();
  
  // Draw vertical line (only within bounds)
  ctx.beginPath();
  ctx.moveTo(canvasX, bounds.y);
  ctx.lineTo(canvasX, bounds.y + bounds.height);
  ctx.stroke();
  
  ctx.restore();
}

/**
 * Transform world coordinates to canvas coordinates for crosshair rendering
 * Takes into account image placement and scaling
 */
export function transformCrosshairCoordinates(
  screenCoord: [number, number],
  imagePlacement: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  }
): { canvasX: number; canvasY: number } | null {
  const [screenX, screenY] = screenCoord;
  
  // Transform screen coordinates to account for image placement
  const scaleX = imagePlacement.width / imagePlacement.imageWidth;
  const scaleY = imagePlacement.height / imagePlacement.imageHeight;
  
  const canvasX = imagePlacement.x + screenX * scaleX;
  const canvasY = imagePlacement.y + screenY * scaleY;
  
  return { canvasX, canvasY };
}

/**
 * Clear and redraw all crosshairs on a canvas
 * Useful when multiple crosshairs need to be rendered (e.g., in MosaicView)
 */
export function redrawCrosshairs(
  ctx: CanvasRenderingContext2D,
  crosshairs: Array<{
    screenCoord: [number, number];
    style: CrosshairStyle;
  }>,
  imagePlacement: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  }
): void {
  // Clear any existing crosshairs by redrawing the image area
  // (This assumes the image has already been drawn)
  
  for (const crosshair of crosshairs) {
    const coords = transformCrosshairCoordinates(
      crosshair.screenCoord,
      imagePlacement
    );
    
    if (coords) {
      drawCrosshair({
        ctx,
        canvasX: coords.canvasX,
        canvasY: coords.canvasY,
        bounds: imagePlacement,
        style: crosshair.style
      });
    }
  }
}
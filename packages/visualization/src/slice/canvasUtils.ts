import type { SliceViewerPlacement } from './types.js';

export function calculateImagePlacement(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): SliceViewerPlacement {
  const imageAspectRatio = imageWidth / imageHeight;
  const canvasAspectRatio = canvasWidth / canvasHeight;

  let drawWidth: number;
  let drawHeight: number;
  let drawX: number;
  let drawY: number;

  if (imageAspectRatio > canvasAspectRatio) {
    drawWidth = canvasWidth;
    drawHeight = drawWidth / imageAspectRatio;
    drawX = 0;
    drawY = (canvasHeight - drawHeight) / 2;
  } else {
    drawHeight = canvasHeight;
    drawWidth = drawHeight * imageAspectRatio;
    drawX = (canvasWidth - drawWidth) / 2;
    drawY = 0;
  }

  return {
    x: Math.round(drawX),
    y: Math.round(drawY),
    width: Math.round(drawWidth),
    height: Math.round(drawHeight),
    imageWidth,
    imageHeight,
  };
}

export function drawScaledImage(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  canvasWidth: number,
  canvasHeight: number
): SliceViewerPlacement {
  const placement = calculateImagePlacement(
    image.width,
    image.height,
    canvasWidth,
    canvasHeight
  );

  ctx.drawImage(
    image,
    placement.x,
    placement.y,
    placement.width,
    placement.height
  );

  return placement;
}

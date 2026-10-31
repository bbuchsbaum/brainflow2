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

/**
 * Draw `image` letterboxed into the canvas. With `mirrorX` it is drawn
 * mirrored left-right inside the same rectangle, and the returned placement
 * says so, so every mapping through it (crosshair, clicks, hover) follows.
 */
export function drawScaledImage(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  canvasWidth: number,
  canvasHeight: number,
  mirrorX = false
): SliceViewerPlacement {
  const placement = calculateImagePlacement(
    image.width,
    image.height,
    canvasWidth,
    canvasHeight
  );

  if (mirrorX) {
    ctx.save();
    ctx.translate(placement.x + placement.width, placement.y);
    ctx.scale(-1, 1);
    ctx.drawImage(image, 0, 0, placement.width, placement.height);
    ctx.restore();
    return { ...placement, mirrorX: true };
  }

  ctx.drawImage(
    image,
    placement.x,
    placement.y,
    placement.width,
    placement.height
  );

  return placement;
}

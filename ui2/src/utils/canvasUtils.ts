/**
 * Canvas utility functions for image rendering
 */

export interface ImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

/**
 * Calculate the placement for an image on a canvas while maintaining aspect ratio
 * The image will be scaled to fit within the canvas bounds and centered
 * This matches the logic used in SliceView for consistent rendering
 * 
 * @param imageWidth - Width of the source image
 * @param imageHeight - Height of the source image
 * @param canvasWidth - Width of the target canvas
 * @param canvasHeight - Height of the target canvas
 * @returns ImagePlacement with x, y, width, height for drawImage
 */
export function calculateImagePlacement(
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number
): ImagePlacement {
  const imageAspectRatio = imageWidth / imageHeight;
  const canvasAspectRatio = canvasWidth / canvasHeight;
  
  let drawWidth: number;
  let drawHeight: number;
  let drawX: number;
  let drawY: number;
  
  if (imageAspectRatio > canvasAspectRatio) {
    // Image is wider than canvas - fit to width
    drawWidth = canvasWidth;
    drawHeight = drawWidth / imageAspectRatio;
    drawX = 0;
    drawY = (canvasHeight - drawHeight) / 2;
  } else {
    // Image is taller than canvas (or equal aspect ratios) - fit to height
    drawHeight = canvasHeight;
    drawWidth = drawHeight * imageAspectRatio;
    drawX = (canvasWidth - drawWidth) / 2;
    drawY = 0;
  }
  
  // Round positions to avoid subpixel rendering
  return {
    x: Math.round(drawX),
    y: Math.round(drawY),
    width: Math.round(drawWidth),
    height: Math.round(drawHeight),
    imageWidth,
    imageHeight
  };
}

/**
 * Draw an image on a canvas with proper scaling to fit while maintaining aspect ratio
 * Returns the placement coordinates for interaction handling
 */
export function drawScaledImage(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  canvasWidth: number,
  canvasHeight: number
): ImagePlacement {
  // Clear canvas with black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  
  // Calculate placement
  const placement = calculateImagePlacement(
    image.width,
    image.height,
    canvasWidth,
    canvasHeight
  );
  
  // Draw the image
  ctx.drawImage(
    image,
    placement.x,
    placement.y,
    placement.width,
    placement.height
  );
  
  return placement;
}

/**
 * Flip RGBA image data vertically (Y-axis) in place
 * This is needed to convert from GPU convention (Y=0 at bottom) to Canvas convention (Y=0 at top)
 * 
 * @param data - RGBA image data as Uint8Array or Uint8ClampedArray
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 */
export function flipImageDataY(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): void {
  const rowSizeBytes = width * 4; // 4 bytes per pixel (RGBA)
  const halfHeight = Math.floor(height / 2);
  const tempRow = new Uint8Array(rowSizeBytes);
  
  for (let y = 0; y < halfHeight; y++) {
    const topRowStart = y * rowSizeBytes;
    const bottomRowStart = (height - 1 - y) * rowSizeBytes;
    
    // Copy top row to temp
    tempRow.set(data.subarray(topRowStart, topRowStart + rowSizeBytes));
    
    // Copy bottom row to top row
    data.copyWithin(topRowStart, bottomRowStart, bottomRowStart + rowSizeBytes);
    
    // Copy temp (original top row) to bottom row
    data.set(tempRow, bottomRowStart);
  }
}
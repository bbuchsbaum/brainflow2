import type { SliceViewerPlacement } from './types.js';
export declare function calculateImagePlacement(imageWidth: number, imageHeight: number, canvasWidth: number, canvasHeight: number): SliceViewerPlacement;
/**
 * Draw `image` letterboxed into the canvas. With `mirrorX` it is drawn
 * mirrored left-right inside the same rectangle, and the returned placement
 * says so, so every mapping through it (crosshair, clicks, hover) follows.
 */
export declare function drawScaledImage(ctx: CanvasRenderingContext2D, image: ImageBitmap, canvasWidth: number, canvasHeight: number, mirrorX?: boolean): SliceViewerPlacement;
//# sourceMappingURL=canvasUtils.d.ts.map
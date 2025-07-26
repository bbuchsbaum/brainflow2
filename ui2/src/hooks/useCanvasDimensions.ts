/**
 * Hook to calculate canvas dimensions that maintain aspect ratio within a container
 * Ensures medical images display with proper proportions
 */

import { useMemo } from 'react';

interface CanvasDimensions {
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
}

/**
 * Calculate the maximum canvas size that fits within a container while maintaining aspect ratio
 * @param containerWidth - Available width in pixels
 * @param containerHeight - Available height in pixels
 * @param desiredWidth - Desired canvas width (from backend)
 * @param desiredHeight - Desired canvas height (from backend)
 * @returns Canvas dimensions and scale factor
 */
export function useCanvasDimensions(
  containerWidth: number,
  containerHeight: number,
  desiredWidth: number,
  desiredHeight: number
): CanvasDimensions {
  return useMemo(() => {
    // Calculate aspect ratios
    const desiredAspectRatio = desiredWidth / desiredHeight;
    const containerAspectRatio = containerWidth / containerHeight;
    
    let canvasWidth: number;
    let canvasHeight: number;
    let scale: number;
    
    if (containerAspectRatio > desiredAspectRatio) {
      // Container is wider - fit to height
      canvasHeight = containerHeight;
      canvasWidth = Math.floor(canvasHeight * desiredAspectRatio);
      scale = containerHeight / desiredHeight;
    } else {
      // Container is taller - fit to width
      canvasWidth = containerWidth;
      canvasHeight = Math.floor(canvasWidth / desiredAspectRatio);
      scale = containerWidth / desiredWidth;
    }
    
    // Ensure we don't exceed desired dimensions (no upscaling)
    if (scale > 1) {
      canvasWidth = desiredWidth;
      canvasHeight = desiredHeight;
      scale = 1;
    }
    
    return {
      canvasWidth,
      canvasHeight,
      scale
    };
  }, [containerWidth, containerHeight, desiredWidth, desiredHeight]);
}
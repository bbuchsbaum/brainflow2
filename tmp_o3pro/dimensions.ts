/**
 * Dimension utilities for safe dimension handling
 */

// Maximum dimension allowed by the system
export const MAX_DIMENSION = 8192;

// Default dimension when invalid
export const DEFAULT_DIMENSION = 512;

/**
 * Clamp a dimension value to safe bounds
 * @param value The dimension value to clamp
 * @param max Maximum allowed value (default: MAX_DIMENSION)
 * @param min Minimum allowed value (default: 1)
 * @returns Clamped dimension value
 */
export function clampDimension(value: number, max: number = MAX_DIMENSION, min: number = 50): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_DIMENSION;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/**
 * Clamp width and height dimensions
 * @param width Width to clamp
 * @param height Height to clamp
 * @returns Tuple of clamped [width, height]
 */
export function clampDimensions(width: number, height: number): [number, number] {
  return [clampDimension(width), clampDimension(height)];
}

/**
 * Validate and sanitize dimension values
 * @param width Width to validate
 * @param height Height to validate
 * @returns Object with validated dimensions and whether they were clamped
 */
export function validateDimensions(width: number, height: number): {
  width: number;
  height: number;
  wasClamped: boolean;
} {
  const clampedWidth = clampDimension(width);
  const clampedHeight = clampDimension(height);
  
  return {
    width: clampedWidth,
    height: clampedHeight,
    wasClamped: clampedWidth !== width || clampedHeight !== height
  };
}
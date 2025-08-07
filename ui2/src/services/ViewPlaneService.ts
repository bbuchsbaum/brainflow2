/**
 * ViewPlaneService - Centralized service for ViewPlane calculations
 * 
 * This service provides a single source of truth for all ViewPlane-related
 * calculations, ensuring consistency across the application and eliminating
 * code duplication.
 * 
 * Key responsibilities:
 * - Pixel size calculations (maintaining square pixels for medical imaging)
 * - Centering offsets for non-square volumes
 * - ViewPlane creation for specific slice positions
 * - Coordinate transformations
 */

import type { ViewPlane, ViewType } from '@/types/coordinates';

export class ViewPlaneService {
  /**
   * Calculate uniform pixel size for medical imaging
   * CRITICAL: Always uses the larger pixel size to ensure square pixels
   * This prevents distortion of anatomical structures
   * 
   * @param widthMm - Width of the volume in millimeters
   * @param heightMm - Height of the volume in millimeters
   * @param widthPx - Width of the viewport in pixels
   * @param heightPx - Height of the viewport in pixels
   * @returns Uniform pixel size in mm/pixel
   */
  calculatePixelSize(
    widthMm: number,
    heightMm: number,
    widthPx: number,
    heightPx: number
  ): number {
    // Use the larger pixel size to ensure the entire volume fits
    // while maintaining square pixels (no distortion)
    return Math.max(widthMm / widthPx, heightMm / heightPx);
  }

  /**
   * Calculate centering offsets for non-square volumes
   * These offsets ensure the volume is centered in the viewport
   * 
   * @param volumeWidthMm - Actual width of the volume data in mm
   * @param volumeHeightMm - Actual height of the volume data in mm
   * @param viewWidthPx - Width of the viewport in pixels
   * @param viewHeightPx - Height of the viewport in pixels
   * @param pixelSize - Uniform pixel size from calculatePixelSize
   * @returns X and Y offsets in millimeters
   */
  calculateCenteringOffsets(
    volumeWidthMm: number,
    volumeHeightMm: number,
    viewWidthPx: number,
    viewHeightPx: number,
    pixelSize: number
  ): { x: number; y: number } {
    // Calculate how many pixels the actual volume needs
    const actualWidthPx = volumeWidthMm / pixelSize;
    const actualHeightPx = volumeHeightMm / pixelSize;
    
    // Calculate centering offsets in mm
    return {
      x: (viewWidthPx - actualWidthPx) * pixelSize / 2,
      y: (viewHeightPx - actualHeightPx) * pixelSize / 2
    };
  }

  /**
   * Create ViewPlane for a specific slice position
   * This is the main method that combines pixel size and centering calculations
   * 
   * @param axis - The view type (axial, sagittal, or coronal)
   * @param slicePositionMm - Position of the slice in mm along the perpendicular axis
   * @param bounds - Volume bounds with min and max coordinates
   * @param viewDimensions - Viewport dimensions [width, height] in pixels
   * @returns Complete ViewPlane for rendering
   */
  createSliceViewPlane(
    axis: ViewType,
    slicePositionMm: number,
    bounds: { min: [number, number, number]; max: [number, number, number] },
    viewDimensions: [number, number]
  ): ViewPlane {
    const [viewWidth, viewHeight] = viewDimensions;
    
    // Calculate volume dimensions based on axis
    let widthMm: number;
    let heightMm: number;
    let origin: [number, number, number];
    let u_mm: [number, number, number];
    let v_mm: [number, number, number];
    
    switch (axis) {
      case 'axial':
        // Axial: X-Y plane at Z position
        widthMm = bounds.max[0] - bounds.min[0];   // X extent
        heightMm = bounds.max[1] - bounds.min[1];  // Y extent
        
        // Calculate pixel size and centering
        const axialPixelSize = this.calculatePixelSize(widthMm, heightMm, viewWidth, viewHeight);
        const axialOffsets = this.calculateCenteringOffsets(
          widthMm, heightMm, viewWidth, viewHeight, axialPixelSize
        );
        
        origin = [
          bounds.min[0] - axialOffsets.x,
          bounds.max[1] + axialOffsets.y,  // Y is inverted (top of image is max Y)
          slicePositionMm
        ];
        u_mm = [axialPixelSize, 0, 0];
        v_mm = [0, -axialPixelSize, 0];  // Negative for Y inversion
        break;
        
      case 'sagittal':
        // Sagittal: Y-Z plane at X position
        widthMm = bounds.max[1] - bounds.min[1];   // Y extent
        heightMm = bounds.max[2] - bounds.min[2];  // Z extent
        
        const sagittalPixelSize = this.calculatePixelSize(widthMm, heightMm, viewWidth, viewHeight);
        const sagittalOffsets = this.calculateCenteringOffsets(
          widthMm, heightMm, viewWidth, viewHeight, sagittalPixelSize
        );
        
        origin = [
          slicePositionMm,
          bounds.max[1] + sagittalOffsets.x,  // Y maps to screen X
          bounds.max[2] + sagittalOffsets.y   // Z maps to screen Y (inverted)
        ];
        u_mm = [0, -sagittalPixelSize, 0];  // Y runs right-to-left
        v_mm = [0, 0, -sagittalPixelSize];  // Z runs top-to-bottom
        break;
        
      case 'coronal':
        // Coronal: X-Z plane at Y position
        widthMm = bounds.max[0] - bounds.min[0];   // X extent
        heightMm = bounds.max[2] - bounds.min[2];  // Z extent
        
        const coronalPixelSize = this.calculatePixelSize(widthMm, heightMm, viewWidth, viewHeight);
        const coronalOffsets = this.calculateCenteringOffsets(
          widthMm, heightMm, viewWidth, viewHeight, coronalPixelSize
        );
        
        origin = [
          bounds.min[0] - coronalOffsets.x,
          slicePositionMm,
          bounds.max[2] + coronalOffsets.y  // Z is inverted
        ];
        u_mm = [coronalPixelSize, 0, 0];
        v_mm = [0, 0, -coronalPixelSize];  // Z runs top-to-bottom
        break;
        
      default:
        throw new Error(`Invalid axis: ${axis}`);
    }
    
    return {
      origin_mm: origin,
      u_mm,
      v_mm,
      size: viewDimensions
    };
  }

  /**
   * Check if two ViewPlanes are equivalent (within tolerance)
   * Useful for avoiding unnecessary re-renders
   * 
   * @param a - First ViewPlane
   * @param b - Second ViewPlane
   * @param tolerance - Numerical tolerance for comparison (default 0.001mm)
   * @returns true if ViewPlanes are equivalent
   */
  areViewPlanesEqual(a: ViewPlane, b: ViewPlane, tolerance: number = 0.001): boolean {
    if (!a || !b) return false;
    
    // Check dimensions
    if (a.size[0] !== b.size[0] || a.size[1] !== b.size[1]) {
      return false;
    }
    
    // Check origin
    for (let i = 0; i < 3; i++) {
      if (Math.abs(a.origin_mm[i] - b.origin_mm[i]) > tolerance) {
        return false;
      }
    }
    
    // Check u vector
    for (let i = 0; i < 3; i++) {
      if (Math.abs(a.u_mm[i] - b.u_mm[i]) > tolerance) {
        return false;
      }
    }
    
    // Check v vector
    for (let i = 0; i < 3; i++) {
      if (Math.abs(a.v_mm[i] - b.v_mm[i]) > tolerance) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Extract the pixel size from a ViewPlane
   * Assumes uniform pixel size (square pixels)
   * 
   * @param viewPlane - The ViewPlane to extract pixel size from
   * @returns Pixel size in mm/pixel
   */
  getPixelSize(viewPlane: ViewPlane): number {
    // The pixel size is the magnitude of the u or v vector
    const uMagnitude = Math.sqrt(
      viewPlane.u_mm[0] ** 2 + 
      viewPlane.u_mm[1] ** 2 + 
      viewPlane.u_mm[2] ** 2
    );
    return uMagnitude;
  }

  /**
   * Calculate the visible bounds of a ViewPlane in world coordinates
   * 
   * @param viewPlane - The ViewPlane to calculate bounds for
   * @returns Min and max world coordinates visible in the view
   */
  getVisibleBounds(viewPlane: ViewPlane): { 
    min: [number, number, number]; 
    max: [number, number, number] 
  } {
    const [width, height] = viewPlane.size;
    
    // Calculate the four corners of the view
    const corners = [
      viewPlane.origin_mm,  // Top-left (0, 0)
      [
        viewPlane.origin_mm[0] + viewPlane.u_mm[0] * width,
        viewPlane.origin_mm[1] + viewPlane.u_mm[1] * width,
        viewPlane.origin_mm[2] + viewPlane.u_mm[2] * width
      ],  // Top-right (width, 0)
      [
        viewPlane.origin_mm[0] + viewPlane.v_mm[0] * height,
        viewPlane.origin_mm[1] + viewPlane.v_mm[1] * height,
        viewPlane.origin_mm[2] + viewPlane.v_mm[2] * height
      ],  // Bottom-left (0, height)
      [
        viewPlane.origin_mm[0] + viewPlane.u_mm[0] * width + viewPlane.v_mm[0] * height,
        viewPlane.origin_mm[1] + viewPlane.u_mm[1] * width + viewPlane.v_mm[1] * height,
        viewPlane.origin_mm[2] + viewPlane.u_mm[2] * width + viewPlane.v_mm[2] * height
      ]  // Bottom-right (width, height)
    ];
    
    // Find min and max for each dimension
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    
    for (const corner of corners) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], corner[i]);
        max[i] = Math.max(max[i], corner[i]);
      }
    }
    
    return { min, max };
  }
}

// Singleton instance
let viewPlaneService: ViewPlaneService | null = null;

/**
 * Get the singleton ViewPlaneService instance
 */
export function getViewPlaneService(): ViewPlaneService {
  if (!viewPlaneService) {
    viewPlaneService = new ViewPlaneService();
  }
  return viewPlaneService;
}
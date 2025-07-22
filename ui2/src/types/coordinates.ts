/**
 * Core coordinate system types for Brainflow2
 * These types ensure type safety for world-space coordinate handling
 */

// World coordinates in millimeters (LPI: Left-Posterior-Inferior)
export type WorldCoordinates = [number, number, number];

// Screen/pixel coordinates
export type ScreenCoordinates = [number, number];

// View plane definition - frontend owns this completely
export interface ViewPlane {
  // Upper-left corner of the view plane in world space (mm)
  origin_mm: WorldCoordinates;
  
  // Right vector - world units (mm) per pixel
  u_mm: WorldCoordinates;
  
  // Down vector - world units (mm) per pixel  
  v_mm: WorldCoordinates;
  
  // Output dimensions in pixels [width, height]
  dim_px: [number, number];
}

export type ViewType = 'axial' | 'sagittal' | 'coronal';

// Interpolation methods for volume sampling
export type InterpolationMethod = 'nearest' | 'linear' | 'cubic';

// Border handling for samples outside volume
export type BorderMode = 'clamp' | 'zero' | 'wrap';
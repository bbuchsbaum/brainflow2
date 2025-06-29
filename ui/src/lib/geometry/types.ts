/**
 * Core geometric types for slice viewing
 */

/** 3D vector in millimeters */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 2D vector (typically in pixels or NDC) */
export interface Vec2 {
  x: number;
  y: number;
}

/** Unsigned 2D vector for dimensions */
export interface UVec2 {
  x: number;
  y: number;
}

/** 3x3 rotation/orientation matrix */
export type Mat3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number]
];

/** 4x4 homogeneous transformation matrix */
export type Mat4 = [
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number]
];

/**
 * Volume metadata required for slice calculations
 */
export interface VolumeMeta {
  /** Dimensions in voxels */
  dims: Vec3;
  
  /** Spacing in mm/voxel */
  spacing: Vec3;
  
  /** World position of voxel (0,0,0) in mm */
  origin: Vec3;
  
  /** 3x3 orientation matrix (voxel to world rotation) */
  direction?: Mat3;
}

/**
 * Viewing plane specification
 */
export type Plane = 
  | 'axial'     // XY plane, Z normal
  | 'coronal'   // XZ plane, Y normal  
  | 'sagittal'  // YZ plane, X normal
  | { normal: Vec3; up: Vec3 }; // Custom oblique plane

/**
 * Core view frame representation
 * Defines the mapping from normalized device coordinates to world space
 */
export interface ViewFrame {
  /** World position at NDC (0,0) in mm */
  origin: Vec3;
  
  /** World vector covered by NDC [0,1] in X direction */
  u: Vec3;
  
  /** World vector covered by NDC [0,1] in Y direction */
  v: Vec3;
  
  /** Viewport dimensions in pixels */
  viewport_px: UVec2;
}

/**
 * Enhanced view frame with explicit scale
 * Separates orientation from scale for clearer interaction handling
 */
export interface ViewFrameExplicit {
  /** World position at NDC (0,0) in mm */
  origin: Vec3;
  
  /** Unit vector for view's X-axis direction */
  u_dir: Vec3;
  
  /** Unit vector for view's Y-axis direction */
  v_dir: Vec3;
  
  /** Scale factor: pixels per millimeter */
  pixels_per_mm: number;
  
  /** Viewport dimensions in pixels */
  viewport_px: UVec2;
  
  /** Version number for change detection */
  version: number;
}

/**
 * Render layer specification for multi-volume rendering
 */
export interface RenderLayer {
  /** Unique identifier for the volume */
  volumeId: string;
  
  /** Colormap to apply */
  colormapId: number;
  
  /** Layer opacity [0,1] */
  opacity: number;
  
  /** Intensity windowing */
  window: {
    level: number;
    width: number;
  };
  
  /** Optional thresholding */
  threshold?: {
    low: number;
    high: number;
    mode: 'range' | 'absolute';
  };
  
  /** Blend mode for compositing */
  blendMode?: 'over' | 'add' | 'max' | 'min';
}
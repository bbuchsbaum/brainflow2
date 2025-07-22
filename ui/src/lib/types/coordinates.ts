/**
 * Coordinate System Types and Transformations
 * 
 * This module defines the coordinate spaces used in the neuroimaging viewer
 * and provides type-safe transformations between them.
 */

import { ViewType } from './ViewType';

/**
 * World coordinates in mm (RAS+ convention)
 * - X: Left (-) to Right (+)
 * - Y: Posterior (-) to Anterior (+)
 * - Z: Inferior (-) to Superior (+)
 */
export type WorldCoord = [number, number, number];

/**
 * Voxel coordinates (integer indices into volume data)
 * - i: Column index (0 to dims[0]-1)
 * - j: Row index (0 to dims[1]-1)
 * - k: Slice index (0 to dims[2]-1)
 */
export type VoxelCoord = [number, number, number];

/**
 * Canvas/Screen coordinates in pixels
 * - x: Horizontal position from left (0 to width)
 * - y: Vertical position from top (0 to height)
 */
export type CanvasCoord = {
  x: number;
  y: number;
};

/**
 * Normalized Device Coordinates
 * - x: Horizontal position (-1 to 1, left to right)
 * - y: Vertical position (-1 to 1, bottom to top)
 */
export type NDC = {
  x: number;
  y: number;
};

/**
 * Frame parameters define the viewing rectangle in world space
 * These are INDEPENDENT of crosshair position
 */
export interface FrameParams {
  /** Center of the viewing frame in world coordinates */
  center: WorldCoord;
  
  /** Width of the frame in mm */
  width: number;
  
  /** Height of the frame in mm */
  height: number;
  
  /** View type (determines which axes map to screen X/Y) */
  viewType: ViewType;
  
  /** Slice position along the normal axis in mm */
  slicePosition: number;
}

/**
 * View state combines frame parameters with display settings
 */
export interface ViewState {
  /** Frame parameters (defines visible region) */
  frame: FrameParams;
  
  /** Current crosshair position in world coordinates */
  crosshair: WorldCoord;
  
  /** Zoom level (1.0 = fit to frame) */
  zoom: number;
  
  /** Pan offset in pixels */
  panOffset: CanvasCoord;
  
  /** Canvas dimensions in pixels */
  canvasSize: {
    width: number;
    height: number;
  };
}

/**
 * Maps view type to axis configuration
 */
export const VIEW_AXIS_CONFIG = {
  [ViewType.Axial]: {
    // Looking down Z axis (superior view)
    screenX: 0, // X maps to screen X (left-right)
    screenY: 1, // Y maps to screen Y (posterior-anterior)
    normal: 2,  // Z is the normal (slice) axis
    flipY: true // Y-axis flip for consistency with negative v vector
  },
  [ViewType.Coronal]: {
    // Looking down Y axis (anterior view)
    screenX: 0, // X maps to screen X (left-right)
    screenY: 2, // Z maps to screen Y (inferior-superior)
    normal: 1,  // Y is the normal (slice) axis
    flipY: true // Y-axis flip for medical convention
  },
  [ViewType.Sagittal]: {
    // Looking down X axis (right view)
    screenX: 1, // Y maps to screen X (posterior-anterior)
    screenY: 2, // Z maps to screen Y (inferior-superior)
    normal: 0,  // X is the normal (slice) axis
    flipY: true // Y-axis flip for medical convention
  }
} as const;

/**
 * Get frame bounds in world space
 */
export function getFrameBounds(frame: FrameParams): {
  min: WorldCoord;
  max: WorldCoord;
} {
  const config = VIEW_AXIS_CONFIG[frame.viewType];
  const halfWidth = frame.width / 2;
  const halfHeight = frame.height / 2;
  
  const min: WorldCoord = [...frame.center];
  const max: WorldCoord = [...frame.center];
  
  // Set bounds for the viewing plane
  min[config.screenX] = frame.center[config.screenX] - halfWidth;
  max[config.screenX] = frame.center[config.screenX] + halfWidth;
  
  min[config.screenY] = frame.center[config.screenY] - halfHeight;
  max[config.screenY] = frame.center[config.screenY] + halfHeight;
  
  // The normal axis is fixed at the slice position
  min[config.normal] = frame.slicePosition;
  max[config.normal] = frame.slicePosition;
  
  return { min, max };
}

/**
 * Transform canvas coordinates to world coordinates
 * This transformation is INDEPENDENT of crosshair position
 */
export function canvasToWorld(
  canvas: CanvasCoord,
  viewState: ViewState
): WorldCoord {
  const { frame, canvasSize, zoom, panOffset } = viewState;
  const config = VIEW_AXIS_CONFIG[frame.viewType];
  
  // Apply pan offset
  const adjustedX = canvas.x - panOffset.x;
  const adjustedY = canvas.y - panOffset.y;
  
  // Convert to normalized coordinates [0, 1]
  let normX = adjustedX / canvasSize.width;
  let normY = adjustedY / canvasSize.height;
  
  // Apply zoom (centered zoom)
  normX = 0.5 + (normX - 0.5) / zoom;
  normY = 0.5 + (normY - 0.5) / zoom;
  
  // Handle Y-axis flip for medical views
  if (config.flipY) {
    normY = 1 - normY;
  }
  
  // Convert to world coordinates using frame bounds
  const world: WorldCoord = [...frame.center];
  
  // Map normalized coords to world space
  world[config.screenX] = frame.center[config.screenX] + (normX - 0.5) * frame.width;
  world[config.screenY] = frame.center[config.screenY] + (normY - 0.5) * frame.height;
  world[config.normal] = frame.slicePosition;
  
  return world;
}

/**
 * Transform world coordinates to canvas coordinates
 */
export function worldToCanvas(
  world: WorldCoord,
  viewState: ViewState
): CanvasCoord | null {
  const { frame, canvasSize, zoom, panOffset } = viewState;
  const config = VIEW_AXIS_CONFIG[frame.viewType];
  
  // Check if point is on the current slice
  const tolerance = 0.5; // mm
  if (Math.abs(world[config.normal] - frame.slicePosition) > tolerance) {
    return null;
  }
  
  // Convert to normalized coordinates
  let normX = (world[config.screenX] - frame.center[config.screenX]) / frame.width + 0.5;
  let normY = (world[config.screenY] - frame.center[config.screenY]) / frame.height + 0.5;
  
  // Handle Y-axis flip for medical views
  if (config.flipY) {
    normY = 1 - normY;
  }
  
  // Apply zoom
  normX = 0.5 + (normX - 0.5) * zoom;
  normY = 0.5 + (normY - 0.5) * zoom;
  
  // Check if within visible bounds
  if (normX < 0 || normX > 1 || normY < 0 || normY > 1) {
    return null;
  }
  
  // Convert to canvas coordinates
  return {
    x: normX * canvasSize.width + panOffset.x,
    y: normY * canvasSize.height + panOffset.y
  };
}

/**
 * Calculate initial frame parameters for a volume
 */
export function calculateInitialFrame(
  volumeBounds: { min: WorldCoord; max: WorldCoord },
  viewType: ViewType
): FrameParams {
  const config = VIEW_AXIS_CONFIG[viewType];
  
  // Calculate center of volume
  const center: WorldCoord = [
    (volumeBounds.min[0] + volumeBounds.max[0]) / 2,
    (volumeBounds.min[1] + volumeBounds.max[1]) / 2,
    (volumeBounds.min[2] + volumeBounds.max[2]) / 2
  ];
  
  // Calculate frame dimensions with padding
  const padding = 1.2; // 20% padding
  const width = (volumeBounds.max[config.screenX] - volumeBounds.min[config.screenX]) * padding;
  const height = (volumeBounds.max[config.screenY] - volumeBounds.min[config.screenY]) * padding;
  
  return {
    center,
    width,
    height,
    viewType,
    slicePosition: center[config.normal]
  };
}

/**
 * Update frame for a new slice position
 */
export function updateFrameSlice(
  frame: FrameParams,
  slicePosition: number
): FrameParams {
  return {
    ...frame,
    slicePosition
  };
}

/**
 * Get the axis index for a given view type
 */
export function getSliceAxis(viewType: ViewType): number {
  return VIEW_AXIS_CONFIG[viewType].normal;
}

/**
 * Get screen axes for a view type
 */
export function getScreenAxes(viewType: ViewType): { x: number; y: number } {
  const config = VIEW_AXIS_CONFIG[viewType];
  return {
    x: config.screenX,
    y: config.screenY
  };
}
/**
 * Coordinate transformation utilities for annotation rendering
 */

import type { ViewPlane, WorldCoordinates, ScreenCoordinates } from '@/types/coordinates';

export interface CoordinateTransform {
  worldToScreen(world_mm: WorldCoordinates, plane: ViewPlane): ScreenCoordinates | null;
  screenToWorld(screen: ScreenCoordinates, plane: ViewPlane): WorldCoordinates;
  isPointInView(world_mm: WorldCoordinates, plane: ViewPlane): boolean;
  getViewBounds(plane: ViewPlane): {
    min: WorldCoordinates;
    max: WorldCoordinates;
  };
}

/**
 * Transform world coordinates to screen coordinates
 */
export function worldToScreen(
  world_mm: WorldCoordinates, 
  plane: ViewPlane
): ScreenCoordinates | null {
  // Calculate offset from plane origin
  const offset: WorldCoordinates = [
    world_mm[0] - plane.origin_mm[0],
    world_mm[1] - plane.origin_mm[1], 
    world_mm[2] - plane.origin_mm[2],
  ];

  // Project onto plane coordinate system
  // Solve: offset = u * u_mm + v * v_mm
  // This is a 3D system with 2 unknowns, so we use least squares if overdetermined
  
  const u_dot_offset = dotProduct(plane.u_mm, offset);
  const v_dot_offset = dotProduct(plane.v_mm, offset);
  const u_dot_u = dotProduct(plane.u_mm, plane.u_mm);
  const v_dot_v = dotProduct(plane.v_mm, plane.v_mm);
  const u_dot_v = dotProduct(plane.u_mm, plane.v_mm);

  // Solve 2x2 system for u and v coefficients
  const det = u_dot_u * v_dot_v - u_dot_v * u_dot_v;
  
  if (Math.abs(det) < 1e-10) {
    return null; // Degenerate plane
  }

  const u = (u_dot_offset * v_dot_v - v_dot_offset * u_dot_v) / det;
  const v = (v_dot_offset * u_dot_u - u_dot_offset * u_dot_v) / det;

  // Check if point is within view bounds
  if (u < 0 || u >= plane.dim_px[0] || v < 0 || v >= plane.dim_px[1]) {
    return null; // Outside view
  }

  return [u, v];
}

/**
 * Transform screen coordinates to world coordinates
 */
export function screenToWorld(
  screen: ScreenCoordinates, 
  plane: ViewPlane
): WorldCoordinates {
  const [u, v] = screen;
  
  // Calculate world position using plane vectors
  const world_mm: WorldCoordinates = [
    plane.origin_mm[0] + u * plane.u_mm[0] + v * plane.v_mm[0],
    plane.origin_mm[1] + u * plane.u_mm[1] + v * plane.v_mm[1],
    plane.origin_mm[2] + u * plane.u_mm[2] + v * plane.v_mm[2],
  ];
  
  return world_mm;
}

/**
 * Check if a world point is visible in the current view
 */
export function isPointInView(
  world_mm: WorldCoordinates, 
  plane: ViewPlane
): boolean {
  const screenPos = worldToScreen(world_mm, plane);
  return screenPos !== null;
}

/**
 * Get the world coordinate bounds of the current view
 */
export function getViewBounds(plane: ViewPlane): {
  min: WorldCoordinates;
  max: WorldCoordinates;
} {
  // Get corners of the view in world coordinates
  const corners = [
    screenToWorld([0, 0], plane),
    screenToWorld([plane.dim_px[0], 0], plane),
    screenToWorld([0, plane.dim_px[1]], plane),
    screenToWorld([plane.dim_px[0], plane.dim_px[1]], plane),
  ];

  const min: WorldCoordinates = [
    Math.min(...corners.map(c => c[0])),
    Math.min(...corners.map(c => c[1])),
    Math.min(...corners.map(c => c[2])),
  ];

  const max: WorldCoordinates = [
    Math.max(...corners.map(c => c[0])),
    Math.max(...corners.map(c => c[1])),
    Math.max(...corners.map(c => c[2])),
  ];

  return { min, max };
}

/**
 * Vector dot product
 */
function dotProduct(a: WorldCoordinates, b: WorldCoordinates): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Hook for coordinate transformations
 */
export function useCoordinateTransform(): CoordinateTransform {
  return {
    worldToScreen,
    screenToWorld,
    isPointInView,
    getViewBounds,
  };
}
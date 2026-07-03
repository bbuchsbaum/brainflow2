/**
 * Coordinate transformation utilities
 * Critical for pixel-perfect annotation alignment
 */

import type { ViewPlane, WorldCoordinates, ScreenCoordinates } from '@/types/coordinates';
import { distanceToPlane, pixelToWorld, worldToPixel } from '@/utils/sliceGeometry';

export class CoordinateTransform {
  /**
   * Convert screen pixel coordinates to world space coordinates
   * This is the fundamental operation for mouse interaction
   */
  static screenToWorld(x: number, y: number, plane: ViewPlane): WorldCoordinates {
    // World position = origin + x*u + y*v (canonical pixel_to_world).
    return pixelToWorld(plane, x, y);
  }

  /**
   * Project world coordinates to screen pixel coordinates
   * Returns null if the point is not on the view plane
   */
  static worldToScreen(
    world_mm: WorldCoordinates,
    plane: ViewPlane,
    tolerance: number = 0.5,
  ): ScreenCoordinates | null {
    // Reject points that lie off the slice plane, then solve for the pixel via
    // the shared in-plane inverse (worldToPixel returns null for a degenerate
    // basis, preserving the original behavior).
    if (distanceToPlane(plane, world_mm) > tolerance) {
      return null; // Point is not on the plane
    }
    return worldToPixel(plane, world_mm);
  }

  /**
   * Project world coordinates to screen pixel coordinates without plane tolerance check
   * Used for crosshair projections where we want to show the crosshair even if it's not exactly on the plane
   */
  static worldToScreenUnchecked(world_mm: WorldCoordinates, plane: ViewPlane): ScreenCoordinates {
    // Same in-plane inverse as worldToScreen, but with no plane-distance gate;
    // fall back to the raster center for a fully degenerate basis.
    return worldToPixel(plane, world_mm) ?? [plane.dim_px[0] / 2, plane.dim_px[1] / 2];
  }

  /**
   * Check if a world point is within tolerance of the view plane
   */
  static isPointOnPlane(
    world_mm: WorldCoordinates,
    plane: ViewPlane,
    tolerance: number = 0.5,
  ): boolean {
    return this.worldToScreen(world_mm, plane, tolerance) !== null;
  }

  /**
   * Calculate normal vector from two basis vectors
   */
  static calculateNormal(u: WorldCoordinates, v: WorldCoordinates): WorldCoordinates {
    const normal = this.crossProduct(u, v);
    const mag = this.magnitude(normal);
    return [normal[0] / mag, normal[1] / mag, normal[2] / mag];
  }

  // Helper methods
  private static crossProduct(a: WorldCoordinates, b: WorldCoordinates): WorldCoordinates {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  private static magnitude(v: WorldCoordinates): number {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  }
}

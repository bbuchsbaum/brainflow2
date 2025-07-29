/**
 * Coordinate transformation utilities
 * Critical for pixel-perfect annotation alignment
 */

import type { ViewPlane, WorldCoordinates, ScreenCoordinates, ViewType } from '@/types/coordinates';

export class CoordinateTransform {
  /**
   * Convert screen pixel coordinates to world space coordinates
   * This is the fundamental operation for mouse interaction
   */
  static screenToWorld(
    x: number,
    y: number,
    plane: ViewPlane
  ): WorldCoordinates {
    const [originX, originY, originZ] = plane.origin_mm;
    const [uX, uY, uZ] = plane.u_mm;
    const [vX, vY, vZ] = plane.v_mm;
    
    // World position = origin + x*u + y*v
    return [
      originX + x * uX + y * vX,
      originY + x * uY + y * vY,
      originZ + x * uZ + y * vZ
    ];
  }
  
  /**
   * Project world coordinates to screen pixel coordinates
   * Returns null if the point is not on the view plane
   */
  static worldToScreen(
    world_mm: WorldCoordinates,
    plane: ViewPlane,
    tolerance: number = 0.5
  ): ScreenCoordinates | null {
    const [worldX, worldY, worldZ] = world_mm;
    const [originX, originY, originZ] = plane.origin_mm;
    const [uX, uY, uZ] = plane.u_mm;
    const [vX, vY, vZ] = plane.v_mm;
    
    // Vector from origin to world point
    const deltaX = worldX - originX;
    const deltaY = worldY - originY;
    const deltaZ = worldZ - originZ;
    
    // Check if point is on the plane using the normal vector
    const normal = this.crossProduct(plane.u_mm, plane.v_mm);
    const distance = Math.abs(
      deltaX * normal[0] + deltaY * normal[1] + deltaZ * normal[2]
    ) / this.magnitude(normal);
    
    if (distance > tolerance) {
      return null; // Point is not on the plane
    }
    
    // Solve for screen coordinates using least squares
    // We want to find x, y such that: origin + x*u + y*v ≈ world
    // This becomes a 3x2 system that we solve in least squares sense
    
    const det = uX * vY - uY * vX;
    if (Math.abs(det) < 1e-10) {
      // Try Y-Z plane
      const detYZ = uY * vZ - uZ * vY;
      if (Math.abs(detYZ) > 1e-10) {
        const x = (deltaY * vZ - deltaZ * vY) / detYZ;
        const y = (deltaZ * uY - deltaY * uZ) / detYZ;
        return [x, y];
      }
      
      // Try X-Z plane  
      const detXZ = uX * vZ - uZ * vX;
      if (Math.abs(detXZ) > 1e-10) {
        const x = (deltaX * vZ - deltaZ * vX) / detXZ;
        const y = (deltaZ * uX - deltaX * uZ) / detXZ;
        return [x, y];
      }
      
      return null; // Degenerate case
    }
    
    // Use X-Y plane
    const x = (deltaX * vY - deltaY * vX) / det;
    const y = (deltaY * uX - deltaX * uY) / det;
    
    return [x, y];
  }
  
  /**
   * Check if a world point is within tolerance of the view plane
   */
  static isPointOnPlane(
    world_mm: WorldCoordinates,
    plane: ViewPlane,
    tolerance: number = 0.5
  ): boolean {
    return this.worldToScreen(world_mm, plane, tolerance) !== null;
  }
  
  /**
   * Create standard orthogonal view planes centered at a world point
   */
  static createOrthogonalViews(
    center_mm: WorldCoordinates,
    extent_mm: [number, number] = [200, 200],
    dim_px: [number, number] = [512, 512]
  ): Record<ViewType, ViewPlane> {
    const [centerX, centerY, centerZ] = center_mm;
    const [extentX, extentY] = extent_mm;
    const [dimX, dimY] = dim_px;
    
    // Use uniform pixel size to maintain aspect ratio
    // This matches the backend's SliceGeometry::full_extent implementation
    const pixelSize = Math.max(extentX / dimX, extentY / dimY);
    
    return {
      axial: {
        origin_mm: [centerX - extentX/2, centerY + extentY/2, centerZ],
        u_mm: [pixelSize, 0, 0],    // +X → right
        v_mm: [0, -pixelSize, 0],   // -Y → down (anterior to posterior)
        dim_px: [dimX, dimY]
      },
      
      sagittal: {
        origin_mm: [centerX, centerY + extentY/2, centerZ + extentY/2],
        u_mm: [0, -pixelSize, 0],   // -Y → right (anterior to posterior)  
        v_mm: [0, 0, -pixelSize],   // -Z → down (superior to inferior)
        dim_px: [dimX, dimY]
      },
      
      coronal: {
        origin_mm: [centerX - extentX/2, centerY, centerZ + extentY/2],
        u_mm: [pixelSize, 0, 0],    // +X → right
        v_mm: [0, 0, -pixelSize],   // -Z → down (superior to inferior)
        dim_px: [dimX, dimY]
      }
    };
  }
  
  // Helper methods
  private static crossProduct(a: WorldCoordinates, b: WorldCoordinates): WorldCoordinates {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2], 
      a[0] * b[1] - a[1] * b[0]
    ];
  }
  
  private static magnitude(v: WorldCoordinates): number {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  }
}
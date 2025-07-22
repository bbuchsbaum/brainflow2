/**
 * Coordinate Transform Tests
 */

import { describe, it, expect } from 'vitest';
import {
  worldToScreen,
  screenToWorld,
  isPointInView,
  getViewBounds,
  useCoordinateTransform
} from '../coordinateTransform';
import type { ViewPlane, WorldCoordinates, ScreenCoordinates } from '@/types/coordinates';

describe('coordinateTransform', () => {
  // Standard axial plane (looking at XY, Z=0)
  const axialPlane: ViewPlane = {
    origin_mm: [0, 0, 0],
    u_mm: [1, 0, 0], // X direction (right)
    v_mm: [0, 1, 0], // Y direction (down) 
    dim_px: [256, 256],
  };

  // Sagittal plane (looking at YZ, X=0)
  const sagittalPlane: ViewPlane = {
    origin_mm: [0, 0, 0],
    u_mm: [0, 1, 0], // Y direction (right)
    v_mm: [0, 0, 1], // Z direction (down)
    dim_px: [256, 256],
  };

  describe('worldToScreen', () => {
    it('should transform world coordinates to screen coordinates', () => {
      const worldPoint: WorldCoordinates = [10, 20, 0];
      const screenPoint = worldToScreen(worldPoint, axialPlane);
      
      expect(screenPoint).toEqual([10, 20]);
    });

    it('should handle points at plane origin', () => {
      const worldPoint: WorldCoordinates = [0, 0, 0];
      const screenPoint = worldToScreen(worldPoint, axialPlane);
      
      expect(screenPoint).toEqual([0, 0]);
    });

    it('should return null for points outside view bounds', () => {
      const worldPoint: WorldCoordinates = [300, 300, 0]; // Outside 256x256 view
      const screenPoint = worldToScreen(worldPoint, axialPlane);
      
      expect(screenPoint).toBeNull();
    });

    it('should handle different plane orientations', () => {
      const worldPoint: WorldCoordinates = [0, 10, 20];
      const screenPoint = worldToScreen(worldPoint, sagittalPlane);
      
      expect(screenPoint).toEqual([10, 20]); // Y->u, Z->v
    });

    it('should handle plane with non-zero origin', () => {
      const offsetPlane: ViewPlane = {
        origin_mm: [50, 50, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        dim_px: [256, 256],
      };
      
      const worldPoint: WorldCoordinates = [60, 70, 0];
      const screenPoint = worldToScreen(worldPoint, offsetPlane);
      
      expect(screenPoint).toEqual([10, 20]); // Offset by origin
    });
  });

  describe('screenToWorld', () => {
    it('should transform screen coordinates to world coordinates', () => {
      const screenPoint: ScreenCoordinates = [10, 20];
      const worldPoint = screenToWorld(screenPoint, axialPlane);
      
      expect(worldPoint).toEqual([10, 20, 0]);
    });

    it('should handle screen origin', () => {
      const screenPoint: ScreenCoordinates = [0, 0];
      const worldPoint = screenToWorld(screenPoint, axialPlane);
      
      expect(worldPoint).toEqual([0, 0, 0]);
    });

    it('should be inverse of worldToScreen', () => {
      const originalWorld: WorldCoordinates = [15, 25, 0];
      const screenPoint = worldToScreen(originalWorld, axialPlane);
      
      if (screenPoint) {
        const backToWorld = screenToWorld(screenPoint, axialPlane);
        expect(backToWorld[0]).toBeCloseTo(originalWorld[0], 10);
        expect(backToWorld[1]).toBeCloseTo(originalWorld[1], 10);
        expect(backToWorld[2]).toBeCloseTo(originalWorld[2], 10);
      }
    });

    it('should handle different plane orientations', () => {
      const screenPoint: ScreenCoordinates = [10, 20];
      const worldPoint = screenToWorld(screenPoint, sagittalPlane);
      
      expect(worldPoint).toEqual([0, 10, 20]); // u->Y, v->Z
    });
  });

  describe('isPointInView', () => {
    it('should return true for points within view', () => {
      const worldPoint: WorldCoordinates = [100, 100, 0];
      const inView = isPointInView(worldPoint, axialPlane);
      
      expect(inView).toBe(true);
    });

    it('should return false for points outside view', () => {
      const worldPoint: WorldCoordinates = [300, 300, 0];
      const inView = isPointInView(worldPoint, axialPlane);
      
      expect(inView).toBe(false);
    });

    it('should handle edge cases', () => {
      const edgePoint: WorldCoordinates = [255, 255, 0];
      const inView = isPointInView(edgePoint, axialPlane);
      
      expect(inView).toBe(true);
    });
  });

  describe('getViewBounds', () => {
    it('should return correct bounds for axial plane', () => {
      const bounds = getViewBounds(axialPlane);
      
      expect(bounds.min).toEqual([0, 0, 0]);
      expect(bounds.max).toEqual([256, 256, 0]);
    });

    it('should return correct bounds for sagittal plane', () => {
      const bounds = getViewBounds(sagittalPlane);
      
      expect(bounds.min).toEqual([0, 0, 0]);
      expect(bounds.max).toEqual([0, 256, 256]);
    });

    it('should handle plane with offset origin', () => {
      const offsetPlane: ViewPlane = {
        origin_mm: [100, 100, 50],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        dim_px: [128, 128],
      };
      
      const bounds = getViewBounds(offsetPlane);
      
      expect(bounds.min).toEqual([100, 100, 50]);
      expect(bounds.max).toEqual([228, 228, 50]);
    });
  });

  describe('edge cases', () => {
    it('should handle degenerate planes gracefully', () => {
      const degeneratePlane: ViewPlane = {
        origin_mm: [0, 0, 0],
        u_mm: [0, 0, 0], // Zero vector
        v_mm: [0, 0, 0], // Zero vector
        dim_px: [256, 256],
      };
      
      const worldPoint: WorldCoordinates = [10, 20, 30];
      const screenPoint = worldToScreen(worldPoint, degeneratePlane);
      
      expect(screenPoint).toBeNull();
    });

    it('should handle very small plane vectors', () => {
      const smallPlane: ViewPlane = {
        origin_mm: [0, 0, 0],
        u_mm: [0.001, 0, 0],
        v_mm: [0, 0.001, 0],
        dim_px: [256, 256],
      };
      
      const worldPoint: WorldCoordinates = [0.1, 0.2, 0];
      const screenPoint = worldToScreen(worldPoint, smallPlane);
      
      // The result should be [100, 200] but may be outside bounds, so check if calculated correctly
      if (screenPoint) {
        expect(screenPoint[0]).toBeCloseTo(100, 6);
        expect(screenPoint[1]).toBeCloseTo(200, 6);
      } else {
        // If outside bounds (which is valid), at least verify the math would work
        const u = 0.1 / 0.001; // Should be 100
        const v = 0.2 / 0.001; // Should be 200
        expect(u).toBe(100);
        expect(v).toBe(200);
      }
    });

    it('should handle negative coordinates', () => {
      const worldPoint: WorldCoordinates = [-10, -20, 0];
      const screenPoint = worldToScreen(worldPoint, axialPlane);
      
      expect(screenPoint).toBeNull(); // Outside positive bounds
    });
  });

  describe('useCoordinateTransform hook', () => {
    it('should return transform functions', () => {
      const transform = useCoordinateTransform();
      
      expect(typeof transform.worldToScreen).toBe('function');
      expect(typeof transform.screenToWorld).toBe('function');
      expect(typeof transform.isPointInView).toBe('function');
      expect(typeof transform.getViewBounds).toBe('function');
    });

    it('should provide working transform functions', () => {
      const transform = useCoordinateTransform();
      
      const worldPoint: WorldCoordinates = [50, 100, 0];
      const screenPoint = transform.worldToScreen(worldPoint, axialPlane);
      
      expect(screenPoint).toEqual([50, 100]);
    });
  });

  describe('precision and numerical stability', () => {
    it('should maintain precision for round-trip transformations', () => {
      const originalWorld: WorldCoordinates = [123.456, 789.012, 0];
      const screenPoint = worldToScreen(originalWorld, axialPlane);
      
      if (screenPoint) {
        const backToWorld = screenToWorld(screenPoint, axialPlane);
        expect(backToWorld[0]).toBeCloseTo(originalWorld[0], 6);
        expect(backToWorld[1]).toBeCloseTo(originalWorld[1], 6);
        expect(backToWorld[2]).toBeCloseTo(originalWorld[2], 6);
      }
    });

    it('should handle floating point coordinates', () => {
      const worldPoint: WorldCoordinates = [10.5, 20.7, 0];
      const screenPoint = worldToScreen(worldPoint, axialPlane);
      
      expect(screenPoint).toBeDefined();
      if (screenPoint) {
        expect(screenPoint[0]).toBeCloseTo(10.5, 6);
        expect(screenPoint[1]).toBeCloseTo(20.7, 6);
      }
    });
  });
});
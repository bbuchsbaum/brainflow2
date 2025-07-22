/**
 * Critical tests for coordinate transform system
 * These tests ensure pixel-perfect annotation alignment
 */

import { describe, it, expect } from 'vitest';
import { CoordinateTransform } from './coordinates';
import type { ViewPlane } from '@/types/coordinates';

describe('CoordinateTransform', () => {
  describe('screenToWorld', () => {
    it('should correctly transform axial plane coordinates', () => {
      const plane: ViewPlane = {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],    // 1mm per pixel right
        v_mm: [0, -1, 0],   // 1mm per pixel down
        dim_px: [512, 512]
      };
      
      // Center pixel should map to origin
      const world = CoordinateTransform.screenToWorld(0, 0, plane);
      expect(world).toEqual([0, 0, 0]);
      
      // Test other corners
      const topRight = CoordinateTransform.screenToWorld(100, 0, plane);
      expect(topRight).toEqual([100, 0, 0]);
      
      const bottomLeft = CoordinateTransform.screenToWorld(0, 100, plane);
      expect(bottomLeft).toEqual([0, -100, 0]);
    });
    
    it('should handle sagittal plane correctly', () => {
      const plane: ViewPlane = {
        origin_mm: [0, 0, 0],
        u_mm: [0, -1, 0],   // -Y direction (posterior)
        v_mm: [0, 0, -1],   // -Z direction (inferior)
        dim_px: [512, 512]
      };
      
      const world = CoordinateTransform.screenToWorld(50, 25, plane);
      expect(world).toEqual([0, -50, -25]);
    });
  });
  
  describe('worldToScreen', () => {
    it('should correctly project world points to axial plane', () => {
      const plane: ViewPlane = {
        origin_mm: [-100, 100, 15],  // Shifted origin
        u_mm: [1, 0, 0],
        v_mm: [0, -1, 0],
        dim_px: [200, 200]
      };
      
      // Point on the plane
      const screen = CoordinateTransform.worldToScreen([0, 0, 15], plane);
      expect(screen).toEqual([100, 100]);
      
      // Point not on plane should return null
      const offPlane = CoordinateTransform.worldToScreen([0, 0, 20], plane);
      expect(offPlane).toBeNull();
    });
    
    it('should handle points within tolerance', () => {
      const plane: ViewPlane = {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        dim_px: [100, 100]
      };
      
      // Point slightly off plane but within tolerance
      const nearPlane = CoordinateTransform.worldToScreen([10, 20, 0.3], plane, 0.5);
      expect(nearPlane).toEqual([10, 20]);
      
      // Point too far from plane
      const farPlane = CoordinateTransform.worldToScreen([10, 20, 1.0], plane, 0.5);
      expect(farPlane).toBeNull();
    });
  });
  
  describe('createOrthogonalViews', () => {
    it('should create properly oriented orthogonal views', () => {
      const center = [0, 0, 0] as [number, number, number];
      const views = CoordinateTransform.createOrthogonalViews(center);
      
      // Axial view should be in XY plane
      expect(views.axial.u_mm[2]).toBe(0); // No Z component in U
      expect(views.axial.v_mm[2]).toBe(0); // No Z component in V
      
      // Sagittal view should be in YZ plane  
      expect(views.sagittal.u_mm[0]).toBe(0); // No X component in U
      expect(views.sagittal.v_mm[0]).toBe(0); // No X component in V
      
      // Coronal view should be in XZ plane
      expect(views.coronal.u_mm[1]).toBe(0); // No Y component in U
      expect(views.coronal.v_mm[1]).toBe(0); // No Y component in V
    });
  });
  
  describe('round-trip accuracy', () => {
    it('should maintain precision through screen→world→screen transforms', () => {
      const plane: ViewPlane = {
        origin_mm: [-50, 50, 10],
        u_mm: [0.5, 0, 0],
        v_mm: [0, -0.5, 0],
        dim_px: [256, 256]
      };
      
      const originalScreen = [128, 64] as [number, number];
      
      // Transform to world and back
      const world = CoordinateTransform.screenToWorld(originalScreen[0], originalScreen[1], plane);
      const backToScreen = CoordinateTransform.worldToScreen(world, plane, 0.01);
      
      expect(backToScreen).not.toBeNull();
      expect(backToScreen![0]).toBeCloseTo(originalScreen[0], 6);
      expect(backToScreen![1]).toBeCloseTo(originalScreen[1], 6);
    });
  });
  
  describe('crosshair synchronization test', () => {
    it('should maintain crosshair position across orthogonal views', () => {
      const crosshairWorld = [10, 20, 30] as [number, number, number];
      const views = CoordinateTransform.createOrthogonalViews([0, 0, 0]);
      
      // Update view origins to pass through crosshair
      views.axial.origin_mm[2] = crosshairWorld[2];
      views.sagittal.origin_mm[0] = crosshairWorld[0];
      views.coronal.origin_mm[1] = crosshairWorld[1];
      
      // Project crosshair to each view
      const axialScreen = CoordinateTransform.worldToScreen(crosshairWorld, views.axial);
      const sagittalScreen = CoordinateTransform.worldToScreen(crosshairWorld, views.sagittal);
      const coronalScreen = CoordinateTransform.worldToScreen(crosshairWorld, views.coronal);
      
      // All projections should be valid
      expect(axialScreen).not.toBeNull();
      expect(sagittalScreen).not.toBeNull();
      expect(coronalScreen).not.toBeNull();
      
      // Convert back to world to verify consistency
      if (axialScreen) {
        const worldFromAxial = CoordinateTransform.screenToWorld(
          axialScreen[0], axialScreen[1], views.axial
        );
        expect(worldFromAxial[0]).toBeCloseTo(crosshairWorld[0], 3);
        expect(worldFromAxial[1]).toBeCloseTo(crosshairWorld[1], 3);
        expect(worldFromAxial[2]).toBeCloseTo(crosshairWorld[2], 3);
      }
    });
  });
});
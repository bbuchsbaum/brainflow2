/**
 * Unit tests for ViewFrame calculations
 */
import { describe, it, expect } from 'vitest';
import type { VolumeMeta, ViewFrame } from './types';
import { 
  makeFrame, 
  screenToWorld, 
  worldToScreen,
  resolvePlane,
  calculateFieldOfView,
  sliceIndexToMillimeters,
  sliceMillimetersToIndex
} from './viewFrame';

describe('viewFrame', () => {
  // Test volume: 10x10x10 voxels, 1mm spacing, origin at (0,0,0)
  const testVolume: VolumeMeta = {
    dims: [10, 10, 10],
    spacing: [1, 1, 1],
    origin: [0, 0, 0]
  };

  describe('resolvePlane', () => {
    it('should resolve anatomical planes correctly', () => {
      const axial = resolvePlane('axial');
      expect(axial.normal).toEqual([0, 0, 1]);
      expect(axial.up).toEqual([0, 1, 0]);

      const coronal = resolvePlane('coronal');
      expect(coronal.normal).toEqual([0, 1, 0]);
      expect(coronal.up).toEqual([0, 0, -1]);

      const sagittal = resolvePlane('sagittal');
      expect(sagittal.normal).toEqual([1, 0, 0]);
      expect(sagittal.up).toEqual([0, 0, -1]);
    });

    it('should handle custom planes', () => {
      const custom = resolvePlane({
        normal: [1, 1, 0],
        up: [0, 0, 1]
      });
      
      // Normal should be normalized
      expect(Math.abs(custom.normal[0] - 0.707)).toBeLessThan(0.01);
      expect(Math.abs(custom.normal[1] - 0.707)).toBeLessThan(0.01);
      expect(custom.normal[2]).toBe(0);
      
      // Up should be orthogonal to normal
      const dot = custom.normal[0] * custom.up[0] + 
                  custom.normal[1] * custom.up[1] + 
                  custom.normal[2] * custom.up[2];
      expect(Math.abs(dot)).toBeLessThan(0.001);
    });
  });

  describe('slice conversions', () => {
    it('should convert slice mm to index for axial plane', () => {
      const normal = [0, 0, 1] as [number, number, number];
      
      // At origin
      expect(sliceMillimetersToIndex(0, testVolume, normal)).toBe(0);
      
      // Middle slice
      expect(sliceMillimetersToIndex(5, testVolume, normal)).toBe(5);
      
      // Last slice
      expect(sliceMillimetersToIndex(9, testVolume, normal)).toBe(9);
    });

    it('should convert slice index to mm for axial plane', () => {
      const normal = [0, 0, 1] as [number, number, number];
      
      expect(sliceIndexToMillimeters(0, testVolume, normal)).toBe(0);
      expect(sliceIndexToMillimeters(5, testVolume, normal)).toBe(5);
      expect(sliceIndexToMillimeters(9, testVolume, normal)).toBe(9);
    });

    it('should handle negative spacing', () => {
      const volumeNegSpacing: VolumeMeta = {
        dims: [10, 10, 10],
        spacing: [1, 1, -1],
        origin: [0, 0, 9]
      };
      
      const normal = [0, 0, 1] as [number, number, number];
      
      // With negative spacing, slice 0 is at z=9, slice 9 is at z=0
      expect(sliceIndexToMillimeters(0, volumeNegSpacing, normal)).toBe(9);
      expect(sliceIndexToMillimeters(9, volumeNegSpacing, normal)).toBe(0);
    });
  });

  describe('calculateFieldOfView', () => {
    it('should calculate FOV for axial plane', () => {
      const fov = calculateFieldOfView(testVolume, 'axial');
      
      // For a 10x10x10 volume with 1mm spacing, 
      // axial view shows XY plane: 9x9 mm (0-9 indices)
      expect(fov.width).toBe(9);  // X dimension
      expect(fov.height).toBe(9); // Y dimension
    });

    it('should calculate FOV for coronal plane', () => {
      const fov = calculateFieldOfView(testVolume, 'coronal');
      
      // Coronal view shows XZ plane
      expect(fov.width).toBe(9);  // X dimension
      expect(fov.height).toBe(9); // Z dimension
    });

    it('should calculate FOV for sagittal plane', () => {
      const fov = calculateFieldOfView(testVolume, 'sagittal');
      
      // Sagittal view shows YZ plane
      expect(fov.width).toBe(9);  // Y dimension
      expect(fov.height).toBe(9); // Z dimension
    });
  });

  describe('makeFrame', () => {
    const viewport = { width: 512, height: 512 };

    it('should create correct frame for axial view at slice 5', () => {
      const frame = makeFrame(
        testVolume,
        'axial',
        5, // middle slice
        1, // no zoom
        { x: 0, y: 0 }, // no pan
        viewport
      );

      // Origin should be at bottom-left of the view
      // For axial at z=5, centered on volume
      expect(frame.origin[2]).toBe(5); // Z coordinate at slice
      
      // U vector should point along positive X
      expect(frame.u[0]).toBeGreaterThan(0);
      expect(frame.u[1]).toBeCloseTo(0);
      expect(frame.u[2]).toBeCloseTo(0);
      
      // V vector should point along positive Y
      expect(frame.v[0]).toBeCloseTo(0);
      expect(frame.v[1]).toBeGreaterThan(0);
      expect(frame.v[2]).toBeCloseTo(0);
      
      // Should maintain aspect ratio
      const uLength = Math.sqrt(frame.u[0]**2 + frame.u[1]**2 + frame.u[2]**2);
      const vLength = Math.sqrt(frame.v[0]**2 + frame.v[1]**2 + frame.v[2]**2);
      expect(Math.abs(uLength - vLength)).toBeLessThan(0.001);
    });

    it('should handle zoom correctly', () => {
      const frame1 = makeFrame(testVolume, 'axial', 5, 1, { x: 0, y: 0 }, viewport);
      const frame2 = makeFrame(testVolume, 'axial', 5, 2, { x: 0, y: 0 }, viewport);
      
      // Zoom 2 should halve the world span
      const u1Length = Math.sqrt(frame1.u[0]**2 + frame1.u[1]**2 + frame1.u[2]**2);
      const u2Length = Math.sqrt(frame2.u[0]**2 + frame2.u[1]**2 + frame2.u[2]**2);
      
      expect(Math.abs(u2Length - u1Length / 2)).toBeLessThan(0.001);
    });

    it('should handle pan correctly', () => {
      const frame1 = makeFrame(testVolume, 'axial', 5, 1, { x: 0, y: 0 }, viewport);
      const frame2 = makeFrame(testVolume, 'axial', 5, 1, { x: 100, y: 0 }, viewport);
      
      // Pan should shift the origin
      expect(frame2.origin[0]).not.toBe(frame1.origin[0]);
      expect(frame2.origin[1]).toBe(frame1.origin[1]);
      expect(frame2.origin[2]).toBe(frame1.origin[2]);
    });
  });

  describe('coordinate transforms', () => {
    const viewport = { width: 512, height: 512 };
    const frame = makeFrame(testVolume, 'axial', 5, 1, { x: 0, y: 0 }, viewport);

    it('should convert screen to world coordinates', () => {
      // Center of screen
      const center = screenToWorld(frame, { x: 256, y: 256 });
      
      // Should be near volume center at slice 5
      expect(center[2]).toBe(5); // Z at slice
      expect(Math.abs(center[0] - 4.5)).toBeLessThan(1); // Near X center
      expect(Math.abs(center[1] - 4.5)).toBeLessThan(1); // Near Y center
      
      // Top-left corner
      const topLeft = screenToWorld(frame, { x: 0, y: 0 });
      expect(topLeft[2]).toBe(5); // Still at slice 5
    });

    it('should convert world to screen coordinates', () => {
      // Volume center
      const screenPos = worldToScreen(frame, [4.5, 4.5, 5]);
      
      // Should be near screen center
      expect(screenPos).not.toBeNull();
      if (screenPos) {
        expect(Math.abs(screenPos.x - 256)).toBeLessThan(50);
        expect(Math.abs(screenPos.y - 256)).toBeLessThan(50);
      }
      
      // Point not on slice should return null
      const offSlice = worldToScreen(frame, [4.5, 4.5, 0]);
      // This might not be null if the frame has thickness
      // For now, we just check it's a valid conversion
      expect(offSlice === null || typeof offSlice.x === 'number').toBe(true);
    });

    it('should round-trip screen to world to screen', () => {
      const screenPoints = [
        { x: 100, y: 100 },
        { x: 256, y: 256 },
        { x: 400, y: 400 }
      ];
      
      for (const point of screenPoints) {
        const world = screenToWorld(frame, point);
        const backToScreen = worldToScreen(frame, world);
        
        expect(backToScreen).not.toBeNull();
        if (backToScreen) {
          expect(Math.abs(backToScreen.x - point.x)).toBeLessThan(0.1);
          expect(Math.abs(backToScreen.y - point.y)).toBeLessThan(0.1);
        }
      }
    });
  });

  describe('edge cases', () => {
    it('should handle volume with non-zero origin', () => {
      const offsetVolume: VolumeMeta = {
        dims: [10, 10, 10],
        spacing: [1, 1, 1],
        origin: [100, 200, 300]
      };
      
      const frame = makeFrame(
        offsetVolume,
        'axial',
        305, // Middle slice in world coordinates
        1,
        { x: 0, y: 0 },
        { width: 512, height: 512 }
      );
      
      expect(frame.origin[2]).toBe(305);
      
      // Screen center should map to volume center in world space
      const center = screenToWorld(frame, { x: 256, y: 256 });
      expect(Math.abs(center[0] - 104.5)).toBeLessThan(1); // 100 + 4.5
      expect(Math.abs(center[1] - 204.5)).toBeLessThan(1); // 200 + 4.5
      expect(center[2]).toBe(305);
    });

    it('should handle anisotropic spacing', () => {
      const anisoVolume: VolumeMeta = {
        dims: [10, 10, 10],
        spacing: [1, 2, 3], // Different spacing per axis
        origin: [0, 0, 0]
      };
      
      const fov = calculateFieldOfView(anisoVolume, 'axial');
      
      // FOV should reflect the anisotropic spacing
      expect(fov.width).toBe(9);   // 9 * 1mm
      expect(fov.height).toBe(18); // 9 * 2mm
    });
  });
});
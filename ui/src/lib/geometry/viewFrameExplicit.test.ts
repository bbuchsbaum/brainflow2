import { describe, it, expect } from 'vitest';
import {
  makeFrameExplicit,
  screenToWorld,
  worldToScreen,
  pan,
  zoomAroundPoint,
  calculateFieldOfView,
  resolvePlane,
  getFrameBounds,
  framesEqual,
  createFrameVersionGenerator
} from './viewFrameExplicit';
import type { VolumeMeta, Vec3, Vec2, UVec2 } from './types';

describe('ViewFrameExplicit', () => {
  const mockVolumeMeta: VolumeMeta = {
    dims: { x: 256, y: 256, z: 128 },
    spacing: { x: 1.0, y: 1.0, z: 2.0 },
    origin: { x: 0, y: 0, z: 0 }
  };
  
  const mockViewport: UVec2 = { x: 512, y: 512 };
  const getNextVersion = createFrameVersionGenerator();
  
  describe('makeFrameExplicit', () => {
    it('should create a frame with correct aspect ratio preservation', () => {
      const frame = makeFrameExplicit(
        mockVolumeMeta,
        'axial',
        64, // middle slice in Z
        1,  // zoom = 1
        { x: 0, y: 0 }, // no pan
        mockViewport,
        getNextVersion
      );
      
      // Check that frame maintains aspect ratio
      const worldWidth = mockViewport.x / frame.pixels_per_mm;
      const worldHeight = mockViewport.y / frame.pixels_per_mm;
      
      // For a square viewport, the world dimensions should be equal
      expect(worldWidth).toBeCloseTo(worldHeight, 5);
      
      // Check that the frame is centered on the volume
      const bounds = getFrameBounds(frame);
      const volumeCenter = {
        x: mockVolumeMeta.dims.x * mockVolumeMeta.spacing.x / 2,
        y: mockVolumeMeta.dims.y * mockVolumeMeta.spacing.y / 2,
        z: 64 // slice position
      };
      
      expect(bounds.center.x).toBeCloseTo(volumeCenter.x, 1);
      expect(bounds.center.y).toBeCloseTo(volumeCenter.y, 1);
    });
    
    it('should handle non-square viewports correctly', () => {
      const wideViewport: UVec2 = { x: 800, y: 400 };
      const frame = makeFrameExplicit(
        mockVolumeMeta,
        'axial',
        64,
        1,
        { x: 0, y: 0 },
        wideViewport,
        getNextVersion
      );
      
      const worldWidth = wideViewport.x / frame.pixels_per_mm;
      const worldHeight = wideViewport.y / frame.pixels_per_mm;
      
      // The aspect ratio should match the viewport
      expect(worldWidth / worldHeight).toBeCloseTo(wideViewport.x / wideViewport.y, 5);
    });
  });
  
  describe('coordinate transformations', () => {
    it('should correctly transform screen to world and back', () => {
      const frame = makeFrameExplicit(
        mockVolumeMeta,
        'axial',
        64,
        1,
        { x: 0, y: 0 },
        mockViewport,
        getNextVersion
      );
      
      // Test center of screen
      const screenCenter: Vec2 = { x: 256, y: 256 };
      const worldPoint = screenToWorld(frame, screenCenter);
      const screenBack = worldToScreen(frame, worldPoint);
      
      expect(screenBack).not.toBeNull();
      expect(screenBack!.x).toBeCloseTo(screenCenter.x, 5);
      expect(screenBack!.y).toBeCloseTo(screenCenter.y, 5);
    });
    
    it('should return null for out-of-bounds world points', () => {
      const frame = makeFrameExplicit(
        mockVolumeMeta,
        'axial',
        64,
        1,
        { x: 0, y: 0 },
        mockViewport,
        getNextVersion
      );
      
      // Point far outside the view
      const farPoint: Vec3 = { x: 1000, y: 1000, z: 64 };
      const screenPoint = worldToScreen(frame, farPoint);
      
      expect(screenPoint).toBeNull();
    });
    
    it('should correctly map corners', () => {
      const frame = makeFrameExplicit(
        mockVolumeMeta,
        'axial',
        64,
        1,
        { x: 0, y: 0 },
        mockViewport,
        getNextVersion
      );
      
      // Test all four corners
      const corners: Vec2[] = [
        { x: 0, y: 0 },                            // bottom-left
        { x: mockViewport.x, y: 0 },              // bottom-right
        { x: 0, y: mockViewport.y },              // top-left
        { x: mockViewport.x, y: mockViewport.y }  // top-right
      ];
      
      for (const corner of corners) {
        const world = screenToWorld(frame, corner);
        const back = worldToScreen(frame, world);
        
        expect(back).not.toBeNull();
        expect(back!.x).toBeCloseTo(corner.x, 5);
        expect(back!.y).toBeCloseTo(corner.y, 5);
      }
    });
  });
  
  describe('pan operations', () => {
    it('should correctly pan the view', () => {
      const frame = makeFrameExplicit(
        mockVolumeMeta,
        'axial',
        64,
        1,
        { x: 0, y: 0 },
        mockViewport,
        getNextVersion
      );
      
      const originalCenter = screenToWorld(frame, { x: 256, y: 256 });
      
      // Pan by 50 pixels right and 30 pixels down
      const pannedFrame = pan(frame, 50, 30, getNextVersion);
      
      const newCenter = screenToWorld(pannedFrame, { x: 256, y: 256 });
      
      // The world point at screen center should have moved
      expect(newCenter.x).not.toBeCloseTo(originalCenter.x, 2);
      expect(newCenter.y).not.toBeCloseTo(originalCenter.y, 2);
      
      // The original center should now be offset on screen
      const originalCenterScreen = worldToScreen(pannedFrame, originalCenter);
      expect(originalCenterScreen).not.toBeNull();
      expect(originalCenterScreen!.x).toBeCloseTo(256 - 50, 5);
      expect(originalCenterScreen!.y).toBeCloseTo(256 - 30, 5);
    });
  });
  
  describe('zoom operations', () => {
    it('should zoom around a focal point', () => {
      const frame = makeFrameExplicit(
        mockVolumeMeta,
        'axial',
        64,
        1,
        { x: 0, y: 0 },
        mockViewport,
        getNextVersion
      );
      
      // Pick a focal point off-center
      const focalScreen: Vec2 = { x: 300, y: 200 };
      const focalWorld = screenToWorld(frame, focalScreen);
      
      // Zoom in by 2x
      const zoomedFrame = zoomAroundPoint(frame, focalWorld, 2.0, getNextVersion);
      
      // The focal point should remain at the same screen position
      const focalScreenAfter = worldToScreen(zoomedFrame, focalWorld);
      expect(focalScreenAfter).not.toBeNull();
      expect(focalScreenAfter!.x).toBeCloseTo(focalScreen.x, 5);
      expect(focalScreenAfter!.y).toBeCloseTo(focalScreen.y, 5);
      
      // The pixels_per_mm should have doubled
      expect(zoomedFrame.pixels_per_mm).toBeCloseTo(frame.pixels_per_mm * 2, 5);
    });
  });
  
  describe('field of view calculations', () => {
    it('should calculate correct FOV for different planes', () => {
      const axialFov = calculateFieldOfView(mockVolumeMeta, 'axial');
      const coronalFov = calculateFieldOfView(mockVolumeMeta, 'coronal');
      const sagittalFov = calculateFieldOfView(mockVolumeMeta, 'sagittal');
      
      // Axial view (XY plane) should have width=256, height=256
      expect(axialFov.width).toBeCloseTo(256, 1);
      expect(axialFov.height).toBeCloseTo(256, 1);
      
      // Coronal view (XZ plane) should have width=256, height=256 (128 * 2.0 spacing)
      expect(coronalFov.width).toBeCloseTo(256, 1);
      expect(coronalFov.height).toBeCloseTo(256, 1);
      
      // Sagittal view (YZ plane) should have width=256, height=256
      expect(sagittalFov.width).toBeCloseTo(256, 1);
      expect(sagittalFov.height).toBeCloseTo(256, 1);
    });
  });
  
  describe('frame equality', () => {
    it('should correctly identify equal frames', () => {
      const frame1 = makeFrameExplicit(
        mockVolumeMeta,
        'axial',
        64,
        1,
        { x: 0, y: 0 },
        mockViewport,
        getNextVersion
      );
      
      // Create identical frame
      const frame2 = { ...frame1 };
      
      expect(framesEqual(frame1, frame2)).toBe(true);
    });
    
    it('should detect differences in frames', () => {
      const frame1 = makeFrameExplicit(
        mockVolumeMeta,
        'axial',
        64,
        1,
        { x: 0, y: 0 },
        mockViewport,
        getNextVersion
      );
      
      const frame2 = makeFrameExplicit(
        mockVolumeMeta,
        'axial',
        64,
        1.1, // Different zoom
        { x: 0, y: 0 },
        mockViewport,
        getNextVersion
      );
      
      expect(framesEqual(frame1, frame2)).toBe(false);
    });
  });
  
  describe('plane resolution', () => {
    it('should correctly resolve anatomical planes', () => {
      const axial = resolvePlane('axial');
      expect(axial.normal.z).toBeCloseTo(1, 5);
      expect(axial.up.y).toBeCloseTo(1, 5);
      
      const coronal = resolvePlane('coronal');
      expect(coronal.normal.y).toBeCloseTo(1, 5);
      expect(coronal.up.z).toBeCloseTo(-1, 5);
      
      const sagittal = resolvePlane('sagittal');
      expect(sagittal.normal.x).toBeCloseTo(1, 5);
      expect(sagittal.up.z).toBeCloseTo(-1, 5);
    });
  });
});
/**
 * CrosshairService Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CrosshairService, getCrosshairService, type VolumeInfo } from '../CrosshairService';
import { getEventBus } from '@/events/EventBus';
import type { ViewPlane, ViewType, WorldCoordinates } from '@/types/coordinates';

vi.mock('@/events/EventBus');

describe('CrosshairService', () => {
  let crosshairService: CrosshairService;
  let mockEventBus: any;

  beforeEach(() => {
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    (getEventBus as any).mockReturnValue(mockEventBus);
    
    // Create service after setting up the mock
    crosshairService = new CrosshairService();
  });

  describe('initialization', () => {
    it('should initialize with default crosshair state', () => {
      const state = crosshairService.getCrosshairState();
      
      expect(state.world_mm).toEqual([0, 0, 0]);
      expect(state.isVisible).toBe(true);
      expect(state.lastUpdatedView).toBeUndefined();
    });

    it('should provide singleton access', () => {
      const service1 = getCrosshairService();
      const service2 = getCrosshairService();
      
      expect(service1).toBe(service2);
    });
  });

  describe('volume setup', () => {
    it('should set volume info and center crosshair', () => {
      const volumeInfo: VolumeInfo = {
        dimensions: [256, 256, 256],
        voxel_size_mm: [1, 1, 1],
        origin_mm: [0, 0, 0],
        bounds_mm: {
          min: [-128, -128, -128],
          max: [128, 128, 128],
        },
      };

      crosshairService.setVolumeInfo(volumeInfo);

      const state = crosshairService.getCrosshairState();
      expect(state.world_mm).toEqual([0, 0, 0]); // Center of volume
      expect(mockEventBus.emit).toHaveBeenCalledWith('crosshair.updated', {
        world_mm: [0, 0, 0],
      });
    });
  });

  describe('crosshair positioning', () => {
    it('should set crosshair position directly', () => {
      const position: WorldCoordinates = [10, 20, 30];
      
      crosshairService.setCrosshair(position, 'axial');
      
      const state = crosshairService.getCrosshairState();
      expect(state.world_mm).toEqual([10, 20, 30]);
      expect(state.lastUpdatedView).toBe('axial');
      expect(mockEventBus.emit).toHaveBeenCalledWith('crosshair.updated', {
        world_mm: [10, 20, 30],
      });
    });

    it('should clamp position to volume bounds', () => {
      const volumeInfo: VolumeInfo = {
        dimensions: [100, 100, 100],
        voxel_size_mm: [1, 1, 1],
        origin_mm: [0, 0, 0],
        bounds_mm: {
          min: [0, 0, 0],
          max: [100, 100, 100],
        },
      };
      
      crosshairService.setVolumeInfo(volumeInfo);
      
      // Try to set position outside bounds
      crosshairService.setCrosshair([-10, 150, 50]);
      
      const state = crosshairService.getCrosshairState();
      expect(state.world_mm).toEqual([0, 100, 50]); // Clamped to bounds
    });
  });

  describe('view plane management', () => {
    let axialPlane: ViewPlane;
    let sagittalPlane: ViewPlane;
    
    beforeEach(() => {
      axialPlane = {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0], // Right vector (X direction)
        v_mm: [0, 1, 0], // Down vector (Y direction)
        dim_px: [256, 256],
      };
      
      sagittalPlane = {
        origin_mm: [0, 0, 0],
        u_mm: [0, 1, 0], // Right vector (Y direction)
        v_mm: [0, 0, 1], // Down vector (Z direction)
        dim_px: [256, 256],
      };
    });

    it('should set and retrieve view planes', () => {
      crosshairService.setViewPlane('axial', axialPlane);
      
      const retrievedPlane = crosshairService.getViewPlane('axial');
      expect(retrievedPlane).toEqual(axialPlane);
    });

    it('should update from screen position', () => {
      crosshairService.setViewPlane('axial', axialPlane);
      
      // Click at pixel position (10, 20)
      crosshairService.updateFromScreenPos(10, 20, 'axial');
      
      const state = crosshairService.getCrosshairState();
      // Using the view plane's vectors: origin + 10*u_mm + 20*v_mm
      expect(state.world_mm).toEqual([10, 20, 0]);
      expect(state.lastUpdatedView).toBe('axial');
    });
  });

  describe('view synchronization', () => {
    it('should synchronize view planes when crosshair moves', () => {
      const axialPlane: ViewPlane = {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        dim_px: [256, 256],
      };
      
      const sagittalPlane: ViewPlane = {
        origin_mm: [0, 0, 0],
        u_mm: [0, 1, 0],
        v_mm: [0, 0, 1],
        dim_px: [256, 256],
      };
      
      const coronalPlane: ViewPlane = {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 0, 1],
        dim_px: [256, 256],
      };
      
      crosshairService.setViewPlane('axial', axialPlane);
      crosshairService.setViewPlane('sagittal', sagittalPlane);
      crosshairService.setViewPlane('coronal', coronalPlane);
      
      // Move crosshair
      crosshairService.setCrosshair([10, 20, 30]);
      
      // Check that view plane updates were emitted
      expect(mockEventBus.emit).toHaveBeenCalledWith('view.plane.updated', {
        viewType: 'axial',
        plane: expect.objectContaining({
          origin_mm: [0, 0, 30], // Z updated for axial
        }),
      });
      
      expect(mockEventBus.emit).toHaveBeenCalledWith('view.plane.updated', {
        viewType: 'sagittal',
        plane: expect.objectContaining({
          origin_mm: [10, 0, 0], // X updated for sagittal
        }),
      });
      
      expect(mockEventBus.emit).toHaveBeenCalledWith('view.plane.updated', {
        viewType: 'coronal',
        plane: expect.objectContaining({
          origin_mm: [0, 20, 0], // Y updated for coronal
        }),
      });
    });
  });

  describe('visibility control', () => {
    it('should set crosshair visibility', () => {
      crosshairService.setVisible(false);
      
      const state = crosshairService.getCrosshairState();
      expect(state.isVisible).toBe(false);
      expect(mockEventBus.emit).toHaveBeenCalledWith('crosshair.visibility', {
        visible: false,
      });
    });

    it('should not emit event if visibility unchanged', () => {
      crosshairService.setVisible(true); // Already true by default
      
      expect(mockEventBus.emit).not.toHaveBeenCalledWith('crosshair.visibility', expect.any(Object));
    });
  });

  describe('reset functionality', () => {
    it('should reset to volume center', () => {
      const volumeInfo: VolumeInfo = {
        dimensions: [200, 200, 200],
        voxel_size_mm: [1, 1, 1],
        origin_mm: [0, 0, 0],
        bounds_mm: {
          min: [-100, -100, -100],
          max: [100, 100, 100],
        },
      };
      
      crosshairService.setVolumeInfo(volumeInfo);
      
      // Move crosshair away from center
      crosshairService.setCrosshair([50, 50, 50]);
      
      // Reset to center
      crosshairService.resetToCenter();
      
      const state = crosshairService.getCrosshairState();
      expect(state.world_mm).toEqual([0, 0, 0]);
    });

    it('should handle reset without volume info', () => {
      expect(() => crosshairService.resetToCenter()).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle screen to world conversion without view plane', () => {
      // Should warn and return early
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      crosshairService.updateFromScreenPos(10, 20, 'axial');
      
      expect(consoleSpy).toHaveBeenCalledWith('View plane not configured for axial');
      
      consoleSpy.mockRestore();
    });

    it('should validate volume bounds correctly', () => {
      const volumeInfo: VolumeInfo = {
        dimensions: [100, 100, 100],
        voxel_size_mm: [1, 1, 1],
        origin_mm: [0, 0, 0],
        bounds_mm: {
          min: [0, 0, 0],
          max: [100, 100, 100],
        },
      };
      
      crosshairService.setVolumeInfo(volumeInfo);
      
      // Position outside bounds should be clamped
      crosshairService.setCrosshair([150, -50, 50]);
      
      const state = crosshairService.getCrosshairState();
      expect(state.world_mm[0]).toBe(100); // Clamped to max
      expect(state.world_mm[1]).toBe(0);   // Clamped to min
      expect(state.world_mm[2]).toBe(50);  // Within bounds
    });
  });

  describe('cleanup', () => {
    it('should dispose resources properly', () => {
      const axialPlane: ViewPlane = {
        origin_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        dim_px: [256, 256],
      };
      
      crosshairService.setViewPlane('axial', axialPlane);
      
      const volumeInfo: VolumeInfo = {
        dimensions: [100, 100, 100],
        voxel_size_mm: [1, 1, 1],
        origin_mm: [0, 0, 0],
        bounds_mm: {
          min: [0, 0, 0],
          max: [100, 100, 100],
        },
      };
      
      crosshairService.setVolumeInfo(volumeInfo);
      
      crosshairService.dispose();
      
      expect(crosshairService.getViewPlanes().size).toBe(0);
      expect(crosshairService.getViewPlane('axial')).toBeUndefined();
    });
  });
});
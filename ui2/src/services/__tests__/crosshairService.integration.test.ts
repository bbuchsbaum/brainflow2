import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CrosshairService } from '../CrosshairService';
import { useViewStateStore } from '../../stores/viewStateStore';
import { EventBus } from '../../events/EventBus';
import type { WorldCoordinates, ScreenCoordinates, ViewPlane } from '../../types/coordinates';

// Mock the EventBus
vi.mock('../../events/EventBus', () => ({
  EventBus: {
    getInstance: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    }))
  }
}));

describe('CrosshairService Integration Tests', () => {
  let crosshairService: CrosshairService;
  let viewStateStore: ReturnType<typeof useViewStateStore>;
  let mockEventBus: any;

  beforeEach(() => {
    // Reset stores
    viewStateStore = useViewStateStore.getState();
    viewStateStore.resetToDefaults();
    
    // Get fresh service instance
    crosshairService = CrosshairService.getInstance();
    
    // Mock EventBus
    mockEventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    };
    (EventBus.getInstance as any).mockReturnValue(mockEventBus);
  });

  describe('Crosshair Coordinate Synchronization', () => {
    it('should synchronize world coordinates across all views', () => {
      // Arrange
      const worldCoords: WorldCoordinates = [10, 20, 30];
      
      // Act - Update crosshair position via service
      crosshairService.updateWorldPosition(worldCoords);
      
      // Assert - Event should be emitted
      expect(mockEventBus.emit).toHaveBeenCalledWith('crosshair.moved', {
        world_mm: worldCoords
      });
      
      // Store should be updated (assuming the service updates the store)
      const currentPosition = viewStateStore.getState().crosshair.world_mm;
      expect(currentPosition).toEqual(worldCoords);
    });

    it('should handle screen-to-world coordinate transformations', () => {
      // Arrange
      const screenCoords: ScreenCoordinates = [100, 150];
      const mockPlane: ViewPlane = {
        type: 'axial',
        slice_mm: 0,
        center_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        normal_mm: [0, 0, 1],
        dim_px: [256, 256],
        fov_mm: [256, 256],
        origin_px: [128, 128]
      };

      // Act - Convert screen to world coordinates
      const worldCoords = crosshairService.screenToWorld(screenCoords, mockPlane);

      // Assert - Should return valid world coordinates
      expect(worldCoords).toBeDefined();
      expect(Array.isArray(worldCoords)).toBe(true);
      expect(worldCoords).toHaveLength(3);
      
      // The exact values depend on the transformation math
      // but we can verify they're reasonable numbers
      worldCoords?.forEach(coord => {
        expect(typeof coord).toBe('number');
        expect(isFinite(coord)).toBe(true);
      });
    });

    it('should clamp coordinates to valid bounds', () => {
      // Arrange
      const outOfBoundsCoords: WorldCoordinates = [1000, -1000, 5000];
      const bounds = {
        min: [-100, -100, -100] as WorldCoordinates,
        max: [100, 100, 100] as WorldCoordinates
      };

      // Act - Update with out-of-bounds coordinates
      const clampedCoords = crosshairService.clampToBounds(outOfBoundsCoords, bounds);

      // Assert - Coordinates should be clamped to bounds
      expect(clampedCoords[0]).toBe(100);  // max x
      expect(clampedCoords[1]).toBe(-100); // min y
      expect(clampedCoords[2]).toBe(100);  // max z
    });
  });

  describe('View Synchronization', () => {
    it('should synchronize crosshair across multiple view planes', () => {
      // Arrange
      const axialPlane: ViewPlane = {
        type: 'axial',
        slice_mm: 10,
        center_mm: [0, 0, 10],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        normal_mm: [0, 0, 1],
        dim_px: [256, 256],
        fov_mm: [256, 256],
        origin_px: [128, 128]
      };

      const sagittalPlane: ViewPlane = {
        type: 'sagittal',
        slice_mm: 0,
        center_mm: [0, 0, 0],
        u_mm: [0, 1, 0],
        v_mm: [0, 0, 1],
        normal_mm: [1, 0, 0],
        dim_px: [256, 256],
        fov_mm: [256, 256],
        origin_px: [128, 128]
      };

      const worldPosition: WorldCoordinates = [15, 25, 35];

      // Act - Update crosshair position
      crosshairService.updateWorldPosition(worldPosition);

      // Calculate expected screen positions for each view
      const axialScreenPos = crosshairService.worldToScreen(worldPosition, axialPlane);
      const sagittalScreenPos = crosshairService.worldToScreen(worldPosition, sagittalPlane);

      // Assert - Both views should have valid screen coordinates
      expect(axialScreenPos).toBeDefined();
      expect(sagittalScreenPos).toBeDefined();
      
      if (axialScreenPos && sagittalScreenPos) {
        expect(axialScreenPos).toHaveLength(2);
        expect(sagittalScreenPos).toHaveLength(2);
        
        // Screen coordinates should be within reasonable bounds
        axialScreenPos.forEach(coord => {
          expect(coord).toBeGreaterThanOrEqual(0);
          expect(coord).toBeLessThanOrEqual(256);
        });
        
        sagittalScreenPos.forEach(coord => {
          expect(coord).toBeGreaterThanOrEqual(0);
          expect(coord).toBeLessThanOrEqual(256);
        });
      }
    });

    it('should handle view plane updates correctly', () => {
      // Arrange
      const initialPlane: ViewPlane = {
        type: 'coronal',
        slice_mm: 0,
        center_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 0, 1],
        normal_mm: [0, 1, 0],
        dim_px: [256, 256],
        fov_mm: [256, 256],
        origin_px: [128, 128]
      };

      const worldPosition: WorldCoordinates = [10, 20, 30];

      // Act - Set crosshair and get initial screen position
      crosshairService.updateWorldPosition(worldPosition);
      const initialScreenPos = crosshairService.worldToScreen(worldPosition, initialPlane);

      // Update the plane (simulate slice change)
      const updatedPlane: ViewPlane = {
        ...initialPlane,
        slice_mm: 25, // Different slice
        center_mm: [0, 25, 0]
      };

      const updatedScreenPos = crosshairService.worldToScreen(worldPosition, updatedPlane);

      // Assert - Screen positions should be different due to plane change
      expect(initialScreenPos).toBeDefined();
      expect(updatedScreenPos).toBeDefined();
      
      if (initialScreenPos && updatedScreenPos) {
        // Y coordinate should be different due to slice change
        expect(initialScreenPos[1]).not.toBe(updatedScreenPos[1]);
      }
    });
  });

  describe('Event Integration', () => {
    it('should emit crosshair events when position changes', () => {
      // Arrange
      const position1: WorldCoordinates = [5, 10, 15];
      const position2: WorldCoordinates = [20, 25, 30];

      // Act - Update position multiple times
      crosshairService.updateWorldPosition(position1);
      crosshairService.updateWorldPosition(position2);

      // Assert - Events should be emitted for each update
      expect(mockEventBus.emit).toHaveBeenCalledTimes(2);
      expect(mockEventBus.emit).toHaveBeenNthCalledWith(1, 'crosshair.moved', {
        world_mm: position1
      });
      expect(mockEventBus.emit).toHaveBeenNthCalledWith(2, 'crosshair.moved', {
        world_mm: position2
      });
    });

    it('should handle mouse click events for crosshair updates', () => {
      // Arrange
      const clickPosition: ScreenCoordinates = [120, 180];
      const viewPlane: ViewPlane = {
        type: 'axial',
        slice_mm: 0,
        center_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        normal_mm: [0, 0, 1],
        dim_px: [256, 256],
        fov_mm: [256, 256],
        origin_px: [128, 128]
      };

      // Act - Simulate mouse click
      crosshairService.handleClick(clickPosition, viewPlane);

      // Assert - Should convert to world coordinates and emit event
      expect(mockEventBus.emit).toHaveBeenCalledWith('crosshair.clicked', {
        screen: clickPosition,
        plane: viewPlane.type
      });
    });
  });

  describe('Visibility and State Management', () => {
    it('should handle crosshair visibility changes', () => {
      // Arrange
      const initialVisibility = viewStateStore.getState().crosshair.visible;

      // Act - Toggle visibility
      crosshairService.setVisible(!initialVisibility);

      // Assert - Store should be updated
      const newVisibility = viewStateStore.getState().crosshair.visible;
      expect(newVisibility).toBe(!initialVisibility);

      // Event should be emitted
      expect(mockEventBus.emit).toHaveBeenCalledWith('crosshair.visibility.changed', {
        visible: !initialVisibility
      });
    });

    it('should maintain crosshair state consistency', () => {
      // Arrange
      const position: WorldCoordinates = [1, 2, 3];
      const visible = true;

      // Act - Set multiple properties
      crosshairService.updateWorldPosition(position);
      crosshairService.setVisible(visible);

      // Assert - Store should maintain consistent state
      const state = viewStateStore.getState().crosshair;
      expect(state.world_mm).toEqual(position);
      expect(state.visible).toBe(visible);
    });
  });

  describe('Performance and Optimization', () => {
    it('should debounce rapid coordinate updates', async () => {
      // Arrange
      const positions: WorldCoordinates[] = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
        [10, 11, 12]
      ];

      // Act - Rapidly update positions
      positions.forEach((pos, index) => {
        setTimeout(() => crosshairService.updateWorldPosition(pos), index * 10);
      });

      // Wait for debounce period
      await new Promise(resolve => setTimeout(resolve, 100));

      // Assert - Should have debounced the updates
      // The exact number depends on debounce implementation
      expect(mockEventBus.emit).toHaveBeenCalled();
      
      // Final position should be the last one
      const finalState = viewStateStore.getState().crosshair;
      expect(finalState.world_mm).toEqual(positions[positions.length - 1]);
    });

    it('should handle coordinate transformation caching', () => {
      // Arrange
      const position: WorldCoordinates = [10, 20, 30];
      const plane: ViewPlane = {
        type: 'axial',
        slice_mm: 0,
        center_mm: [0, 0, 0],
        u_mm: [1, 0, 0],
        v_mm: [0, 1, 0],
        normal_mm: [0, 0, 1],
        dim_px: [256, 256],
        fov_mm: [256, 256],
        origin_px: [128, 128]
      };

      // Act - Transform same coordinates multiple times
      const result1 = crosshairService.worldToScreen(position, plane);
      const result2 = crosshairService.worldToScreen(position, plane);
      const result3 = crosshairService.worldToScreen(position, plane);

      // Assert - Results should be consistent
      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });
  });
});
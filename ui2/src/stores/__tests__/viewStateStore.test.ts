import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useViewStateStore } from '../viewStateStore';
import { coalesceUtils } from '../middleware/coalesceUpdatesMiddleware';
import type { ViewType, WorldCoordinates } from '@/types/coordinates';
import type { Layer } from '@/types/layer';

describe('ViewStateStore', () => {
  let store: ReturnType<typeof useViewStateStore>;
  let mockBackendCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset store to initial state
    store = useViewStateStore.getState();
    store.resetToDefaults();
    
    // Clear any pending coalescing updates
    coalesceUtils.clearPending();
    
    // Set up mock backend callback
    mockBackendCallback = vi.fn();
    coalesceUtils.setBackendCallback(mockBackendCallback);
    coalesceUtils.setEnabled(true);
  });

  afterEach(() => {
    coalesceUtils.clearPending();
    vi.clearAllTimers();
  });

  describe('Initial State', () => {
    it('should have correct initial view state', () => {
      const state = store.viewState;
      
      expect(state.crosshair.world_mm).toEqual([0, 0, 0]);
      expect(state.crosshair.visible).toBe(true);
      expect(state.layers).toHaveLength(0);
      
      // Should have all three orthogonal views
      expect(state.views).toHaveProperty('axial');
      expect(state.views).toHaveProperty('sagittal');
      expect(state.views).toHaveProperty('coronal');
      
      // All views should be properly initialized
      Object.values(state.views).forEach(view => {
        expect(view.dim_px).toEqual([512, 512]);
        expect(view.fov_mm).toEqual([200, 200]);
        expect(view.center_mm).toEqual([0, 0, 0]);
      });
    });
  });

  describe('Crosshair Management', () => {
    it('should update crosshair position and sync view origins', () => {
      const newPosition: WorldCoordinates = [10, 20, 30];
      
      // Act
      store.setCrosshair(newPosition);
      
      // Assert - Crosshair should be updated
      const state = store.viewState;
      expect(state.crosshair.world_mm).toEqual(newPosition);
      expect(state.crosshair.visible).toBe(true);
      
      // View origins should be updated to intersect at crosshair
      expect(state.views.axial.origin_mm[2]).toBe(30); // Z-coordinate
      expect(state.views.sagittal.origin_mm[0]).toBe(10); // X-coordinate
      expect(state.views.coronal.origin_mm[1]).toBe(20); // Y-coordinate
    });

    it('should handle crosshair visibility changes', () => {
      // Act
      store.setCrosshair([5, 10, 15], false);
      
      // Assert
      const state = store.viewState;
      expect(state.crosshair.world_mm).toEqual([5, 10, 15]);
      expect(state.crosshair.visible).toBe(false);
    });

    it('should coalesce rapid crosshair updates', async () => {
      // Act - Simulate rapid mouse movement
      const positions: WorldCoordinates[] = [
        [1, 1, 1],
        [2, 2, 2],
        [3, 3, 3],
        [4, 4, 4],
        [5, 5, 5]
      ];
      
      positions.forEach(pos => store.setCrosshair(pos));
      
      // Assert - UI should show latest position immediately
      expect(store.viewState.crosshair.world_mm).toEqual([5, 5, 5]);
      
      // Backend should not be called yet
      expect(mockBackendCallback).not.toHaveBeenCalled();
      expect(coalesceUtils.hasPendingUpdate()).toBe(true);
    });
  });

  describe('Layer Management', () => {
    const createTestLayer = (id: string): Layer => ({
      id,
      name: `Test Layer ${id}`,
      type: 'volume',
      visible: true,
      source: { type: 'file', path: `/test/${id}.nii` }
    });

    it('should add layers correctly', () => {
      const layer = createTestLayer('layer1');
      
      // Act
      store.addLayer(layer);
      
      // Assert
      const state = store.viewState;
      expect(state.layers).toHaveLength(1);
      expect(state.layers[0]).toEqual(layer);
    });

    it('should remove layers correctly', () => {
      const layer1 = createTestLayer('layer1');
      const layer2 = createTestLayer('layer2');
      
      // Arrange
      store.addLayer(layer1);
      store.addLayer(layer2);
      expect(store.viewState.layers).toHaveLength(2);
      
      // Act
      store.removeLayer('layer1');
      
      // Assert
      const state = store.viewState;
      expect(state.layers).toHaveLength(1);
      expect(state.layers[0].id).toBe('layer2');
    });

    it('should update layers correctly', () => {
      const layer = createTestLayer('updateLayer');
      
      // Arrange
      store.addLayer(layer);
      
      // Act
      store.updateLayer('updateLayer', { 
        visible: false, 
        name: 'Updated Layer' 
      });
      
      // Assert
      const state = store.viewState;
      const updatedLayer = state.layers.find(l => l.id === 'updateLayer');
      expect(updatedLayer?.visible).toBe(false);
      expect(updatedLayer?.name).toBe('Updated Layer');
    });

    it('should handle updating non-existent layer gracefully', () => {
      // Act & Assert - Should not throw
      expect(() => {
        store.updateLayer('nonexistent', { visible: false });
      }).not.toThrow();
      
      // State should remain unchanged
      expect(store.viewState.layers).toHaveLength(0);
    });
  });

  describe('View Management', () => {
    it('should update individual views', () => {
      const newAxialView = {
        type: 'axial' as ViewType,
        slice_mm: 25,
        center_mm: [10, 20, 30] as WorldCoordinates,
        u_mm: [1, 0, 0] as WorldCoordinates,
        v_mm: [0, 1, 0] as WorldCoordinates,
        normal_mm: [0, 0, 1] as WorldCoordinates,
        dim_px: [256, 256] as [number, number],
        fov_mm: [128, 128] as [number, number],
        origin_mm: [10, 20, 30] as WorldCoordinates,
        origin_px: [128, 128] as [number, number]
      };
      
      // Act
      store.updateView('axial', newAxialView);
      
      // Assert
      const state = store.viewState;
      expect(state.views.axial).toEqual(newAxialView);
      
      // Other views should remain unchanged
      expect(state.views.sagittal.slice_mm).toBe(0);
      expect(state.views.coronal.slice_mm).toBe(0);
    });

    it('should provide helper methods for views', () => {
      // Test getView
      const axialView = store.getView('axial');
      expect(axialView.type).toBe('axial');
      
      // Test getViews
      const allViews = store.getViews();
      expect(allViews).toHaveProperty('axial');
      expect(allViews).toHaveProperty('sagittal');
      expect(allViews).toHaveProperty('coronal');
    });
  });

  describe('State Management', () => {
    it('should support custom state updates', () => {
      const customUpdate = (state: any) => {
        return {
          ...state,
          crosshair: {
            world_mm: [100, 200, 300],
            visible: false
          }
        };
      };
      
      // Act
      store.setViewState(customUpdate);
      
      // Assert
      const state = store.viewState;
      expect(state.crosshair.world_mm).toEqual([100, 200, 300]);
      expect(state.crosshair.visible).toBe(false);
    });

    it('should handle void return from state updater', () => {
      const voidUpdate = (state: any) => {
        state.crosshair.visible = false;
        // No return value
      };
      
      // Act & Assert - Should not throw
      expect(() => {
        store.setViewState(voidUpdate);
      }).not.toThrow();
    });

    it('should reset to defaults correctly', () => {
      // Arrange - Modify state
      store.setCrosshair([50, 60, 70]);
      store.addLayer(createTestLayer('testLayer'));
      
      expect(store.viewState.crosshair.world_mm).toEqual([50, 60, 70]);
      expect(store.viewState.layers).toHaveLength(1);
      
      // Act
      store.resetToDefaults();
      
      // Assert - Should be back to initial state
      const state = store.viewState;
      expect(state.crosshair.world_mm).toEqual([0, 0, 0]);
      expect(state.crosshair.visible).toBe(true);
      expect(state.layers).toHaveLength(0);
    });

    const createTestLayer = (id: string): Layer => ({
      id,
      name: `Test Layer ${id}`,
      type: 'volume',
      visible: true,
      source: { type: 'file', path: `/test/${id}.nii` }
    });
  });

  describe('Undo/Redo Functionality', () => {
    it('should provide undo/redo methods', () => {
      // These methods are provided by temporal middleware
      expect(typeof store.undo).toBe('function');
      expect(typeof store.redo).toBe('function');
      expect(typeof store.canUndo).toBe('function');
      expect(typeof store.canRedo).toBe('function');
    });

    // Note: Actual undo/redo testing would require more complex setup
    // with the temporal middleware properly configured
  });

  describe('Coalescing Integration', () => {
    it('should coalesce multiple rapid state changes', async () => {
      // Act - Make multiple rapid changes
      store.setCrosshair([1, 1, 1]);
      store.setCrosshair([2, 2, 2]);
      store.addLayer(createTestLayer('layer1'));
      store.setCrosshair([3, 3, 3]);
      
      // Assert - Should have pending update
      expect(coalesceUtils.hasPendingUpdate()).toBe(true);
      expect(mockBackendCallback).not.toHaveBeenCalled();
      
      // UI should show latest state immediately
      const state = store.viewState;
      expect(state.crosshair.world_mm).toEqual([3, 3, 3]);
      expect(state.layers).toHaveLength(1);
    });

    it('should allow manual flushing of coalesced updates', () => {
      // Arrange
      store.setCrosshair([10, 20, 30]);
      expect(coalesceUtils.hasPendingUpdate()).toBe(true);
      
      // Act
      coalesceUtils.flush();
      
      // Assert
      expect(mockBackendCallback).toHaveBeenCalledTimes(1);
      expect(mockBackendCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          crosshair: {
            world_mm: [10, 20, 30],
            visible: true
          }
        })
      );
      expect(coalesceUtils.hasPendingUpdate()).toBe(false);
    });

    const createTestLayer = (id: string): Layer => ({
      id,
      name: `Test Layer ${id}`,
      type: 'volume',
      visible: true,
      source: { type: 'file', path: `/test/${id}.nii` }
    });
  });
});
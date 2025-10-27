import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useViewStateStore } from '../viewStateStore';
import { useViewLayoutStore } from '../viewLayoutStore';
import { coalesceUtils } from '../middleware/coalesceUpdatesMiddleware';
import type { ViewType, WorldCoordinates } from '@/types/coordinates';
import type { Layer } from '@/types/layer';

const recalcAllViewsMock = vi.fn();
const recalcViewForDimensionsMock = vi.fn();
const getVolumeBoundsMock = vi.fn();
const initRenderLoopMock = vi.fn();

vi.mock('@/services/apiService', () => ({
  getApiService: () => ({
    recalculateAllViews: recalcAllViewsMock,
    recalculateViewForDimensions: recalcViewForDimensionsMock,
    getVolumeBounds: getVolumeBoundsMock,
    initRenderLoop: initRenderLoopMock
  })
}));

describe('ViewStateStore', () => {
  let store: ReturnType<typeof useViewStateStore.getState>;
  let mockBackendCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Get the store state (which contains both state and methods)
    store = useViewStateStore.getState();

    // Reset store to initial state
    store.resetToDefaults();

    // Clear any pending coalescing updates
    coalesceUtils.clearPending();
    
    // Set up mock backend callback
    mockBackendCallback = vi.fn();
    coalesceUtils.setBackendCallback(mockBackendCallback);
    coalesceUtils.setEnabled(true);

    recalcAllViewsMock.mockReset();
    recalcViewForDimensionsMock.mockReset();
    getVolumeBoundsMock.mockReset();
    initRenderLoopMock.mockReset();

    recalcAllViewsMock.mockResolvedValue({
      axial: useViewStateStore.getState().viewState.views.axial,
      sagittal: useViewStateStore.getState().viewState.views.sagittal,
      coronal: useViewStateStore.getState().viewState.views.coronal
    });

    recalcViewForDimensionsMock.mockResolvedValue(
      useViewStateStore.getState().viewState.views.axial
    );

    getVolumeBoundsMock.mockResolvedValue({
      min: [-100, -100, -100],
      max: [100, 100, 100]
    });
  });

  afterEach(() => {
    coalesceUtils.clearPending();
    vi.clearAllTimers();
  });

  describe('Locked layout fallbacks', () => {
    it('falls back to volume bounds when multi-view recalculation fails', async () => {
      recalcAllViewsMock.mockRejectedValueOnce(new Error('backend unavailable'));
      getVolumeBoundsMock.mockResolvedValueOnce({
        min: [-96, -132, -78],
        max: [96, 132, 78]
      });

      useViewLayoutStore.getState().setMode('locked');

      const testLayer = {
        id: 'layer-1',
        name: 'Test Layer',
        volumeId: 'vol-1',
        visible: true,
        opacity: 1,
        isSelected: false,
        gpuStatus: 'ready',
        render: {
          opacity: 1,
          colormap: 'gray',
          intensityMin: 0,
          intensityMax: 1000,
          thresholdLow: 0,
          thresholdHigh: 0
        }
      } as unknown as Layer;

      store.setViewState((state) => {
        state.layers = [testLayer];
        return state;
      });

      await store.updateDimensionsAndPreserveScale('axial', [640, 480]);

      expect(recalcAllViewsMock).toHaveBeenCalledTimes(1);
      expect(getVolumeBoundsMock).toHaveBeenCalledTimes(1);

      const updatedView = useViewStateStore.getState().viewState.views.axial;
      expect(updatedView.dim_px).toEqual([640, 480]);
      expect(updatedView.u_mm).not.toEqual([0, 0, 0]);
      expect(updatedView.v_mm).not.toEqual([0, 0, 0]);
    });
  });

  describe('Initial State', () => {
    it('should have correct initial view state', () => {
      const state = useViewStateStore.getState().viewState;
      
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
        // fov_mm and center_mm properties no longer exist after refactoring
      });
    });
  });

  describe('Crosshair Management', () => {
    it('should update crosshair position and sync view origins', async () => {
      const newPosition: WorldCoordinates = [10, 20, 30];

      // Act - Pass updateViews=true to sync view origins
      await store.setCrosshair(newPosition, true);

      // Assert - Crosshair should be updated
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      expect(state.crosshair.world_mm).toEqual(newPosition);
      expect(state.crosshair.visible).toBe(true);

      // View origins should be updated to intersect at crosshair
      expect(state.views.axial.origin_mm[2]).toBe(30); // Z-coordinate
      expect(state.views.sagittal.origin_mm[0]).toBe(10); // X-coordinate
      expect(state.views.coronal.origin_mm[1]).toBe(20); // Y-coordinate
    });

    it('should handle crosshair visibility changes', async () => {
      // Act - Set position first, then change visibility
      await store.setCrosshair([5, 10, 15]);
      store.setCrosshairVisible(false);

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
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

      // Fire all updates without awaiting (rapid succession)
      positions.forEach(pos => store.setCrosshair(pos));

      // Wait for last one to complete
      await store.setCrosshair([5, 5, 5]);

      // Assert - UI should show latest position immediately
      // Get fresh state after update
      expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([5, 5, 5]);

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

      // Act - Use setViewState with Immer direct mutation
      store.setViewState((state) => {
        state.layers.push(layer);
        return state;
      });

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      expect(state.layers).toHaveLength(1);
      expect(state.layers[0]).toEqual(layer);
    });

    it('should remove layers correctly', () => {
      const layer1 = createTestLayer('layer1');
      const layer2 = createTestLayer('layer2');

      // Arrange - Add both layers with Immer direct mutation
      store.setViewState((state) => {
        state.layers.push(layer1, layer2);
        return state;
      });
      expect(useViewStateStore.getState().viewState.layers).toHaveLength(2);

      // Act - Remove layer1 with Immer direct mutation
      store.setViewState((state) => {
        state.layers = state.layers.filter(l => l.id !== 'layer1');
        return state;
      });

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      expect(state.layers).toHaveLength(1);
      expect(state.layers[0].id).toBe('layer2');
    });

    it('should update layers correctly', () => {
      const layer = createTestLayer('updateLayer');

      // Arrange - Add layer with Immer direct mutation
      store.setViewState((state) => {
        state.layers.push(layer);
        return state;
      });

      // Act - Update layer with Immer direct mutation
      store.setViewState((state) => {
        const layerToUpdate = state.layers.find(l => l.id === 'updateLayer');
        if (layerToUpdate) {
          layerToUpdate.visible = false;
          layerToUpdate.name = 'Updated Layer';
        }
        return state;
      });

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      const updatedLayer = state.layers.find(l => l.id === 'updateLayer');
      expect(updatedLayer?.visible).toBe(false);
      expect(updatedLayer?.name).toBe('Updated Layer');
    });

    it('should handle updating non-existent layer gracefully', () => {
      // Act & Assert - Should not throw
      expect(() => {
        store.setViewState((state) => {
          const layer = state.layers.find(l => l.id === 'nonexistent');
          if (layer) {
            layer.visible = false;
          }
          return state;
        });
      }).not.toThrow();

      // State should remain unchanged
      expect(useViewStateStore.getState().viewState.layers).toHaveLength(0);
    });
  });

  describe('View Management', () => {
    it('should update individual views', () => {
      // After refactoring, ViewPlane no longer has: type, slice_mm, center_mm, normal_mm, fov_mm, origin_px
      const newAxialView = {
        u_mm: [1, 0, 0] as WorldCoordinates,
        v_mm: [0, 1, 0] as WorldCoordinates,
        dim_px: [256, 256] as [number, number],
        origin_mm: [10, 20, 30] as WorldCoordinates,
      };

      // Act
      store.updateView('axial', newAxialView);

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
      expect(state.views.axial).toEqual(newAxialView);

      // Other views should remain unchanged (check initial values from getInitialViewState)
      expect(state.views.sagittal.origin_mm).toEqual([0, 100, 100]);
      expect(state.views.coronal.origin_mm).toEqual([-100, 0, 100]);
    });

    it('should provide helper methods for views', () => {
      // Test getView
      const axialView = store.getView('axial');
      // ViewPlane no longer has 'type' property after refactoring
      expect(axialView).toBeDefined();
      expect(axialView.dim_px).toEqual([512, 512]);

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
        state.crosshair = {
          world_mm: [100, 200, 300],
          visible: false
        };
        return state;
      };

      // Act
      store.setViewState(customUpdate);

      // Assert
      // Get fresh state after update
      const state = useViewStateStore.getState().viewState;
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

    it('should reset to defaults correctly', async () => {
      // Arrange - Modify state
      await store.setCrosshair([50, 60, 70]);
      store.setViewState((state) => {
        state.layers.push(createTestLayer('testLayer'));
        return state;
      });

      expect(useViewStateStore.getState().viewState.crosshair.world_mm).toEqual([50, 60, 70]);
      expect(useViewStateStore.getState().viewState.layers).toHaveLength(1);

      // Act
      store.resetToDefaults();

      // Assert - Should be back to initial state
      // Get fresh state after reset
      const state = useViewStateStore.getState().viewState;
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
      store.setViewState((state) => {
        state.layers.push(createTestLayer('layer1'));
        return state;
      });
      // Await the last setCrosshair
      await store.setCrosshair([3, 3, 3]);

      // Assert - Should have pending update
      expect(coalesceUtils.hasPendingUpdate()).toBe(true);
      expect(mockBackendCallback).not.toHaveBeenCalled();

      // UI should show latest state immediately
      // Get fresh state after updates
      const state = useViewStateStore.getState().viewState;
      expect(state.crosshair.world_mm).toEqual([3, 3, 3]);
      expect(state.layers).toHaveLength(1);
    });

    it('should allow manual flushing of coalesced updates', async () => {
      // Arrange
      await store.setCrosshair([10, 20, 30]);
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

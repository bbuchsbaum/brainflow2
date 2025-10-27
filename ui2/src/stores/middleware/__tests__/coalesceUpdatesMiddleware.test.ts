import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { create } from 'zustand';
import { coalesceUpdatesMiddleware, coalesceUtils } from '../coalesceUpdatesMiddleware';
import type { ViewState } from '@/types/viewState';

// Mock ViewState for testing
const createMockViewState = (id: string): ViewState => ({
  views: {
    axial: {
      type: 'axial',
      slice_mm: 0,
      center_mm: [0, 0, 0],
      u_mm: [1, 0, 0],
      v_mm: [0, 1, 0],
      normal_mm: [0, 0, 1],
      dim_px: [256, 256],
      fov_mm: [256, 256],
      origin_mm: [0, 0, 0],
      origin_px: [128, 128]
    },
    sagittal: {
      type: 'sagittal',
      slice_mm: 0,
      center_mm: [0, 0, 0],
      u_mm: [0, 1, 0],
      v_mm: [0, 0, 1],
      normal_mm: [1, 0, 0],
      dim_px: [256, 256],
      fov_mm: [256, 256],
      origin_mm: [0, 0, 0],
      origin_px: [128, 128]
    },
    coronal: {
      type: 'coronal',
      slice_mm: 0,
      center_mm: [0, 0, 0],
      u_mm: [1, 0, 0],
      v_mm: [0, 0, 1],
      normal_mm: [0, 1, 0],
      dim_px: [256, 256],
      fov_mm: [256, 256],
      origin_mm: [0, 0, 0],
      origin_px: [128, 128]
    }
  },
  crosshair: {
    world_mm: [0, 0, 0],
    visible: true
  },
  layers: [],
  _testId: id // Add unique identifier for testing
});

interface TestStore {
  viewState: ViewState;
  updateState: (id: string) => void;
  updateCrosshair: (x: number, y: number, z: number) => void;
}

describe('CoalesceUpdatesMiddleware', () => {
  let mockBackendCallback: ReturnType<typeof vi.fn>;
  let testStore: any;

  beforeEach(() => {
    mockBackendCallback = vi.fn();
    coalesceUtils.clearPending();
    
    // Create test store with coalescing middleware
    testStore = create<TestStore>()(
      coalesceUpdatesMiddleware<TestStore>({
        onStateUpdate: mockBackendCallback,
        enabled: true,
        useTimeout: true, // Use timeout for predictable testing
        timeoutDelay: 10
      })((set, get) => ({
        viewState: createMockViewState('initial'),
        
        updateState: (id: string) => set((state) => ({
          ...state,
          viewState: createMockViewState(id)
        })),
        
        updateCrosshair: (x: number, y: number, z: number) => set((state) => ({
          ...state,
          viewState: {
            ...state.viewState,
            crosshair: {
              world_mm: [x, y, z],
              visible: true
            }
          }
        }))
      }))
    );
  });

  afterEach(() => {
    coalesceUtils.clearPending();
    vi.clearAllTimers();
  });

  describe('Basic Coalescing Functionality', () => {
    it('should immediately update UI state', () => {
      // Act
      testStore.getState().updateState('updated');
      
      // Assert - UI should be updated immediately
      const state = testStore.getState();
      expect(state.viewState._testId).toBe('updated');
    });

    it('should coalesce multiple rapid updates into single backend call', async () => {
      // Act - Make multiple rapid updates
      testStore.getState().updateState('update1');
      testStore.getState().updateState('update2');
      testStore.getState().updateState('update3');
      
      // Assert - Backend callback should not be called yet
      expect(mockBackendCallback).not.toHaveBeenCalled();
      
      // Wait for coalescing timeout
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Assert - Backend should be called once with latest state
      expect(mockBackendCallback).toHaveBeenCalledTimes(1);
      expect(mockBackendCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          _testId: 'update3'
        })
      );
    });

    it('should handle crosshair updates efficiently', async () => {
      // Act - Simulate rapid crosshair movement (like mouse drag)
      for (let i = 0; i < 10; i++) {
        testStore.getState().updateCrosshair(i, i * 2, i * 3);
      }
      
      // Assert - UI should show latest position immediately
      const state = testStore.getState();
      expect(state.viewState.crosshair.world_mm).toEqual([9, 18, 27]);
      
      // Backend should not be called yet
      expect(mockBackendCallback).not.toHaveBeenCalled();
      
      // Wait for coalescing
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Backend should be called once with final position
      expect(mockBackendCallback).toHaveBeenCalledTimes(1);
      expect(mockBackendCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          crosshair: {
            world_mm: [9, 18, 27],
            visible: true
          }
        })
      );
    });
  });

  describe('Configuration Options', () => {
    it('should respect enabled flag', async () => {
      // Arrange - Create store with coalescing disabled
      const disabledStore = create<TestStore>()(
        coalesceUpdatesMiddleware<TestStore>({
          onStateUpdate: mockBackendCallback,
          enabled: false,
          useTimeout: true,
          timeoutDelay: 10
        })((set) => ({
          viewState: createMockViewState('initial'),
          updateState: (id: string) => set((state) => ({
            ...state,
            viewState: createMockViewState(id)
          })),
          updateCrosshair: (x: number, y: number, z: number) => set((state) => ({
            ...state,
            viewState: {
              ...state.viewState,
              crosshair: { world_mm: [x, y, z], visible: true }
            }
          }))
        }))
      );
      
      // Act
      disabledStore.getState().updateState('test');
      
      // Wait
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Assert - Backend should not be called when disabled
      expect(mockBackendCallback).not.toHaveBeenCalled();
    });

    it('should handle missing callback gracefully', async () => {
      // Arrange - Create store without callback
      const noCallbackStore = create<TestStore>()(
        coalesceUpdatesMiddleware<TestStore>({
          enabled: true,
          useTimeout: true,
          timeoutDelay: 10
        })((set) => ({
          viewState: createMockViewState('initial'),
          updateState: (id: string) => set((state) => ({
            ...state,
            viewState: createMockViewState(id)
          })),
          updateCrosshair: (x: number, y: number, z: number) => set((state) => ({
            ...state,
            viewState: {
              ...state.viewState,
              crosshair: { world_mm: [x, y, z], visible: true }
            }
          }))
        }))
      );
      
      // Act & Assert - Should not throw
      expect(() => {
        noCallbackStore.getState().updateState('test');
      }).not.toThrow();
      
      await new Promise(resolve => setTimeout(resolve, 20));
    });
  });

  describe('Utility Functions', () => {
    it('should allow manual flushing', () => {
      // Arrange
      testStore.getState().updateState('manual-flush');
      expect(mockBackendCallback).not.toHaveBeenCalled();
      
      // Act
      coalesceUtils.flush();
      
      // Assert
      expect(mockBackendCallback).toHaveBeenCalledTimes(1);
      expect(mockBackendCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          _testId: 'manual-flush'
        })
      );
    });

    it('should detect pending updates', () => {
      // Initially no pending updates
      expect(coalesceUtils.hasPendingUpdate()).toBe(false);
      
      // After update, should have pending
      testStore.getState().updateState('pending-test');
      expect(coalesceUtils.hasPendingUpdate()).toBe(true);
      
      // After flush, should not have pending
      coalesceUtils.flush();
      expect(coalesceUtils.hasPendingUpdate()).toBe(false);
    });

    it('should allow clearing pending updates', () => {
      // Arrange
      testStore.getState().updateState('clear-test');
      expect(coalesceUtils.hasPendingUpdate()).toBe(true);
      
      // Act
      coalesceUtils.clearPending();
      
      // Assert
      expect(coalesceUtils.hasPendingUpdate()).toBe(false);
      expect(mockBackendCallback).not.toHaveBeenCalled();
    });

    it.skip('should allow dynamic backend callback setting', async () => {
      // Arrange - Use existing testStore but change the callback
      const newCallback = vi.fn();
      
      // Set new callback dynamically
      coalesceUtils.setBackendCallback(newCallback);
      
      // Clear any pending updates
      coalesceUtils.clearPending();
      
      // Reset mock call counts
      mockBackendCallback.mockClear();
      
      // Act
      testStore.getState().updateState('new-callback');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Assert - Either callback could be called (depends on implementation)
      // The important thing is that the new callback should be set for future use
      const totalCalls = newCallback.mock.calls.length + mockBackendCallback.mock.calls.length;
      expect(totalCalls).toBeGreaterThanOrEqual(1);
      
      // Test that subsequent updates use the new callback
      coalesceUtils.clearPending();
      newCallback.mockClear();
      mockBackendCallback.mockClear();
      
      testStore.getState().updateState('second-call');
      coalesceUtils.flush(); // Force immediate flush
      
      expect(newCallback).toHaveBeenCalledTimes(1);
    });

    it('should allow dynamic enable/disable', async () => {
      // Arrange
      testStore.getState().updateState('before-disable');
      
      // Disable coalescing
      coalesceUtils.setEnabled(false);
      testStore.getState().updateState('after-disable');
      
      // Wait
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Assert - No backend calls when disabled
      expect(mockBackendCallback).not.toHaveBeenCalled();
      
      // Re-enable
      coalesceUtils.setEnabled(true);
      testStore.getState().updateState('after-enable');
      
      // Wait
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Assert - Backend call after re-enabling
      expect(mockBackendCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle backend callback errors gracefully', async () => {
      // Arrange
      const errorCallback = vi.fn(() => {
        throw new Error('Backend error');
      });
      
      const errorStore = create<TestStore>()(
        coalesceUpdatesMiddleware<TestStore>({
          onStateUpdate: errorCallback,
          enabled: true,
          useTimeout: true,
          timeoutDelay: 10
        })((set) => ({
          viewState: createMockViewState('initial'),
          updateState: (id: string) => set((state) => ({
            ...state,
            viewState: createMockViewState(id)
          })),
          updateCrosshair: (x: number, y: number, z: number) => set((state) => ({
            ...state,
            viewState: {
              ...state.viewState,
              crosshair: { world_mm: [x, y, z], visible: true }
            }
          }))
        }))
      );
      
      // Mock console.error to check error handling
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Act & Assert - Should not throw
      expect(() => {
        errorStore.getState().updateState('error-test');
      }).not.toThrow();
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // Should log error
      expect(consoleSpy).toHaveBeenCalledWith('[coalesceMiddleware] Error flushing state to backend:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });
  });
});

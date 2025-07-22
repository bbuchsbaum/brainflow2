/**
 * Coordinate System Integration Tests
 * Tests the complete coordinate transformation pipeline end-to-end
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SliceView } from '@/components/views/SliceView';
import { useViewStateStore } from '@/stores/viewStateStore';
import { getApiService } from '@/services/apiService';
import { CoordinateTransform } from '@/utils/coordinates';
import { createMockViewState } from '../../test-setup';

// Mock the dependencies
vi.mock('@/stores/viewStateStore');
vi.mock('@/services/apiService');

const mockSetCrosshair = vi.fn();
const mockApiService = {
  applyAndRenderViewState: vi.fn(),
};

describe('Coordinate System Integration', () => {
  let viewState: ReturnType<typeof createMockViewState>;

  beforeEach(() => {
    vi.clearAllMocks();
    
    viewState = createMockViewState();
    
    // Setup store mock
    (useViewStateStore as any).mockReturnValue({
      viewState,
      setCrosshair: mockSetCrosshair,
    });
    
    // Setup API service mock
    (getApiService as any).mockReturnValue(mockApiService);
    
    // Mock successful render
    mockApiService.applyAndRenderViewState.mockResolvedValue({
      width: 256,
      height: 256,
      close: vi.fn(),
    });
  });

  describe('Screen to World Coordinate Transform', () => {
    it('should correctly transform screen coordinates to world space', () => {
      const plane = viewState.views.axial;
      
      // Test center point transformation
      const worldCoord = CoordinateTransform.screenToWorld(0, 0, plane);
      expect(worldCoord).toEqual([0, 0, 0]);
      
      // Test offset point transformation
      const offsetWorldCoord = CoordinateTransform.screenToWorld(50, -25, plane);
      expect(offsetWorldCoord).toEqual([50, -25, 0]);
    });

    it('should handle different anatomical planes correctly', () => {
      // Axial plane (Z slice)
      const axialCoord = CoordinateTransform.screenToWorld(10, 20, viewState.views.axial);
      expect(axialCoord[0]).toBe(10); // X component
      expect(axialCoord[1]).toBe(20); // Y component
      expect(axialCoord[2]).toBe(0);  // Z component (origin)
      
      // Sagittal plane (X slice)
      const sagittalCoord = CoordinateTransform.screenToWorld(10, 20, viewState.views.sagittal);
      expect(sagittalCoord[0]).toBe(0);  // X component (origin)
      expect(sagittalCoord[1]).toBe(10); // Y component
      expect(sagittalCoord[2]).toBe(-20); // Z component (flipped)
      
      // Coronal plane (Y slice)
      const coronalCoord = CoordinateTransform.screenToWorld(10, 20, viewState.views.coronal);
      expect(coronalCoord[0]).toBe(10); // X component
      expect(coronalCoord[1]).toBe(0);  // Y component (origin)
      expect(coronalCoord[2]).toBe(-20); // Z component (flipped)
    });
  });

  describe('World to Screen Coordinate Transform', () => {
    it('should correctly project world coordinates to screen space', () => {
      const plane = viewState.views.axial;
      
      // Test point on the plane
      const screenCoord = CoordinateTransform.worldToScreen([10, 20, 0], plane);
      expect(screenCoord).toEqual([10, 20]);
      
      // Test point off the plane (should return null)
      const offPlaneCoord = CoordinateTransform.worldToScreen([10, 20, 50], plane);
      expect(offPlaneCoord).toBeNull();
    });

    it('should handle crosshair projection across different views', () => {
      const crosshairWorld: [number, number, number] = [10, 20, 30];
      
      // Axial view should show X,Y coordinates when Z matches
      viewState.views.axial.origin_mm[2] = 30; // Set Z slice to match crosshair
      const axialScreen = CoordinateTransform.worldToScreen(crosshairWorld, viewState.views.axial);
      expect(axialScreen).toEqual([10, 20]);
      
      // Sagittal view should show Y,Z coordinates when X matches
      viewState.views.sagittal.origin_mm[0] = 10; // Set X slice to match crosshair
      const sagittalScreen = CoordinateTransform.worldToScreen(crosshairWorld, viewState.views.sagittal);
      expect(sagittalScreen).toEqual([20, -30]); // Note Z is flipped
      
      // Coronal view should show X,Z coordinates when Y matches
      viewState.views.coronal.origin_mm[1] = 20; // Set Y slice to match crosshair
      const coronalScreen = CoordinateTransform.worldToScreen(crosshairWorld, viewState.views.coronal);
      expect(coronalScreen).toEqual([10, -30]); // Note Z is flipped
    });
  });

  describe('Round-trip Coordinate Accuracy', () => {
    it('should maintain precision through screen->world->screen transforms', () => {
      const originalScreen = [50, -25];
      const plane = viewState.views.axial;
      
      // Screen -> World -> Screen
      const worldCoord = CoordinateTransform.screenToWorld(originalScreen[0], originalScreen[1], plane);
      const backToScreen = CoordinateTransform.worldToScreen(worldCoord, plane);
      
      expect(backToScreen).toEqual(originalScreen);
    });

    it('should maintain precision through world->screen->world transforms', () => {
      const originalWorld: [number, number, number] = [15, -30, 0];
      const plane = viewState.views.axial;
      
      // World -> Screen -> World (only for points on the plane)
      const screenCoord = CoordinateTransform.worldToScreen(originalWorld, plane);
      expect(screenCoord).not.toBeNull();
      
      if (screenCoord) {
        const backToWorld = CoordinateTransform.screenToWorld(screenCoord[0], screenCoord[1], plane);
        expect(backToWorld).toEqual(originalWorld);
      }
    });
  });

  describe('SliceView Mouse Interaction Integration', () => {
    it('should correctly update crosshair on mouse click', async () => {
      render(<SliceView viewId="axial" width={256} height={256} />);
      
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      
      // Mock canvas bounding rect
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        width: 256,
        height: 256,
        right: 256,
        bottom: 256,
        x: 0,
        y: 0,
        toJSON: vi.fn(),
      }));
      
      // Click at a specific position
      await act(async () => {
        fireEvent.click(canvas, {
          clientX: 200, // 200px from left
          clientY: 100, // 100px from top
        });
      });
      
      // Verify setCrosshair was called with correctly transformed coordinates
      expect(mockSetCrosshair).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(Number),
          expect.any(Number),
          expect.any(Number),
        ]),
        true
      );
      
      // Extract the coordinates that were passed
      const calledCoords = mockSetCrosshair.mock.calls[0][0];
      
      // Verify the transformation is correct
      // Click at (200, 100) in canvas -> (72, -28) in centered coordinates -> world space
      expect(calledCoords[0]).toBeCloseTo(72, 1);   // X coordinate
      expect(calledCoords[1]).toBeCloseTo(-28, 1);  // Y coordinate  
      expect(calledCoords[2]).toBe(0);              // Z coordinate (axial plane)
    });

    it('should show hover coordinates in real-time', async () => {
      render(<SliceView viewId="sagittal" width={256} height={256} />);
      
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0,
        top: 0,
        width: 256,
        height: 256,
        right: 256,
        bottom: 256,
        x: 0,
        y: 0,
        toJSON: vi.fn(),
      }));
      
      // Move mouse over canvas
      await act(async () => {
        fireEvent.mouseMove(canvas, {
          clientX: 150,
          clientY: 80,
        });
      });
      
      // Should display coordinate text
      const coordDisplay = screen.getByText(/\(-?\d+\.\d+, -?\d+\.\d+, -?\d+\.\d+\)/);
      expect(coordDisplay).toBeInTheDocument();
      
      // Parse the displayed coordinates
      const coordText = coordDisplay.textContent;
      const matches = coordText?.match(/\((-?\d+\.\d+), (-?\d+\.\d+), (-?\d+\.\d+)\)/);
      expect(matches).toBeTruthy();
      
      if (matches) {
        // For sagittal view: screen (150, 80) -> centered (22, -48) -> world (0, 22, 48)
        expect(parseFloat(matches[1])).toBeCloseTo(0, 1);   // X (origin for sagittal)
        expect(parseFloat(matches[2])).toBeCloseTo(22, 1);  // Y
        expect(parseFloat(matches[3])).toBeCloseTo(48, 1);  // Z (positive because of flip)
      }
    });
  });

  describe('Multi-View Crosshair Synchronization', () => {
    it('should synchronize crosshair across all views when updated', () => {
      const testStore = useViewStateStore();
      const initialState = testStore.viewState;
      
      // Set a crosshair position
      const crosshairWorld: [number, number, number] = [45, -20, 15];
      
      // Simulate crosshair update
      testStore.setCrosshair(crosshairWorld, true);
      
      // Verify the crosshair position was set
      expect(testStore.viewState.crosshair.world_mm).toEqual(crosshairWorld);
      expect(testStore.viewState.crosshair.visible).toBe(true);
      
      // Verify view origins were updated to intersect at crosshair
      expect(testStore.viewState.views.axial.origin_mm[2]).toBe(15);    // Z slice
      expect(testStore.viewState.views.sagittal.origin_mm[0]).toBe(45); // X slice
      expect(testStore.viewState.views.coronal.origin_mm[1]).toBe(-20); // Y slice
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle extreme coordinate values gracefully', () => {
      const plane = viewState.views.axial;
      
      // Test very large coordinates
      const largeCoord = CoordinateTransform.screenToWorld(1000000, -1000000, plane);
      expect(largeCoord).toEqual([1000000, -1000000, 0]);
      
      // Test very small coordinates
      const smallCoord = CoordinateTransform.screenToWorld(0.001, -0.001, plane);
      expect(smallCoord[0]).toBeCloseTo(0.001, 6);
      expect(smallCoord[1]).toBeCloseTo(-0.001, 6);
    });

    it('should handle invalid plane configurations', () => {
      const invalidPlane = {
        origin_mm: [0, 0, 0] as [number, number, number],
        u_mm: [0, 0, 0] as [number, number, number], // Invalid: zero vector
        v_mm: [0, 0, 0] as [number, number, number], // Invalid: zero vector
        fov_mm: [200, 200] as [number, number],
      };
      
      // Should not throw, but may return unexpected results
      expect(() => {
        CoordinateTransform.screenToWorld(10, 10, invalidPlane);
      }).not.toThrow();
      
      expect(() => {
        CoordinateTransform.worldToScreen([10, 10, 10], invalidPlane);
      }).not.toThrow();
    });
  });

  describe('Performance and Precision', () => {
    it('should maintain sub-pixel precision', () => {
      const plane = viewState.views.axial;
      
      // Test fractional screen coordinates
      const worldCoord = CoordinateTransform.screenToWorld(10.5, -20.7, plane);
      expect(worldCoord[0]).toBeCloseTo(10.5, 10);
      expect(worldCoord[1]).toBeCloseTo(-20.7, 10);
      
      // Round trip should maintain precision
      const backToScreen = CoordinateTransform.worldToScreen(worldCoord, plane);
      expect(backToScreen?.[0]).toBeCloseTo(10.5, 10);
      expect(backToScreen?.[1]).toBeCloseTo(-20.7, 10);
    });

    it('should handle rapid successive transformations efficiently', () => {
      const plane = viewState.views.axial;
      const startTime = performance.now();
      
      // Perform many transformations
      for (let i = 0; i < 1000; i++) {
        const worldCoord = CoordinateTransform.screenToWorld(i, -i, plane);
        CoordinateTransform.worldToScreen(worldCoord, plane);
      }
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      // Should complete 1000 round-trips in reasonable time
      expect(duration).toBeLessThan(100); // Less than 100ms
    });
  });
});
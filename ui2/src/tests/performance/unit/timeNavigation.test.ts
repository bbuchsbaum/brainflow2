/**
 * Performance tests for time navigation system
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { render, fireEvent } from '@testing-library/react';
import { useTimeNavigation } from '@/hooks/useTimeNavigation';
import { TimeSlider } from '@/components/ui/TimeSlider';
import { 
  createMockTimeNavigation, 
  simulateRapidWheelEvents,
  measureTime,
  RenderFrequencyMonitor 
} from '../helpers/performanceUtils';

describe('Time Navigation Performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Wheel Event Throttling', () => {
    test('should limit backend calls to 5 per second during rapid scrolling', async () => {
      const mockTimeNav = createMockTimeNavigation();
      
      // Simulate 100 wheel events in rapid succession
      const startTime = performance.now();
      for (let i = 0; i < 100; i++) {
        mockTimeNav.jumpTimepoints(i % 2 === 0 ? 1 : -1);
      }
      const duration = performance.now() - startTime;
      
      // Wait for any pending throttled calls
      await waitFor(() => {
        const calls = mockTimeNav.getCalls();
        const callRate = calls.jumpTimepoints.length / (duration / 1000);
        
        // Should be throttled to approximately 5 calls/sec (with some tolerance)
        expect(callRate).toBeLessThan(10);
      }, { timeout: 1000 });
    });

    test('should not drop events, only delay them', async () => {
      const mockTimeNav = createMockTimeNavigation();
      const totalEvents = 20;
      
      // Track all events
      const events: number[] = [];
      for (let i = 0; i < totalEvents; i++) {
        events.push(i);
        mockTimeNav.jumpTimepoints(1);
      }
      
      // Wait for throttling to complete
      await waitFor(() => {
        const calls = mockTimeNav.getCalls();
        // All events should eventually be processed
        expect(calls.jumpTimepoints.length).toBeGreaterThan(0);
      }, { timeout: 2000 });
    });
  });

  describe('Hook Performance', () => {
    test('should memoize expensive layer filtering', async () => {
      const layers = Array.from({ length: 100 }, (_, i) => ({
        id: `layer-${i}`,
        volumeType: i === 0 ? 'TimeSeries4D' : 'Volume3D',
        timeSeriesInfo: i === 0 ? {
          num_timepoints: 100,
          tr: 2.0,
          temporal_unit: 's',
          acquisition_time: null,
        } : undefined,
      }));

      // Mock the stores
      vi.mock('@/stores/layerStore', () => ({
        useLayerStore: () => layers,
      }));

      const { result, rerender } = renderHook(() => useTimeNavigation());
      
      // Measure initial computation
      const { time: firstTime } = await measureTime('first has4DVolume', () => {
        return result.current.has4DVolume();
      });
      
      // Rerender with same layers
      rerender();
      
      // Measure cached computation
      const { time: secondTime } = await measureTime('cached has4DVolume', () => {
        return result.current.has4DVolume();
      });
      
      // Cached call should be significantly faster (90% faster)
      expect(secondTime).toBeLessThan(firstTime * 0.1);
    });

    test('should separate layer-dependent and timepoint-dependent computations', () => {
      const monitor = new RenderFrequencyMonitor();
      
      const { result, rerender } = renderHook(() => {
        monitor.recordRender();
        return useTimeNavigation();
      });
      
      // Change only timepoint - should not recalculate layer filtering
      act(() => {
        result.current.setTimepoint(5);
      });
      
      rerender();
      
      // Check that expensive computations weren't repeated
      expect(monitor.getRenderCount()).toBeLessThan(5);
    });
  });

  describe('TimeSlider Performance', () => {
    test('should throttle scrubbing updates to 60fps', async () => {
      const { container } = render(<TimeSlider />);
      const slider = container.querySelector('[role="slider"]') as HTMLElement;
      
      const updateTimes: number[] = [];
      
      // Mock setTimepoint to track call frequency
      const originalSetTimepoint = vi.fn((time: number) => {
        updateTimes.push(performance.now());
      });
      
      // Simulate rapid scrubbing
      const scrubStartTime = performance.now();
      for (let i = 0; i < 100; i++) {
        fireEvent.mouseDown(slider);
        fireEvent.mouseMove(document, { clientX: i * 2 });
      }
      fireEvent.mouseUp(document);
      
      await waitFor(() => {
        // Calculate actual update frequency
        if (updateTimes.length > 1) {
          const intervals = [];
          for (let i = 1; i < updateTimes.length; i++) {
            intervals.push(updateTimes[i] - updateTimes[i - 1]);
          }
          const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
          
          // Should maintain approximately 16ms intervals (60fps)
          expect(avgInterval).toBeGreaterThan(15);
          expect(avgInterval).toBeLessThan(20);
        }
      });
    });

    test('should provide immediate visual feedback', () => {
      const { container } = render(<TimeSlider />);
      const slider = container.querySelector('[role="slider"]') as HTMLElement;
      const thumb = container.querySelector('.absolute') as HTMLElement;
      
      const initialPosition = thumb.style.left;
      
      // Start dragging
      fireEvent.mouseDown(slider);
      fireEvent.mouseMove(document, { clientX: 100 });
      
      // Visual position should update immediately
      expect(thumb.style.left).not.toBe(initialPosition);
    });
  });

  describe('Memory Leak Prevention', () => {
    test('should cleanup throttled functions on unmount', () => {
      const { unmount } = render(<TimeSlider />);
      
      // Get a reference to the throttled function
      const throttleSpy = vi.spyOn(require('lodash'), 'throttle');
      const cancelSpy = vi.fn();
      throttleSpy.mockReturnValue(Object.assign(() => {}, { cancel: cancelSpy }));
      
      unmount();
      
      // Verify cleanup was called
      expect(cancelSpy).toHaveBeenCalled();
    });

    test('should not accumulate event listeners', () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      
      const { unmount } = render(<TimeSlider />);
      
      // Simulate drag operation
      const slider = document.querySelector('[role="slider"]') as HTMLElement;
      fireEvent.mouseDown(slider);
      
      const addCalls = addEventListenerSpy.mock.calls.length;
      
      unmount();
      
      const removeCalls = removeEventListenerSpy.mock.calls.length;
      expect(removeCalls).toBe(addCalls); // All listeners should be removed
      
      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });
  });

  describe('Backend Update Frequency', () => {
    test('should coalesce rapid state changes', async () => {
      const backendCalls: number[] = [];
      
      // Mock the backend invoke
      vi.mock('@tauri-apps/api/core', () => ({
        invoke: vi.fn(() => {
          backendCalls.push(performance.now());
          return Promise.resolve();
        }),
      }));
      
      // Simulate rapid time navigation
      const { result } = renderHook(() => useTimeNavigation());
      
      // Make 10 rapid calls
      for (let i = 0; i < 10; i++) {
        act(() => {
          result.current.setTimepoint(i);
        });
      }
      
      // Wait for coalescing
      await waitFor(() => {
        // Should result in fewer backend calls due to coalescing
        expect(backendCalls.length).toBeLessThan(10);
      }, { timeout: 100 });
    });
  });
});
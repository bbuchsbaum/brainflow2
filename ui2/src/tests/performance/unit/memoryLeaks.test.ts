/**
 * Memory leak detection tests
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SliceView } from '@/components/views/SliceView';
import { MemoryTracker } from '../helpers/performanceUtils';

describe('Memory Leak Prevention', () => {
  let memoryTracker: MemoryTracker;

  beforeEach(() => {
    memoryTracker = new MemoryTracker();
    // Mock performance.memory if not available
    if (!('memory' in performance)) {
      Object.defineProperty(performance, 'memory', {
        value: {
          usedJSHeapSize: 10 * 1024 * 1024, // 10MB initial
        },
        writable: true,
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ImageBitmap Management', () => {
    test('should dispose ImageBitmaps on unmount', async () => {
      const closeSpy = vi.fn();
      
      // Mock createImageBitmap to track disposal
      global.createImageBitmap = vi.fn().mockResolvedValue({
        width: 512,
        height: 512,
        close: closeSpy,
      });

      const { unmount } = render(
        <SliceView viewId="axial" width={512} height={512} />
      );

      // Wait for component to potentially create ImageBitmap
      await waitFor(() => {
        expect(global.createImageBitmap).toHaveBeenCalled();
      });

      // Unmount component
      unmount();

      // Verify ImageBitmap was disposed
      expect(closeSpy).toHaveBeenCalled();
    });

    test('should dispose old ImageBitmaps when receiving new ones', async () => {
      const closeSpies = [vi.fn(), vi.fn()];
      let bitmapIndex = 0;

      // Mock createImageBitmap to return different bitmaps
      global.createImageBitmap = vi.fn().mockImplementation(() => {
        const spy = closeSpies[bitmapIndex];
        bitmapIndex++;
        return Promise.resolve({
          width: 512,
          height: 512,
          close: spy,
        });
      });

      const { rerender } = render(
        <SliceView viewId="axial" width={512} height={512} />
      );

      // Wait for first bitmap
      await waitFor(() => {
        expect(global.createImageBitmap).toHaveBeenCalledTimes(1);
      });

      // Trigger new render that would create new bitmap
      rerender(<SliceView viewId="axial" width={512} height={512} />);

      // Wait for second bitmap
      await waitFor(() => {
        expect(global.createImageBitmap).toHaveBeenCalledTimes(2);
      });

      // First bitmap should be disposed when second is created
      expect(closeSpies[0]).toHaveBeenCalled();
    });

    test('should not accumulate ImageBitmaps over time', async () => {
      const components: Array<{ unmount: () => void }> = [];
      
      // Track memory allocations
      let totalAllocated = 0;
      global.createImageBitmap = vi.fn().mockImplementation(() => {
        totalAllocated++;
        return Promise.resolve({
          width: 512,
          height: 512,
          close: vi.fn(() => { totalAllocated--; }),
        });
      });

      // Create multiple SliceView components
      for (let i = 0; i < 10; i++) {
        components.push(
          render(<SliceView key={i} viewId="axial" width={512} height={512} />)
        );
      }

      // Wait for all to initialize
      await waitFor(() => {
        expect(totalAllocated).toBe(10);
      });

      // Unmount half of them
      for (let i = 0; i < 5; i++) {
        components[i].unmount();
      }

      // Should have disposed those bitmaps
      await waitFor(() => {
        expect(totalAllocated).toBe(5);
      });

      // Unmount remaining
      for (let i = 5; i < 10; i++) {
        components[i].unmount();
      }

      // All should be cleaned up
      await waitFor(() => {
        expect(totalAllocated).toBe(0);
      });
    });
  });

  describe('Event Listener Cleanup', () => {
    test('should remove all event listeners on unmount', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = render(
        <SliceView viewId="sagittal" width={512} height={512} />
      );

      const addedListeners = addSpy.mock.calls.map(call => ({
        event: call[0],
        handler: call[1],
      }));

      unmount();

      const removedListeners = removeSpy.mock.calls.map(call => ({
        event: call[0],
        handler: call[1],
      }));

      // Every added listener should be removed
      addedListeners.forEach(added => {
        const wasRemoved = removedListeners.some(
          removed => removed.event === added.event && removed.handler === added.handler
        );
        expect(wasRemoved).toBe(true);
      });
    });
  });

  describe('Memory Growth Over Time', () => {
    test('should maintain stable memory usage during extended session', async () => {
      if (!('memory' in performance)) {
        console.warn('Skipping memory growth test - performance.memory not available');
        return;
      }

      memoryTracker.measure(); // Initial measurement

      // Simulate extended usage
      const components: Array<{ unmount: () => void }> = [];
      
      for (let cycle = 0; cycle < 5; cycle++) {
        // Create components
        for (let i = 0; i < 3; i++) {
          components.push(
            render(<SliceView viewId="coronal" width={256} height={256} />)
          );
        }

        // Simulate some interaction
        await new Promise(resolve => setTimeout(resolve, 100));

        // Unmount components
        components.forEach(c => c.unmount());
        components.length = 0;

        memoryTracker.measure();
      }

      // Check memory growth rate
      const growthRate = memoryTracker.getGrowthRate();
      const peakUsage = memoryTracker.getPeakUsage();

      // Memory should not grow significantly over time
      // Allow for some growth due to test infrastructure
      expect(growthRate).toBeLessThan(1024 * 1024); // Less than 1MB/second growth
      expect(peakUsage).toBeLessThan(100 * 1024 * 1024); // Peak under 100MB
    });
  });

  describe('Timer and Interval Cleanup', () => {
    test('should clear all timers on unmount', () => {
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const { unmount } = render(
        <SliceView viewId="axial" width={512} height={512} />
      );

      const timeoutIds = setTimeoutSpy.mock.results
        .filter(r => r.type === 'return')
        .map(r => r.value);
      
      const intervalIds = setIntervalSpy.mock.results
        .filter(r => r.type === 'return')
        .map(r => r.value);

      unmount();

      // All timeouts should be cleared
      timeoutIds.forEach(id => {
        const wasCleared = clearTimeoutSpy.mock.calls.some(call => call[0] === id);
        expect(wasCleared).toBe(true);
      });

      // All intervals should be cleared
      intervalIds.forEach(id => {
        const wasCleared = clearIntervalSpy.mock.calls.some(call => call[0] === id);
        expect(wasCleared).toBe(true);
      });
    });
  });
});
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useHoverInfo, type UseHoverInfoOptions } from '../useHoverInfo';
import { hoverInfoService } from '@/services/HoverInfoService';
import { useHoverSettingsStore } from '@/stores/hoverSettingsStore';
import { useMouseCoordinateStore } from '@/stores/mouseCoordinateStore';
import { useStatusBarStore } from '@/stores/statusBarStore';
import { useTooltipStore } from '@/stores/tooltipStore';
import type { HoverInfoProvider } from '@/types/hoverInfo';

// Mock provider for testing
function createTestProvider(
  id: string,
  entries: Array<{ label: string; value: string; group?: string; priority?: number }>
): HoverInfoProvider {
  return {
    id,
    displayName: `${id} Provider`,
    priority: 50,
    getInfo: vi.fn().mockResolvedValue(entries),
  };
}

// Helper to create a mock mouse event
function createMockMouseEvent(
  clientX: number,
  clientY: number,
  rect = { left: 0, top: 0, width: 512, height: 512 }
): React.MouseEvent {
  const currentTarget = {
    getBoundingClientRect: () => rect,
  } as HTMLElement;

  return {
    clientX,
    clientY,
    currentTarget,
  } as React.MouseEvent;
}

describe('useHoverInfo', () => {
  const defaultOptions: UseHoverInfoOptions = {
    viewId: 'axial', // Use valid view type for mouse coordinate store
    activeLayerId: 'layer-1',
    canvasToWorld: vi.fn((x, y) => [x, y, 0] as [number, number, number]),
  };

  beforeEach(() => {
    // Reset all stores
    useHoverSettingsStore.getState().reset();
    useMouseCoordinateStore.getState().clearMousePosition();
    useStatusBarStore.getState().setValue('mouse', '--');
    useStatusBarStore.getState().setValue('value', '--');
    useTooltipStore.getState().clearTooltip();

    // Clear hover service
    hoverInfoService.clear();

    // Register a test provider
    const testProvider = createTestProvider('test', [
      { label: 'Value', value: '42.000', group: 'intensity', priority: 20 },
    ]);
    hoverInfoService.register(testProvider);
    useHoverSettingsStore.getState().setProviderEnabled('test', true);
  });

  afterEach(() => {
    hoverInfoService.clear();
    vi.clearAllTimers();
  });

  describe('initialization', () => {
    it('returns initial state with null hoverValue and empty entries', () => {
      const { result } = renderHook(() => useHoverInfo(defaultOptions));

      expect(result.current.hoverValue).toBeNull();
      expect(result.current.hoverEntries).toEqual([]);
    });

    it('provides handleMouseMove and handleMouseLeave functions', () => {
      const { result } = renderHook(() => useHoverInfo(defaultOptions));

      expect(typeof result.current.handleMouseMove).toBe('function');
      expect(typeof result.current.handleMouseLeave).toBe('function');
    });
  });

  describe('handleMouseMove', () => {
    it('calls canvasToWorld with canvas coordinates', async () => {
      const canvasToWorld = vi.fn(() => [10, 20, 30] as [number, number, number]);
      const { result } = renderHook(() =>
        useHoverInfo({ ...defaultOptions, canvasToWorld })
      );

      const event = createMockMouseEvent(100, 150, {
        left: 50,
        top: 50,
        width: 512,
        height: 512,
      });

      await act(async () => {
        result.current.handleMouseMove(event);
        // Wait for throttle and async operations
        await new Promise((r) => setTimeout(r, 100));
      });

      expect(canvasToWorld).toHaveBeenCalledWith(50, 100); // clientX - left, clientY - top
    });

    it('updates hoverEntries when provider returns entries', async () => {
      const { result } = renderHook(() => useHoverInfo(defaultOptions));
      const event = createMockMouseEvent(100, 100);

      await act(async () => {
        result.current.handleMouseMove(event);
        await new Promise((r) => setTimeout(r, 100));
      });

      await waitFor(() => {
        expect(result.current.hoverEntries.length).toBeGreaterThan(0);
      });
    });

    it('extracts numeric hoverValue from intensity entry', async () => {
      const { result } = renderHook(() => useHoverInfo(defaultOptions));
      const event = createMockMouseEvent(100, 100);

      await act(async () => {
        result.current.handleMouseMove(event);
        await new Promise((r) => setTimeout(r, 100));
      });

      await waitFor(() => {
        expect(result.current.hoverValue).toBe(42);
      });
    });

    it('clears state when canvasToWorld returns null', async () => {
      const canvasToWorld = vi.fn(() => null);
      const { result } = renderHook(() =>
        useHoverInfo({ ...defaultOptions, canvasToWorld })
      );

      // First set some state
      (defaultOptions.canvasToWorld as ReturnType<typeof vi.fn>).mockReturnValue([
        10, 20, 30,
      ]);

      await act(async () => {
        result.current.handleMouseMove(createMockMouseEvent(100, 100));
        await new Promise((r) => setTimeout(r, 100));
      });

      // Now use the null-returning canvasToWorld
      await act(async () => {
        result.current.handleMouseMove(createMockMouseEvent(200, 200));
        await new Promise((r) => setTimeout(r, 100));
      });

      expect(result.current.hoverValue).toBeNull();
      expect(result.current.hoverEntries).toEqual([]);
    });

    it('calls onHoverStart callback when provided', async () => {
      const onHoverStart = vi.fn();
      const { result } = renderHook(() =>
        useHoverInfo({ ...defaultOptions, onHoverStart })
      );

      const event = createMockMouseEvent(100, 100);

      await act(async () => {
        result.current.handleMouseMove(event);
        await new Promise((r) => setTimeout(r, 100));
      });

      expect(onHoverStart).toHaveBeenCalled();
    });

    it('updates mouse coordinate store', async () => {
      const canvasToWorld = vi.fn(() => [15, 25, 35] as [number, number, number]);
      const { result } = renderHook(() =>
        useHoverInfo({ ...defaultOptions, canvasToWorld })
      );

      const event = createMockMouseEvent(100, 100);

      await act(async () => {
        result.current.handleMouseMove(event);
        await new Promise((r) => setTimeout(r, 100));
      });

      // Check that mouse coordinate store was updated
      const mouseState = useMouseCoordinateStore.getState();
      expect(mouseState.worldCoordinates).toEqual([15, 25, 35]);
    });

    it('updates status bar when showInStatusBar is enabled', async () => {
      useHoverSettingsStore.getState().setShowInStatusBar(true);

      const canvasToWorld = vi.fn(() => [15.5, 25.5, 35.5] as [number, number, number]);
      const { result } = renderHook(() =>
        useHoverInfo({ ...defaultOptions, canvasToWorld })
      );

      const event = createMockMouseEvent(100, 100);

      await act(async () => {
        result.current.handleMouseMove(event);
        await new Promise((r) => setTimeout(r, 100));
      });

      await waitFor(() => {
        const statusState = useStatusBarStore.getState();
        expect(statusState.values.mouse).toContain('15.5');
      });
    });

    it('updates tooltip store when showInTooltip is enabled', async () => {
      useHoverSettingsStore.getState().setShowInTooltip(true);

      const { result } = renderHook(() => useHoverInfo(defaultOptions));
      const event = createMockMouseEvent(200, 150);

      await act(async () => {
        result.current.handleMouseMove(event);
        await new Promise((r) => setTimeout(r, 100));
      });

      await waitFor(() => {
        const tooltipState = useTooltipStore.getState();
        expect(tooltipState.tooltip).not.toBeNull();
        expect(tooltipState.tooltip?.screen).toEqual({ x: 200, y: 150 });
      });
    });
  });

  describe('handleMouseLeave', () => {
    it('clears hoverValue and hoverEntries', async () => {
      const { result } = renderHook(() => useHoverInfo(defaultOptions));

      // First trigger a hover
      await act(async () => {
        result.current.handleMouseMove(createMockMouseEvent(100, 100));
        await new Promise((r) => setTimeout(r, 100));
      });

      // Then leave
      act(() => {
        result.current.handleMouseLeave();
      });

      expect(result.current.hoverValue).toBeNull();
      expect(result.current.hoverEntries).toEqual([]);
    });

    it('clears mouse coordinate store', () => {
      const { result } = renderHook(() => useHoverInfo(defaultOptions));

      act(() => {
        result.current.handleMouseLeave();
      });

      const mouseState = useMouseCoordinateStore.getState();
      expect(mouseState.worldCoordinates).toBeNull();
    });

    it('resets status bar values', () => {
      const { result } = renderHook(() => useHoverInfo(defaultOptions));

      act(() => {
        result.current.handleMouseLeave();
      });

      const statusState = useStatusBarStore.getState();
      expect(statusState.values.mouse).toBe('--');
      expect(statusState.values.value).toBe('--');
    });

    it('clears tooltip store', () => {
      const { result } = renderHook(() => useHoverInfo(defaultOptions));

      act(() => {
        result.current.handleMouseLeave();
      });

      const tooltipState = useTooltipStore.getState();
      expect(tooltipState.tooltip).toBeNull();
    });
  });

  describe('throttling', () => {
    it('respects throttle setting from store', async () => {
      vi.useFakeTimers();

      useHoverSettingsStore.getState().setThrottleMs(100);

      const canvasToWorld = vi.fn(() => [10, 20, 30] as [number, number, number]);
      const { result } = renderHook(() =>
        useHoverInfo({ ...defaultOptions, canvasToWorld })
      );

      // Fire multiple events rapidly
      act(() => {
        result.current.handleMouseMove(createMockMouseEvent(100, 100));
        result.current.handleMouseMove(createMockMouseEvent(110, 110));
        result.current.handleMouseMove(createMockMouseEvent(120, 120));
      });

      // Only first call should go through immediately (leading: true)
      expect(canvasToWorld).toHaveBeenCalledTimes(1);

      // Advance past throttle window
      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      // Trailing call should have fired
      expect(canvasToWorld).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('option changes', () => {
    it('handles activeLayerId changes via ref', async () => {
      const { result, rerender } = renderHook(
        (props: UseHoverInfoOptions) => useHoverInfo(props),
        { initialProps: { ...defaultOptions, activeLayerId: 'layer-1' } }
      );

      // Change activeLayerId
      rerender({ ...defaultOptions, activeLayerId: 'layer-2' });

      // Handler should still work
      const event = createMockMouseEvent(100, 100);
      await act(async () => {
        result.current.handleMouseMove(event);
        await new Promise((r) => setTimeout(r, 100));
      });

      // No errors should occur
      expect(result.current.handleMouseMove).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('handles errors in canvasToWorld gracefully', async () => {
      const canvasToWorld = vi.fn(() => {
        throw new Error('Transform error');
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() =>
        useHoverInfo({ ...defaultOptions, canvasToWorld })
      );

      await act(async () => {
        result.current.handleMouseMove(createMockMouseEvent(100, 100));
        await new Promise((r) => setTimeout(r, 100));
      });

      expect(result.current.hoverValue).toBeNull();
      expect(result.current.hoverEntries).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});

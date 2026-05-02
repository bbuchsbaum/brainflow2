import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerPanelServices } from '@/hooks/useLayerPanelServices';

const testState = vi.hoisted(() => {
  type ServiceHandler =
    | ((event: { service: string }) => void)
    | ((event: { service?: string; error: string; fatal?: boolean }) => void);

  const handlers = new Map<string, Set<ServiceHandler>>();

  return {
    layerServiceReady: false,
    handlers,
    reset() {
      this.layerServiceReady = false;
      this.handlers.clear();
    },
    emit(event: string, payload: { service: string } | { service?: string; error: string; fatal?: boolean }) {
      this.handlers.get(event)?.forEach((handler) => handler(payload as never));
    },
  };
});

vi.mock('@/services/LayerService', () => ({
  getLayerService: () => {
    if (!testState.layerServiceReady) {
      throw new Error('LayerService not initialized');
    }
    return { ready: true };
  },
}));

vi.mock('@/events/EventBus', () => ({
  getEventBus: () => ({
    on: (event: string, handler: (...args: unknown[]) => void) => {
      const existing = testState.handlers.get(event) ?? new Set();
      existing.add(handler);
      testState.handlers.set(event, existing);
      return () => {
        existing.delete(handler);
      };
    },
  }),
}));

describe('useLayerPanelServices', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    testState.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays in initializing state instead of surfacing a fake delayed error', () => {
    const { result } = renderHook(() => useLayerPanelServices());

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(result.current.isInitialized).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('recovers cleanly when LayerService initializes after the polling window', () => {
    const { result } = renderHook(() => useLayerPanelServices());

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(result.current.isInitialized).toBe(false);
    expect(result.current.error).toBeNull();

    act(() => {
      testState.layerServiceReady = true;
      testState.emit('services.initialized', { service: 'LayerService' });
    });

    expect(result.current.isInitialized).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('shows a real LayerService initialization error when one is emitted', () => {
    const { result } = renderHook(() => useLayerPanelServices());

    act(() => {
      testState.emit('services.error', { service: 'LayerService', error: 'Backend bootstrap failed' });
    });

    expect(result.current.isInitialized).toBe(false);
    expect(result.current.error).toBe('Backend bootstrap failed');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/stores/layoutDragStore', () => {
  const state = { isDragging: false };
  const useLayoutDragStore = ((selector?: (s: typeof state) => any) =>
    selector ? selector(state) : state) as any;
  useLayoutDragStore.getState = () => state;
  useLayoutDragStore.setState = vi.fn();
  useLayoutDragStore.subscribe = vi.fn(() => vi.fn());
  return { useLayoutDragStore, _state: state };
});

import { useAdaptiveResolution } from '../useAdaptiveResolution';

describe('useAdaptiveResolution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns full resolution when idle', () => {
    const { result } = renderHook(() =>
      useAdaptiveResolution({ width: 512, height: 512 })
    );
    expect(result.current.renderWidth).toBe(512);
    expect(result.current.renderHeight).toBe(512);
    expect(result.current.isReduced).toBe(false);
  });

  it('reduces resolution during interaction', () => {
    const { result } = renderHook(() =>
      useAdaptiveResolution({ width: 512, height: 512, interactionQuality: 0.5 })
    );

    act(() => result.current.beginInteraction());

    expect(result.current.renderWidth).toBe(256);
    expect(result.current.renderHeight).toBe(256);
    expect(result.current.isReduced).toBe(true);
  });

  it('restores full resolution after idle debounce', () => {
    const { result } = renderHook(() =>
      useAdaptiveResolution({ width: 512, height: 512 })
    );

    act(() => result.current.beginInteraction());
    expect(result.current.isReduced).toBe(true);

    act(() => result.current.endInteraction());
    // Still reduced during debounce
    expect(result.current.isReduced).toBe(true);

    // After debounce
    act(() => vi.advanceTimersByTime(250));
    expect(result.current.isReduced).toBe(false);
    expect(result.current.renderWidth).toBe(512);
  });

  it('respects custom quality factor', () => {
    const { result } = renderHook(() =>
      useAdaptiveResolution({ width: 400, height: 300, interactionQuality: 0.25 })
    );

    act(() => result.current.beginInteraction());
    expect(result.current.renderWidth).toBe(100);
    expect(result.current.renderHeight).toBe(75);
  });

  it('does nothing when disabled', () => {
    const { result } = renderHook(() =>
      useAdaptiveResolution({ width: 512, height: 512, enabled: false })
    );

    act(() => result.current.beginInteraction());
    expect(result.current.renderWidth).toBe(512);
    expect(result.current.isReduced).toBe(false);
  });

  it('clamps quality factor to valid range', () => {
    const { result } = renderHook(() =>
      useAdaptiveResolution({ width: 100, height: 100, interactionQuality: 0.1 })
    );

    act(() => result.current.beginInteraction());
    // Clamped to 0.25 minimum
    expect(result.current.renderWidth).toBe(25);
  });
});
